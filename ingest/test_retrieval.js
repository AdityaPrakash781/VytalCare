import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";

dotenv.config();

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
  checkCompatibility: false,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ✅ FIXED
const embeddingModel = genAI.getGenerativeModel({
  model: "gemini-embedding-001",
});

async function testSearch(query) {
  console.log("🔎 Embedding query:", query);

  const result = await embeddingModel.embedContent(query);

  const vector = result.embedding.values;

  const results = await qdrant.search("medical_knowledge", {
    vector,
    limit: 3,
  });

  console.log("📌 Top matches:");
  console.log(JSON.stringify(results, null, 2));
}

testSearch("What is fever?");