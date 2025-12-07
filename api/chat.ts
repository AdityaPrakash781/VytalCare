import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  VectorStoreIndex,
  Settings,
} from "llamaindex";
import { PineconeVectorStore } from "@llamaindex/pinecone";
import { GeminiEmbedding } from "@llamaindex/google";

// ------------------------------------------
// GLOBAL CONFIG — Embeddings only
// (We don't use LlamaIndex's Gemini LLM anymore)
// ------------------------------------------

Settings.embedModel = new GeminiEmbedding({
  model: "models/text-embedding-004" as any,
  apiKey: process.env.GOOGLE_API_KEY,
});

// ------------------------------------------
// Helper: Retrieve vector index based on namespace
// ------------------------------------------
async function getRetriever(namespace: string, topK = 3) {
  const vectorStore = new PineconeVectorStore({
    indexName: process.env.PINECONE_INDEX_NAME!,
    apiKey: process.env.PINECONE_API_KEY!,
    namespace,
  });

  const index = await VectorStoreIndex.fromVectorStore(vectorStore);
  return index.asRetriever({ similarityTopK: topK });
}

// ------------------------------------------
// Helper: Call Gemini HTTP API directly
// ------------------------------------------
async function callGeminiLLM(prompt: string) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_API_KEY");

  // ✅ Correct endpoint for your API key
  const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini API error: ${resp.status} ${err}`);
  }

  const data: any = await resp.json();
  const text =
    data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("\n") ??
    "";

  if (!text) throw new Error("Gemini returned an empty response");

  return text;
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

    // Safe defaults
    const profile = metrics?.profile || {};
    const steps = metrics?.steps ?? "N/A";
    const sleep = metrics?.sleep ?? "Unknown";
    const heartRate = metrics?.heartRate ?? "Unknown";
    const takenMeds: string[] = metrics?.takenMeds ?? [];

    // ------------------------------------------
    // EMERGENCY DETECTION
    // ------------------------------------------
    const emergencyKeywords = [
      "chest pain",
      "crushing",
      "suicide",
      "bleeding profusely",
    ];

    if (emergencyKeywords.some(k => message.toLowerCase().includes(k))) {
      return res.status(200).json({
        role: "model",
        text:
          "⚠️ MEDICAL EMERGENCY DETECTED: Please stop using this app and call emergency services (108 / 911) immediately.",
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

Profile (if available):
- Name: ${profile.userName || "Unknown"}
- Age: ${profile.userAge || "Unknown"}
- Conditions: ${profile.conditions || "Not specified"}
`.trim();

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
    // RAG: Retrieve from Pinecone (no query engine)
    // ------------------------------------------
    const retriever = await getRetriever(namespace);
    const retrievedNodes: any[] = await retriever.retrieve(message);

    const ragContext = retrievedNodes
      .map((n, idx) => {
        const text = (n.node as any)?.text || "";
        return `Source ${idx + 1}:\n${text}`;
      })
      .join("\n\n");

    // ------------------------------------------
    // Build final prompt for Gemini
    // ------------------------------------------
    const finalPrompt = `
You are VytalCare, a careful and safety-focused AI health assistant.
Use the user's health metrics and the retrieved medical context below to answer their question.
Always include a short safety disclaimer and tell the user to consult a doctor for decisions.

=== USER HEALTH METRICS ===
${contextStr}

=== RETRIEVED CONTEXT (from knowledge base) ===
${ragContext || "No extra context retrieved."}

=== USER QUESTION ===
${message}

Now provide a clear, concise, and reassuring answer.
`.trim();

    // Call Gemini directly
    const answerText = await callGeminiLLM(finalPrompt);

    // Build sources list from retrieved nodes
    const sources =
      retrievedNodes?.map((node, i) => ({
        title: `Medical Database Source ${i + 1}`,
        uri:
          (node.node.metadata as any)?.source ||
          "VytalCare Knowledge Base",
      })) || [];

    // Return to frontend
    return res.status(200).json({
      role: "model",
      text: answerText,
      sources,
    });
  } catch (error: any) {
    console.error("Gemini RAG Error:", error);
    return res
      .status(500)
      .json({ error: error?.message || "Internal Server Error" });
  }
}
