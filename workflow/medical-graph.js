import { StateGraph, END } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

/* ============================================================
   FIREBASE ADMIN INIT (SAFE FOR VERCEL)
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
};

/* ============================================================
   🔴 MEDICAL SAFETY RULE ENGINE (SCALABLE)
============================================================ */

/** Always HIGH risk conditions */
const HIGH_RISK_RULES = [
  { label: "Cancer", keywords: ["cancer", "tumor", "malignant", "metastasis", "chemotherapy", "radiation"] },
  { label: "Cardiac event", keywords: ["heart attack", "myocardial infarction", "cardiac arrest"] },
  { label: "Stroke", keywords: ["stroke", "brain bleed", "hemorrhage"] },
  { label: "Organ failure", keywords: ["kidney failure", "liver failure", "respiratory failure"] },
  { label: "Severe infection", keywords: ["sepsis", "blood infection"] },
  { label: "Pregnancy risk", keywords: ["ectopic", "pre-eclampsia", "pregnancy complication"] },
  { label: "Immunocompromised", keywords: ["hiv", "aids", "transplant", "immunosuppressed"] },
];

/** Acute danger symptoms (override everything) */
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
   NODE 1 — LOAD MEMORY
============================================================ */
async function nodeLoadMemory(state) {
  let { appId, userId, sessionId } = state;

  if (!sessionId) sessionId = randomUUID();
  if (!db || !userId) return { ...state, sessionId };

  const shortRef = db.doc(
    `artifacts/${appId}/users/${userId}/agent_memory_short/${sessionId}`
  );
  const shortSnap = await shortRef.get();
  const shortSummary = shortSnap.exists ? shortSnap.data().summary : "";

  const longSnap = await db
    .collection(`artifacts/${appId}/users/${userId}/agent_memory_long`)
    .orderBy("lastSeenAt", "desc")
    .limit(5)
    .get();

  const longFacts = longSnap.docs.map(d => d.data());

  return {
    ...state,
    sessionId,
    memory_summary: shortSummary,
    memory_facts: longFacts,
  };
}

/* ============================================================
   NODE 2 — ANALYZE (LLM + RULE OVERRIDES)
============================================================ */
async function nodeAnalyze(state) {
  const prompt = `
You are a medical pre-screening AI.

PAST CONTEXT SUMMARY:
${state.memory_summary || "None"}

KNOWN USER FACTS:
${JSON.stringify(state.memory_facts || [])}

CURRENT USER MESSAGE:
${state.message}

Respond ONLY in valid JSON:
{
  "category": "symptoms | test_report | general_question",
  "triage": "low | medium | high",
  "needs_doctor": true | false,
  "followup_question": "string"
}
`;

  let result;
  try {
    const response = await model.invoke(prompt);
    result = JSON.parse(response.content);
  } catch {
    result = {
      category: "general_question",
      triage: "low",
      needs_doctor: false,
      followup_question: "",
    };
  }

  /* ---------- RULE ENGINE OVERRIDES ---------- */
  const highRiskCondition = detectHighRisk(state.message);
  const acuteDanger = detectAcuteDanger(state.message);

  let triage = result.triage;
  let needsDoctor = result.needs_doctor;
  let escalationReason = null;

  if (highRiskCondition) {
    triage = "high";
    needsDoctor = true;
    escalationReason = highRiskCondition.label;
  }

  if (acuteDanger) {
    triage = "high";
    needsDoctor = true;
    escalationReason = "Acute danger symptom";
  }

  return {
    ...state,
    category: result.category,
    triage,
    needs_doctor: needsDoctor,
    followup_question: result.followup_question,
    escalation_reason: escalationReason,
  };
}

/* ============================================================
   NODE 3 — RETRIEVE (RAG HOOK)
============================================================ */
async function nodeRetrieve(state) {
  const context =
    "MedlinePlus indicates that serious or chronic conditions require ongoing medical supervision.";
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

NEEDS DOCTOR:
${state.needs_doctor}

FOLLOW-UP QUESTION:
${state.followup_question || "None"}

CONTEXT:
${state.context}

Provide a calm, clear, supportive response.
Do NOT diagnose or prescribe medication.
Emphasize safety and appropriate escalation when needed.
`;

  const response = await model.invoke(prompt);

  return {
    ...state,
    answer: response.content,
    sources: ["MedlinePlus"],
  };
}

/* ============================================================
   NODE 5 — STORE MEMORY (EXPLAINABLE)
============================================================ */
async function nodeStoreMemory(state) {
  const { appId, userId, sessionId } = state;
  if (!db || !userId) return state;

  const summaryPrompt = `
Summarize this interaction in 3 lines focusing on medical risk and concerns.
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
