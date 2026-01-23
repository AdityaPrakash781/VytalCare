import { StateGraph, END } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
// --- FIREBASE ADMIN SDK ---
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Initialize Firebase Admin only if not already initialized
if (!getApps().length && process.env.FIREBASE_SERVICE_ACCOUNT) {
  initializeApp({
    credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}
const db = getFirestore();
// -------------------------

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
  context: null,
  answer: null,
  sources: null,
  memory_summary: null, 
  memory_facts: null    
};

/**
 * 1. LOAD MEMORY NODE
 * Pulls summary and past facts from Firestore
 */
async function nodeLoadMemory(state) {
  const { appId, userId, sessionId } = state;
  if (!db || !userId) return state;

  const shortRef = db.doc(`artifacts/${appId}/users/${userId}/agent_memory_short/${sessionId}`);
  const shortSnap = await shortRef.get();
  const shortSummary = shortSnap.exists ? shortSnap.data().summary : "";

  const longSnap = await db
    .collection(`artifacts/${appId}/users/${userId}/agent_memory_long`)
    .orderBy("lastSeenAt", "desc")
    .limit(5)
    .get();

  const longFacts = longSnap.docs.map(d => d.data());

  return { ...state, memory_summary: shortSummary, memory_facts: longFacts };
}

/**
 * 2. ANALYZE NODE
 * Categorizes and triages with memory awareness
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
  const result = JSON.parse(response.content);

  return {
    ...state,
    category: result.category,
    triage: result.triage,
    needs_doctor: result.needs_doctor,
  };
}

/**
 * 3. RETRIEVE NODE
 * (Mock RAG - replace with your actual vector store logic)
 */
async function nodeRetrieve(state) {
  const mockContext = "MedlinePlus suggests that standard care for these symptoms involves monitoring and hydration.";
  return { ...state, context: mockContext };
}

/**
 * 4. FINAL ANSWER NODE
 * Generates the response for the user
 */
async function nodeFinal(state) {
  const prompt = `Based on context: ${state.context}, answer: ${state.message}`;
  const response = await model.invoke(prompt);
  return { 
    ...state, 
    answer: response.content, 
    sources: ["MedlinePlus Database"] 
  };
}

/**
 * 5. STORE MEMORY NODE
 * Updates conversation summary and stores facts
 */
async function nodeStoreMemory(state) {
  const { appId, userId, sessionId } = state;
  if (!db || !userId) return state;

  const summaryPrompt = `Summarize this medical exchange in 3 lines focusing on symptoms and risk.\nUser: ${state.message}\nAssistant: ${state.answer}`;
  const summaryRes = await model.invoke(summaryPrompt);
  
  await db.doc(`artifacts/${appId}/users/${userId}/agent_memory_short/${sessionId}`).set({
    summary: summaryRes.content,
    lastUpdatedAt: Date.now()
  }, { merge: true });

  if (state.triage === "high" || state.needs_doctor) {
    await db.collection(`artifacts/${appId}/users/${userId}/agent_memory_long`).add({
      type: "risk",
      value: state.category,
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
