import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { QdrantClient } from "@qdrant/js-client-rest";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ✅ FIXED embedding model
const embeddingModel = genAI.getGenerativeModel({
  model: "gemini-embedding-001",
});

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
  checkCompatibility: false,
});

export async function retrieveContext(query, topK = 3) {
  console.log(`🔎 Embedding user query: "${query}"`);

  // ✅ FIXED embedding request
  const result = await embeddingModel.embedContent(query);

  const queryVector = result.embedding.values;

  const searchResult = await qdrant.search("medical_knowledge", {
    vector: queryVector,
    limit: topK,
  });

  console.log(`📡 Found ${searchResult.length} documents.`);

  const context = searchResult
    .map((hit, i) => {
      const p = hit.payload;

      return `
[RESULT ${i + 1}]
TITLE: ${p.title}
URL: ${p.url}

SUMMARY:
${p.summary}
`;
    })
    .join("\n");

  return context.trim();
}