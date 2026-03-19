import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from "dotenv";
dotenv.config();

const client = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
  checkCompatibility: false, // optional fix
});

async function createCollection() {
  await client.createCollection("medical_knowledge", {
    vectors: {
      size: 3072, // ✅ FIXED (Gemini embedding size)
      distance: "Cosine",
    },
  });

  console.log("Qdrant collection created: medical_knowledge");
}

createCollection();