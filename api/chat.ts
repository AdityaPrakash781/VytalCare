import type { VercelRequest, VercelResponse } from '@vercel/node';
import { 
  VectorStoreIndex, 
  RetrieverQueryEngine,
  Settings
} from "llamaindex";
import { PineconeVectorStore } from "@llamaindex/pinecone";
import { Gemini, GeminiEmbedding } from "@llamaindex/google";

// ------------------------------------------
// GLOBAL CONFIG — Gemini + Embeddings
// ------------------------------------------

Settings.llm = new Gemini({
  model: "models/gemini-1.5-flash" as any,
  apiKey: process.env.GOOGLE_API_KEY,
  temperature: 0.1
});

Settings.embedModel = new GeminiEmbedding({
  model: "models/text-embedding-004" as any,
  apiKey: process.env.GOOGLE_API_KEY
});

// ------------------------------------------
// Helper: Retrieve vector index based on namespace
// ------------------------------------------
async function getRetriever(namespace: string, topK = 3) {
  const vectorStore = new PineconeVectorStore({
    indexName: process.env.PINECONE_INDEX_NAME!,
    apiKey: process.env.PINECONE_API_KEY!,
    namespace
  });

  const index = await VectorStoreIndex.fromVectorStore(vectorStore);
  return index.asRetriever({ similarityTopK: topK });
}

// ------------------------------------------
// MAIN HANDLER
// ------------------------------------------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  if (req.method === "OPTIONS") {
    return res.status(200).send("ok");
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message, metrics } = req.body;

    // Ensure values exist even if frontend sends partial payload
    const profile = metrics?.profile || {};
    const steps = metrics?.steps ?? "N/A";
    const sleep = metrics?.sleep ?? "Unknown";
    const heartRate = metrics?.heartRate ?? "Unknown";
    const takenMeds = metrics?.takenMeds ?? [];

    // ------------------------------------------
    // EMERGENCY DETECTION
    // ------------------------------------------
    const emergencyKeywords = [
      "chest pain",
      "crushing",
      "suicide",
      "bleeding profusely"
    ];

    if (emergencyKeywords.some(k => message.toLowerCase().includes(k))) {
      return res.status(200).json({
        role: "model",
        text: "⚠️ MEDICAL EMERGENCY DETECTED: Please stop using this app and call emergency services (108 / 911) immediately."
      });
    }

    // ------------------------------------------
    // HEALTH CONTEXT STRING
    // ------------------------------------------
    const contextStr = `
      User Health Profile:
      - Steps Today: ${steps}
      - Heart Rate: ${heartRate}
      - Sleep: ${sleep} hrs
      - Medications Taken: ${takenMeds.join(", ") || "None"}
    `;

    // ------------------------------------------
    // SELECT VECTOR NAMESPACE
    // ------------------------------------------
    let namespace = "medical-knowledge";
    const lowerMsg = message.toLowerCase();

    if (
      lowerMsg.includes("pill") ||
      lowerMsg.includes("drug") ||
      lowerMsg.includes("dose")
    ) {
      namespace = "drug-safety";
    }

    // ------------------------------------------
    // VECTOR RETRIEVER + RAG QUERY ENGINE
    // ------------------------------------------
    const retriever = await getRetriever(namespace);
    const queryEngine = new RetrieverQueryEngine(retriever);

    const prompt = `
      Context Information is below.
      ---------------------
      ${contextStr}
      ---------------------
      Given the context information and your medical knowledge, answer the query.
      Disclaimer: You are an AI assistant, not a doctor.
      Query: ${message}
    `;

    const response = await queryEngine.query({ query: prompt });

    // ------------------------------------------
    // RETURN RESPONSE
    // ------------------------------------------
    return res.status(200).json({
      role: "model",
      text: response.toString(),
      sources: response?.sourceNodes?.map(node => ({
        title: "Medical Database",
        uri: (node.node.metadata as any)?.source || "VytalCare Knowledge Base"
      })) || []
    });

  } catch (error: any) {
    console.error("Gemini RAG Error:", error);
    return res.status(500).json({ error: error?.message || "Internal Server Error" });
  }
}
