import {
  VectorStoreIndex,
  storageContextFromDefaults,
  Settings,
  Document
} from "llamaindex";

// 1. Integrations
import { GeminiEmbedding } from "@llamaindex/google";
import { PineconeVectorStore } from "@llamaindex/pinecone";

// (We removed the manual 'Pinecone' import because the VectorStore handles connection now)

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

// 2. Configure Gemini
// FIX 1: We add 'as any' to bypass the TypeScript check. 
// The library doesn't know "text-embedding-004" exists yet, but the API accepts it.
Settings.embedModel = new GeminiEmbedding({
  model: "models/text-embedding-004" as any,
  apiKey: process.env.GOOGLE_API_KEY
});
// ---------- Load Documents ----------
function loadDocuments(folder: string): Document[] {
  if (!fs.existsSync(folder)) {
    console.warn(`Folder not found: ${folder}`);
    return [];
  }
  
  const files = fs.readdirSync(folder);
  return files.map((file) => {
    const filePath = path.join(folder, file);
    // Only read files, skip sub-directories
    if (fs.statSync(filePath).isDirectory()) return new Document({ text: "", id_: "skip" });
    
    const text = fs.readFileSync(filePath, "utf8");
    return new Document({ text, id_: file });
  }).filter(doc => doc.id_ !== "skip");
}

// ---------- Indexing Function ----------
async function indexData(folder: string, namespace: string) {
  console.log(`Indexing → ${namespace}`);

  const documents = loadDocuments(folder);
  if (documents.length === 0) {
    console.log(`⚠ No documents in ${folder}`);
    return;
  }

  // FIX 2: Removed 'db: pinecone'. 
  // Instead, we pass 'apiKey' directly. The store will create its own secure connection.
  // FIX: Removed 'db', added 'apiKey'
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

// ---------- Main ----------
async function main() {
  await indexData("./data/medical", "medical-knowledge");
  await indexData("./data/drug_safety", "drug-safety");
}

main().catch(console.error);