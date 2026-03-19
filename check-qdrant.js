import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from "dotenv";
dotenv.config();

const client = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

async function check() {
  try {
    const info = await client.getCollection("medical_knowledge");
    console.log(JSON.stringify(info, null, 2));
  } catch (err) {
    console.error(err);
  }
}

check();
