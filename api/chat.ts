import type { VercelRequest, VercelResponse } from '@vercel/node';
import { 
  VectorStoreIndex, 
  RetrieverQueryEngine,
  Settings
} from "llamaindex";

// FIXED: Import correct enums for Gemini model typing
import { 
  Gemini, 
  GeminiEmbedding,
  GEMINI_MODEL,
  GEMINI_EMBEDDING_MODEL
} from "@llamaindex/google";

// FIX 1: Correct Imports from separate packages
import { PineconeVectorStore } from "@llamaindex/pinecone";

// --- GLOBAL CONFIGURATION ---

// FIX 2: Configure Gemini using correct enums
// FIX: Add 'as any' to bypass strict type checking
Settings.llm = new Gemini({
  model: "models/gemini-1.5-flash" as any, 
  apiKey: process.env.GOOGLE_API_KEY,
  temperature: 0.1
});

Settings.embedModel = new GeminiEmbedding({
  model: GEMINI_EMBEDDING_MODEL.TEXT_EMBEDDING_004,
  apiKey: process.env.GOOGLE_API_KEY
});

// Helper: Get retriever for specific namespace
async function getRetriever(namespace: string, topK = 3) {

  // FIX 3: Initialize PineconeVectorStore directly with correct params
  const vectorStore = new PineconeVectorStore({ 
    indexName: process.env.PINECONE_INDEX_NAME!,
    apiKey: process.env.PINECONE_API_KEY!,
    namespace 
  });
  
  const index = await VectorStoreIndex.fromVectorStore(vectorStore);
  return index.asRetriever({ similarityTopK: topK });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS Handling
  if (req.method === 'OPTIONS') {
    return res.status(200).send('ok');
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message, metrics } = req.body;

    // 1. Safety Check
    const emergencyKeywords = ["chest pain", "crushing", "suicide", "bleeding profusely"];
    if (emergencyKeywords.some(k => message.toLowerCase().includes(k))) {
      return res.status(200).json({ 
        role: "model", 
        text: "⚠️ MEDICAL EMERGENCY DETECTED: Please stop using this app and call emergency services (108 / 911) immediately." 
      });
    }

    // 2. Build Context
    const contextStr = `
      User Health Profile:
      - Steps Today: ${metrics?.steps || "N/A"}
      - Heart Rate: ${metrics?.heartRate || "Unknown"}bpm
      - Sleep: ${metrics?.sleep || "Unknown"} hrs
      - Meds: ${metrics?.takenMeds?.join(", ") || "None"}
    `;

    // 3. Routing (Simple)
    let namespace = "medical-knowledge";
    const lowerMsg = message.toLowerCase();
    if (lowerMsg.includes("pill") || lowerMsg.includes("drug") || lowerMsg.includes("dose")) {
      namespace = "drug-safety";
    }

    // 4. Retrieval & Generation
    const retriever = await getRetriever(namespace);
    const queryEngine = new RetrieverQueryEngine(retriever);

    const prompt = `
      Context Information is below.
      ---------------------
      ${contextStr}
      ---------------------
      Given the context information and your medical knowledge, answer the query.
      Disclaimer: You are an AI health assistant, not a doctor.
      Query: ${message}
    `;

    const response = await queryEngine.query({ query: prompt });

    return res.status(200).json({
      role: "model",
      text: response.toString(),
      sources: response.sourceNodes?.map(node => ({
        title: "Medical Database",
        uri: (node.node.metadata as any)?.source || "VytalCare Knowledge Base"
      }))
    });

  } catch (error: any) {
    console.error("Gemini RAG Error:", error);
    return res.status(500).json({ error: error.message || "Internal Server Error" });
  }
}
