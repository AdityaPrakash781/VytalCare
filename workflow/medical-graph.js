import { StateGraph, END } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

if (!getApps().length && process.env.FIREBASE_SERVICE_ACCOUNT) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}
const db = getFirestore();

const model = new ChatGoogleGenerativeAI({
  modelName: "gemini-pro",
  maxOutputTokens: 2048,
});

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
  memory_facts: null
};

// --- ROUTING LOGIC ---

/**
 * STEP A — Router node
 * Acts as the final authority for the graph path.
 */
function nodeRoute(state) {
  if (state.triage === "high") return "emergency";
  if (state.needs_doctor) return "escalation";
  return "retrieve";
}

// --- CORE NODES ---

async function nodeLoadMemory(state) {
  let { appId, userId, sessionId } = state;
  if (!sessionId) sessionId = randomUUID();
  if (!db || !userId) return { ...state, sessionId };

  const shortRef = db.doc(`artifacts/${appId}/users/${userId}/agent_memory_short/${sessionId}`);
  const shortSnap = await shortRef.get();
  const shortSummary = shortSnap.exists ? shortSnap.data().summary : "";

  const longSnap = await db
    .collection(`artifacts/${appId}/users/${userId}/agent_memory_long`)
    .orderBy("lastSeenAt", "desc")
    .limit(5)
    .get();

  const longFacts = longSnap.docs.map(d => d.data());

  return { ...state, sessionId, memory_summary: shortSummary, memory_facts: longFacts };
}

/**
 * STEP 1: Explicit Escalation Criteria in nodeAnalyze
 */
async function nodeAnalyze(state) {
  const prompt = `
    You are a medical pre-screening AI.

    You must classify triage using the following STRICT rules:

    TRIAGE DEFINITIONS:

    HIGH:
    - Chest pain, breathing difficulty, fainting, seizures
    - Severe bleeding, sudden weakness, confusion
    - Symptoms involving heart, brain, lungs
    - Worsening symptoms with past high-risk history
    - Any symptom suggesting immediate danger

    MEDIUM:
    - Persistent symptoms (>48 hours)
    - Symptoms interfering with daily life
    - Concerning but non-acute pain
    - Requires doctor evaluation but not emergency

    LOW:
    - Mild, short-term, improving symptoms
    - General health questions
    - Preventive or informational queries

    PAST CONTEXT SUMMARY: ${state.memory_summary || "None"}
    KNOWN USER FACTS: ${JSON.stringify(state.memory_facts || [])}
    CURRENT USER MESSAGE: ${state.message}

    Respond ONLY in valid JSON:
    {
      "category": "symptoms | test_report | general_question",
      "triage": "low | medium | high",
      "needs_doctor": true,
      "followup_question": "string"
    }
  `;

  const response = await model.invoke(prompt);
  let result;
  
  try {
    result = JSON.parse(response.content);
  } catch (err) {
    console.error("Invalid JSON from analyze node:", response.content);
    result = { 
        category: "general_question", 
        triage: "low", 
        needs_doctor: false, 
        followup_question: "" 
    };
  }

  // --- STEP 2: RULE ENGINE PRIORITY ---
  // You can still manually override LLM triage here if hard rules are triggered
  let finalTriage = result.triage;
  let finalNeedsDoctor = result.needs_doctor;

  // Example: If message contains hard-coded danger words, force high triage
  const highRiskKeywords = ["chest pain", "can't breathe", "seizure"];
  if (highRiskKeywords.some(word => state.message.toLowerCase().includes(word))) {
    finalTriage = "high";
  }

  return {
    ...state,
    category: result.category,
    triage: finalTriage,
    needs_doctor: finalNeedsDoctor,
    followup_question: result.followup_question
  };
}

/**
 * STEP B — Emergency path
 */
async function nodeEmergency(state) {
  const prompt = `
    You are a medical safety assistant. The situation is HIGH RISK.
    User message: ${state.message}
    Instructions:
    - Be calm but firm
    - Emphasize urgency
    - Recommend emergency services if appropriate
    - NO diagnosis
    - NO medication advice
  `;
  const response = await model.invoke(prompt);
  return { ...state, answer: response.content, sources: ["Emergency Safety Protocol"] };
}

/**
 * STEP C — Escalation path
 */
async function nodeEscalation(state) {
  const prompt = `
    You are a medical assistant. Professional evaluation is advised.
    User message: ${state.message}
    Explain:
    - Why a doctor visit is recommended
    - What type of specialist may help
    - What symptoms to monitor
    - When to seek urgent care
    Do NOT diagnose.
  `;
  const response = await model.invoke(prompt);
  return { ...state, answer: response.content, sources: ["Clinical Care Guidance"] };
}

async function nodeRetrieve(state) {
  const mockContext = "MedlinePlus suggests standard care involves monitoring symptoms and hydration.";
  return { ...state, context: mockContext };
}

async function nodeFinal(state) {
  const prompt = `
    Context: ${state.context}
    User message: ${state.message}
    If a follow-up question exists, ask it clearly.
    Follow-up question: ${state.followup_question || "None"}
    Provide a safe, clear medical response.
  `;
  const response = await model.invoke(prompt);
  return { ...state, answer: response.content, sources: ["MedlinePlus Database"] };
}

async function nodeStoreMemory(state) {
  const { appId, userId, sessionId } = state;
  if (!db || !userId) return state;

  const summaryPrompt = `Summarize this medical exchange in 3 lines.\nUser: ${state.message}\nAssistant: ${state.answer}`;
  const summaryRes = await model.invoke(summaryPrompt);
  
  await db.doc(`artifacts/${appId}/users/${userId}/agent_memory_short/${sessionId}`).set({
    summary: summaryRes.content,
    lastUpdatedAt: Date.now()
  }, { merge: true });

  if (state.triage === "high" || state.needs_doctor) {
    await db.collection(`artifacts/${appId}/users/${userId}/agent_memory_long`).add({
      type: "risk",
      value: state.message.slice(0, 200),
      confidence: 0.9,
      lastSeenAt: Date.now(),
      source: "agent"
    });
  }
  return state;
}

// --- WORKFLOW CONSTRUCTION ---

const workflow = new StateGraph({ channels: graphState })
  .addNode("load_memory", nodeLoadMemory)
  .addNode("analyze", nodeAnalyze)
  .addNode("route", nodeRoute)
  .addNode("emergency", nodeEmergency)
  .addNode("escalation", nodeEscalation)
  .addNode("retrieve", nodeRetrieve)
  .addNode("final", nodeFinal)
  .addNode("store_memory", nodeStoreMemory);

workflow.setEntryPoint("load_memory");
workflow.addEdge("load_memory", "analyze");

// STEP D: Conditional Edges
workflow.addConditionalEdges(
  "analyze",
  nodeRoute,
  {
    emergency: "emergency",
    escalation: "escalation",
    retrieve: "retrieve",
  }
);

workflow.addEdge("retrieve", "final");
workflow.addEdge("final", "store_memory");
workflow.addEdge("emergency", "store_memory");
workflow.addEdge("escalation", "store_memory");
workflow.addEdge("store_memory", END);

export const graph = workflow.compile();
