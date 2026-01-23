import { StateGraph, END } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
// FIX 3: Enforce session lifecycle
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

// FIX 2: Add followup_question to graph state
const graphState = {
  message: null,
  appId: null,
  userId: null,
  sessionId: null,
  category: null,
  triage: null,
  needs_doctor: null,
  followup_question: null, // Added for UX
  context: null,
  answer: null,
  sources: null,
  memory_summary: null,
  memory_facts: null
};

/**
 * 1. LOAD MEMORY NODE
 * FIX 3: Implicit session management to prevent data corruption
 */
async function nodeLoadMemory(state) {
  let { appId, userId, sessionId } = state;

  // Enforce session ID presence
  if (!sessionId) {
    sessionId = randomUUID();
  }

  if (!db || !userId) {
    return { ...state, sessionId };
  }

  const shortRef = db.doc(`artifacts/${appId}/users/${userId}/agent_memory_short/${sessionId}`);
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
    sessionId, // Persist ID
    memory_summary: shortSummary, 
    memory_facts: longFacts 
  };
}

/**
 * 2. ANALYZE NODE
 * FIX 1: Crash-safe JSON parsing and follow-up return
 */
async function nodeAnalyze(state) {
  const prompt = `
    You are a medical pre-screening AI.
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
  
  // MANDATORY: Error handling for LLM output
  try {
    result = JSON.parse(response.content);
  } catch (err) {
    console.error("Invalid JSON from analyze node. Raw content:", response.content);
    result = {
      category: "general_question",
      triage: "low",
      needs_doctor: false,
      followup_question: ""
    };
  }

  return {
    ...state,
    category: result.category,
    triage: result.triage,
    needs_doctor: result.needs_doctor,
    followup_question: result.followup_question // FIX 2: Propagate followup
  };
}

/**
 * 3. RETRIEVE NODE
 */
async function nodeRetrieve(state) {
  const mockContext = "MedlinePlus suggests standard care involves monitoring symptoms and maintaining hydration.";
  return { ...state, context: mockContext };
}

/**
 * 4. FINAL ANSWER NODE
 * FIX 2: Intentional follow-up question usage
 */
async function nodeFinal(state) {
  const prompt = `
    Context: ${state.context}
    User message: ${state.message}
    If a follow-up question exists, ask it clearly.
    Follow-up question: ${state.followup_question || "None"}
    Provide a safe, clear medical response.
  `;
  const response = await model.invoke(prompt);
  return { 
    ...state, 
    answer: response.content, 
    sources: ["MedlinePlus Database"] 
  };
}

/**
 * 5. STORE MEMORY NODE
 * FIX 4: Enhanced signal for long-term memory
 */
async function nodeStoreMemory(state) {
  const { appId, userId, sessionId } = state;
  if (!db || !userId) return state;

  const summaryPrompt = `Summarize this medical exchange in 3 lines.\nUser: ${state.message}\nAssistant: ${state.answer}`;
  const summaryRes = await model.invoke(summaryPrompt);
  
  await db.doc(`artifacts/${appId}/users/${userId}/agent_memory_short/${sessionId}`).set({
    summary: summaryRes.content,
    lastUpdatedAt: Date.now()
  }, { merge: true });

  // Increased signal: store actual user message content
  if (state.triage === "high" || state.needs_doctor) {
    await db.collection(`artifacts/${appId}/users/${userId}/agent_memory_long`).add({
      type: "risk",
      value: state.message.slice(0, 200), // Meaningful context
      confidence: 0.9,
      lastSeenAt: Date.now(),
      source: "agent"
    });
  }

  return state;
}

// WORKFLOW CONSTRUCTION
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
