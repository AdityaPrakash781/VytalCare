import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { QdrantClient } from "@qdrant/js-client-rest";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ✅ FIXED: correct embedding model
const embeddingModel = genAI.getGenerativeModel({
  model: "gemini-embedding-001",
});

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
  checkCompatibility: false,
});

// -------- SUMMARY CLEANER ----------
function extractSummaryText(summary) {
  if (!summary) return "";

  if (typeof summary === "string") {
    return summary.replace(/<[^>]*>/g, "").trim();
  }

  if (Array.isArray(summary)) {
    return summary.map(item => extractSummaryText(item)).join("\n").trim();
  }

  if (typeof summary === "object") {
    if (summary.content) return extractSummaryText(summary.content);

    const collected = [];
    for (const key in summary) {
      collected.push(extractSummaryText(summary[key]));
    }

    return collected.join("\n").trim();
  }

  return "";
}

// -------- ENTRY → TEXT ----------
function entryToText(entry) {
  const cleanSummary = extractSummaryText(entry.summary);

  return `
TITLE: ${entry.title?._value || entry.title}
URL: ${entry.url}

SUMMARY:
${cleanSummary}
  `.trim();
}

// -------- SLEEP HELPER ----------
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// -------- EMBED + UPLOAD ----------
export async function embedAndUpload(entries, term) {
  for (const entry of entries) {
    const text = entryToText(entry);
    
    // Rate limit prevention: Wait 2 seconds between embeddings
    console.log(`⏳ Waiting 2 seconds (Rate limit prevention)...`);
    await sleep(2000);

    // ✅ FIXED embedding call
    const result = await embeddingModel.embedContent(text);

    const vector = result.embedding.values;
    console.log(`📡 Preparing Qdrant upsert: Vector Size=${vector.length}, Term=${term}, Title=${entry.title?._value || entry.title}`);

    try {
      await qdrant.upsert("medical_knowledge", {
        points: [
          {
            id: Math.floor(Math.random() * 1000000000), // simpler int ID
            vector,
            payload: {
              term,
              title: typeof entry.title === 'string' ? entry.title : (entry.title?._value || JSON.stringify(entry.title)),
              summary: extractSummaryText(entry.summary),
              url: entry.url,
            },
          },
        ],
      });
    } catch (err) {
      console.error("❌ Qdrant upsert failed:", err.message);
      if (err.response?.data) console.error("Qdrant Error Data:", JSON.stringify(err.response.data, null, 2));
      throw err;
    }

    console.log(`✅ Uploaded embedding for: ${entry.title}`);
  }
}