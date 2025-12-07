import {
  VectorStoreIndex,
  storageContextFromDefaults,
  Settings,
  Document
} from "llamaindex";
import { GeminiEmbedding } from "@llamaindex/google";
import { PineconeVectorStore } from "@llamaindex/pinecone";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

// Load environment variables immediately
dotenv.config();

// FIX: Use 'as any' to allow newer model strings
Settings.embedModel = new GeminiEmbedding({
  model: "models/text-embedding-004" as any, 
  apiKey: process.env.GOOGLE_API_KEY
});

function loadDocuments(folder: string): Document[] {
  if (!fs.existsSync(folder)) {
    console.warn(`Folder not found: ${folder}`);
    return [];
  }
  
  const files = fs.readdirSync(folder);
  return files.map((file) => {
    const filePath = path.join(folder, file);
    if (fs.statSync(filePath).isDirectory()) return new Document({ text: "", id_: "skip" });
    const text = fs.readFileSync(filePath, "utf8");
    return new Document({ text, id_: file });
  }).filter(doc => doc.id_ !== "skip");
}

async function indexData(folder: string, namespace: string) {
  console.log(`Indexing → ${namespace}`);

  const documents = loadDocuments(folder);
  if (documents.length === 0) {
    console.log(`⚠ No documents in ${folder}`);
    return;
  }

  // FIX: Pass apiKey directly (Removed 'db' parameter)
  const vectorStore = new PineconeVectorStore({
    indexName: process.env.PINECONE_INDEX_NAME!,
    apiKey: process.env.PINECONE_API_KEY!,
    namespace,
  });

  const storageContext = await storageContextFromDefaults({
    vectorStore,
  });

  await VectorStoreIndex.fromDocuments(documents, { storageContext });

  console.log(`✅ Uploaded ${documents.length} docs → ${namespace}`);
}

async function main() {
  // Ensure your .env has GOOGLE_API_KEY defined!
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error("Missing GOOGLE_API_KEY in .env file. Please check your .env file.");
  }
  await indexData("./data/medical", "medical-knowledge");
  await indexData("./data/drug_safety", "drug-safety");
}

main().catch(console.error);