import { StateGraph, END } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

/* ============================================================
   FIREBASE ADMIN INIT (SAFE FOR SERVERLESS)
============================================================ */
if (!getApps().length && process.env.FIREBASE_SERVICE_ACCOUNT) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = getFirestore();

/* ============================================================
   LLM
============================================================ */
const model = new ChatGoogleGenerativeAI({
  modelName: "gemini-pro",
  maxOutputTokens: 2048,
});

/* ============================================================
   GRAPH STATE
============================================================ */
const graphState = {
  message: null,
  appId: null,
  userId: null,
  sessionId: null,

  category: null,
  triage: null,
  needs_doctor: null,
  followup_question: null,

  context: null,
  answer: null,
  sources: null,

  memory_summary: null,
  memory_facts: null,
  escalation_reason: null,
};

/* ============================================================
   MEDICAL RULE ENGINE (DETERMINISTIC SAFETY)
============================================================ */
const HIGH_RISK_RULES = [
  { label: "Cancer", keywords: ["cancer", "tumor", "malignant", "metastasis", "chemotherapy", "radiation"] },
  { label: "Cardiac disease", keywords: ["heart attack", "cardiac arrest", "myocardial infarction"] },
  { label: "Stroke", keywords: ["stroke", "brain bleed", "hemorrhage"] },
  { label: "Organ failure", keywords: ["kidney failure", "liver failure", "respiratory failure"] },
  { label: "Severe infection", keywords: ["sepsis", "blood infection"] },
  { label: "Pregnancy risk", keywords: ["ectopic", "pre-eclampsia", "pregnancy complication"] },
  { label: "Immunocompromised", keywords: ["hiv", "aids", "transplant", "immunosuppressed"] },
];

const ACUTE_DANGER_SYMPTOMS = [
  "chest pain",
  "shortness of breath",
  "difficulty breathing",
  "fainting",
  "unconscious",
  "seizure",
  "severe bleeding",
  "confusion",
  "sudden weakness",
  "vision loss",
];

function detectHighRisk(text = "") {
  const lower = text.toLowerCase();
  return HIGH_RISK_RULES.find(rule =>
    rule.keywords.some(k => lower.includes(k))
  );
}

function detectAcuteDanger(text = "") {
  const lower = text.toLowerCase();
  return ACUTE_DANGER_SYMPTOMS.some(s => lower.includes(s));
}

/* ============================================================
   NODE 1 — LOAD MEMORY + CREATE SESSION
============================================================ */
async function nodeLoadMemory(state) {
  let { appId, userId, sessionId } = state;
  if (!sessionId) sessionId = randomUUID();

  if (!db || !userId) {
    return { ...state, sessionId };
  }

  const sessionRef = db.doc(
    `artifacts/${appId}/users/${userId}/agent_sessions/${sessionId}`
  );

  await sessionRef.set(
    {
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
      active: true,
    },
    { merge: true }
  );

  const shortSnap = await db
    .doc(`artifacts/${appId}/users/${userId}/agent_memory_short/${sessionId}`)
    .get();

  const memory_summary = shortSnap.exists ? shortSnap.data().summary : "";

  const longSnap = await db
    .collection(`artifacts/${appId}/users/${userId}/agent_memory_long`)
    .orderBy("lastSeenAt", "desc")
    .limit(5)
    .get();

  const memory_facts = longSnap.docs.map(d => d.data());

  return {
    ...state,
    sessionId,
    memory_summary,
    memory_facts,
  };
}

/* ============================================================
   NODE 2 — ANALYZE (LLM + RULE OVERRIDES)
============================================================ */
async function nodeAnalyze(state) {
  const prompt = `
You are a medical pre-screening AI.

PAST CONTEXT:
${state.memory_summary || "None"}

KNOWN FACTS:
${JSON.stringify(state.memory_facts || [])}

USER MESSAGE:
${state.message}

Respond ONLY in valid JSON:
{
  "category": "symptoms | test_report | general_question",
  "triage": "low | medium | high",
  "needs_doctor": true | false,
  "followup_question": "string"
}
`;

  let parsed;
  try {
    const res = await model.invoke(prompt);
    parsed = JSON.parse(res.content);
  } catch {
    parsed = {
      category: "general_question",
      triage: "low",
      needs_doctor: false,
      followup_question: "",
    };
  }

  const highRisk = detectHighRisk(state.message);
  const acuteDanger = detectAcuteDanger(state.message);

  let triage = parsed.triage;
  let needs_doctor = parsed.needs_doctor;
  let escalation_reason = null;

  if (highRisk) {
    triage = "high";
    needs_doctor = true;
    escalation_reason = highRisk.label;
  }

  if (acuteDanger) {
    triage = "high";
    needs_doctor = true;
    escalation_reason = "Acute danger symptom";
  }

  return {
    ...state,
    category: parsed.category,
    triage,
    needs_doctor,
    followup_question: parsed.followup_question,
    escalation_reason,
  };
}

/* ============================================================
   NODE 3 — RETRIEVE (RAG HOOK)
============================================================ */
async function nodeRetrieve(state) {
  const context =
    "MedlinePlus advises that serious or chronic conditions require professional medical supervision.";
  return { ...state, context };
}

/* ============================================================
   NODE 4 — FINAL RESPONSE
============================================================ */
async function nodeFinal(state) {
  const prompt = `
You are a medical assistant.

USER MESSAGE:
${state.message}

TRIAGE LEVEL:
${state.triage}

FOLLOW-UP QUESTION:
${state.followup_question || "None"}

CONTEXT:
${state.context}

Respond clearly, calmly, and safely.
Do NOT diagnose or prescribe medication.
`;

  const response = await model.invoke(prompt);

  return {
    ...state,
    answer: response.content,
    sources: ["MedlinePlus"],
  };
}

/* ============================================================
   NODE 5 — STORE MEMORY + UPDATE SESSION
============================================================ */
async function nodeStoreMemory(state) {
  const { appId, userId, sessionId } = state;
  if (!db || !userId) return state;

  const summaryPrompt = `
Summarize this interaction in 3 lines focusing on risk and concerns.
User: ${state.message}
Assistant: ${state.answer}
`;
  const summaryRes = await model.invoke(summaryPrompt);

  await db
    .doc(`artifacts/${appId}/users/${userId}/agent_memory_short/${sessionId}`)
    .set(
      {
        summary: summaryRes.content,
        lastUpdatedAt: Date.now(),
      },
      { merge: true }
    );

  if (state.triage === "high" || state.needs_doctor) {
    await db
      .collection(`artifacts/${appId}/users/${userId}/agent_memory_long`)
      .add({
        type: "risk",
        value: state.escalation_reason || state.message.slice(0, 200),
        confidence: 1.0,
        lastSeenAt: Date.now(),
        source: "rule_engine",
      });
  }

  await db
    .doc(`artifacts/${appId}/users/${userId}/agent_sessions/${sessionId}`)
    .set(
      {
        lastActiveAt: Date.now(),
        currentTriage: state.triage,
        currentGoal:
          state.triage === "high"
            ? "Ongoing risk monitoring and escalation"
            : "General health guidance",
        active: true,
      },
      { merge: true }
    );

  return state;
}

/* ============================================================
   GRAPH DEFINITION
============================================================ */
const workflow = new StateGraph({ channels: graphState })
  .addNode("load_memory", nodeLoadMemory)
  .addNode("analyze", nodeAnalyze)
  .addNode("retrieve", nodeRetrieve)
  .addNode("final", nodeFinal)
  .addNode("store_memory", nodeStoreMemory);

workflow.setEntryPoint("load_memory");
workflow.addEdge("load_memory", "analyze");
workflow.addEdge("analyze", "retrieve");
workflow.addEdge("retrieve", "final");
workflow.addEdge("final", "store_memory");
workflow.addEdge("store_memory", END);

export const graph = workflow.compile();
