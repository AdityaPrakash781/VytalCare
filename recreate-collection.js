import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from "dotenv";
dotenv.config();

const client = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

async function recreate() {
  try {
    console.log("Deleting collection: medical_knowledge");
    await client.deleteCollection("medical_knowledge");
    
    console.log("Creating collection: medical_knowledge (size: 3072)");
    await client.createCollection("medical_knowledge", {
      vectors: {
        size: 3072,
        distance: "Cosine"
      }
    });
    console.log("Success!");
  } catch (err) {
    console.error(err);
  }
}

recreate();
