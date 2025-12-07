import type { VercelRequest, VercelResponse } from '@vercel/node';
import { 
  VectorStoreIndex, 
  RetrieverQueryEngine,
  Settings
} from "llamaindex";
import { PineconeVectorStore } from "@llamaindex/pinecone";
import { Gemini, GeminiEmbedding } from "@llamaindex/google";

// --- GLOBAL CONFIGURATION ---

// FIX: Use 'as any' to bypass strict Enum checks for newer models
Settings.llm = new Gemini({
  model: "models/gemini-1.5-flash" as any,
  apiKey: process.env.GOOGLE_API_KEY,
  temperature: 0.1
});

Settings.embedModel = new GeminiEmbedding({
  model: "models/text-embedding-004" as any,
  apiKey: process.env.GOOGLE_API_KEY
});

// Helper: Get retriever for specific namespace
async function getRetriever(namespace: string, topK = 3) {
  // FIX: Initialize PineconeVectorStore directly with API Key (no 'db' param)
  const vectorStore = new PineconeVectorStore({ 
    indexName: process.env.PINECONE_INDEX_NAME!,
    apiKey: process.env.PINECONE_API_KEY!,
    namespace 
  });
  
  const index = await VectorStoreIndex.fromVectorStore(vectorStore);
  return index.asRetriever({ similarityTopK: topK });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS / Method Handling
  if (req.method === 'OPTIONS') {
    return res.status(200).send('ok');
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message, metrics } = req.body;
    // FIX: Prevent undefined variable error when metrics.profile exists (frontend sends it)
    const profile = metrics?.profile || {};

    // Safety Checks
    const emergencyKeywords = ["chest pain", "crushing", "suicide", "bleeding profusely"];
    if (emergencyKeywords.some(k => message.toLowerCase().includes(k))) {
      return res.status(200).json({ 
        role: "model", 
        text: "⚠️ MEDICAL EMERGENCY DETECTED: Please stop using this app and call emergency services (108 / 911) immediately." 
      });
    }

    const contextStr = `
      User Health Profile:
      - Steps Today: ${metrics?.steps || "N/A"}
      - Heart Rate: ${metrics?.heartRate || "Unknown"}
      - Sleep: ${metrics?.sleep || "Unknown"} hrs
      - Meds: ${metrics?.takenMeds?.join(", ") || "None"}
    `;

    let namespace = "medical-knowledge";
    const lowerMsg = message.toLowerCase();
    if (lowerMsg.includes("pill") || lowerMsg.includes("drug") || lowerMsg.includes("dose")) {
      namespace = "drug-safety";
    }

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