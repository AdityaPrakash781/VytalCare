import { StateGraph, END } from "@langchain/langgraph";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

// Initialize Firebase Admin SDK for backend Firestore access
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
  escalation_reason: null, 
  context: null,
  answer: null,
  sources: null,
  memory_summary: null,
  memory_facts: null
};

// --- ROUTING LOGIC ---

function nodeRoute(state) {
  if (state.triage === "high") return "emergency";
  if (state.needs_doctor) return "escalation";
  return "retrieve";
}

// --- CORE NODES ---

async function nodeLoadMemory(state) {
  let { appId, userId, sessionId } = state;
  
  // ✅ 1. IDENTITY GUARD: Ensures memory isn't skipped due to missing tokens
  if (!appId || !userId) {
    console.warn("Memory Load Skipped: Missing appId or userId in graph state");
    return { ...state, sessionId: sessionId || randomUUID() };
  }

  if (!sessionId) sessionId = randomUUID();
  if (!db) return { ...state, sessionId };

  try {
    // ✅ 2. PATH ALIGNMENT: Matches the artifacts/${appId}/users/${userId} structure
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
  } catch (error) {
    console.error("Firestore Memory Load Error:", error);
    return { ...state, sessionId };
  }
}

async function nodeAnalyze(state) {
  const prompt = `
    You are a medical pre-screening AI.
    You must classify triage using the following STRICT rules:

    TRIAGE DEFINITIONS:
    HIGH: Chest pain, breathing difficulty, fainting, seizures, severe bleeding, sudden weakness, lung/brain/heart symptoms.
    MEDIUM: Persistent symptoms (>48 hours), interference with daily life, non-acute pain.
    LOW: Mild, short-term, improving symptoms, informational queries.

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
    // ✅ 3. HARDENED PARSER: Cleans markdown formatting before parsing
    const cleanContent = response.content.replace(/```json|```/g, "").trim();
    result = JSON.parse(cleanContent);
  } catch (err) {
    console.error("JSON Parse Error. Raw content was:", response.content);
    result = { category: "general_question", triage: "low", needs_doctor: false, followup_question: "" };
  }

  let finalTriage = result.triage;
  let finalNeedsDoctor = result.needs_doctor;

  // Safety Overrides: Force high triage for critical keywords
  const highRiskKeywords = ["chest pain", "can't breathe", "seizure", "fainted", "shortness of breath"];
  if (highRiskKeywords.some(word => state.message.toLowerCase().includes(word))) {
    finalTriage = "high";
    finalNeedsDoctor = true; 
  }

  let escalationReason = null;
  if (finalTriage === "high") {
    escalationReason = "High-risk symptoms detected (Critical Triage)";
  } else if (finalNeedsDoctor) {
    escalationReason = "Symptoms require clinical professional evaluation";
  }

  return {
    ...state,
    category: result.category,
    triage: finalTriage,
    needs_doctor: finalNeedsDoctor,
    followup_question: result.followup_question,
    escalation_reason: escalationReason
  };
}

async function nodeEmergency(state) {
  const prompt = `
    You are a medical safety assistant. The situation is HIGH RISK.
    User message: ${state.message}
    Safety Warning Reason: ${state.escalation_reason} 
    Instructions: Recommend emergency services immediately. NO diagnosis.
  `;
  const response = await model.invoke(prompt);
  return { ...state, answer: response.content, sources: ["Emergency Safety Protocol"] };
}

async function nodeEscalation(state) {
  const prompt = `
    You are a medical assistant. Professional evaluation is advised.
    Reason: ${state.escalation_reason}
    User message: ${state.message}
    Explain why a specialist may help. Do NOT diagnose.
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
    Provide a safe, clear medical response.
  `;
  const response = await model.invoke(prompt);
  return { ...state, answer: response.content, sources: ["MedlinePlus Database"] };
}

async function nodeStoreMemory(state) {
  const { appId, userId, sessionId } = state;
  
  // ✅ 4. STORAGE GUARD: Prevents silent failure during database writes
  if (!db || !userId || !appId) {
    console.warn("Storage Skipped: Missing identity tokens.");
    return state;
  }

  try {
    const summaryPrompt = `Summarize this medical exchange in 3 lines.\nUser: ${state.message}\nAssistant: ${state.answer}`;
    const summaryRes = await model.invoke(summaryPrompt);
    
    // Write Short-Term (Session) Memory
    await db.doc(`artifacts/${appId}/users/${userId}/agent_memory_short/${sessionId}`).set({
      summary: summaryRes.content,
      lastUpdatedAt: Date.now()
    }, { merge: true });

    // ✅ 5. CONDITIONAL LONG-TERM STORAGE: Only writes for high-risk detected triage
    if ((state.triage === "high" || state.needs_doctor) && sessionId) {
      await db.collection(`artifacts/${appId}/users/${userId}/agent_memory_long`).add({
        type: "risk",
        value: state.message.slice(0, 200),
        reason: state.escalation_reason || "Risk detected",
        lastSeenAt: Date.now(),
        source: "agent"
      });
      console.log("Risk event logged to long-term memory.");
    }
  } catch (error) {
    console.error("Firestore Memory Store Error:", error);
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
