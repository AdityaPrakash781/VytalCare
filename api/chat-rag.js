// /api/chat-rag.js (REPLACE your existing file with this)
import dotenv from "dotenv";
import fetch from "node-fetch";
import { QdrantClient } from "@qdrant/js-client-rest";

dotenv.config();

// Try to import medicalGraph (LangGraph) but don't hard-fail if it's broken
let medicalGraph = null;
try {
  // this may throw at import-time in some LangGraph misconfigs; catch it
  // eslint-disable-next-line import/no-unresolved
  // Note: keep this dynamic so serverless cold starts don't crash if module breaks
  // Caller will check medicalGraph !== null
  medicalGraph = (await import("../workflow/medical-graph.js")).default;
} catch (e) {
  console.warn("LangGraph import failed — falling back to direct RAG. Error:", e?.message || e);
  medicalGraph = null;
}

// Qdrant client
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL || "",
  apiKey: process.env.QDRANT_API_KEY || "",
  // disable compatibility check to avoid noisy logs if you want:
  checkCompatibility: process.env.QDRANT_CHECK_COMPAT !== "false"
});

// ---------- Helpers: Gemini REST (2.5 Flash) and Embeddings ----------
const GEMINI_MODEL = "models/gemini-2.5-flash";
const EMBED_MODEL = "models/text-embedding-004";

const GEMINI_URL = (key) =>
  `https://generativelanguage.googleapis.com/v1/${GEMINI_MODEL}:generateContent?key=${key}`;

const EMBED_URL = (key) =>
  `https://generativelanguage.googleapis.com/v1/${EMBED_MODEL}:embedContent?key=${key}`;

async function generateGeminiResponse(apiKey, prompt, timeoutMs = 20000) {
  if (!apiKey) throw new Error("GEMINI API key missing for fallback path");
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const payload = {
      // simple single-user text content; we supply the whole prompt
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ]
    };

    const r = await fetch(GEMINI_URL(apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(id);

    const json = await r.json();
    if (!r.ok) {
      const errMsg = json?.error?.message || `${r.status} ${r.statusText}`;
      throw new Error(`Gemini REST error: ${errMsg}`);
    }

    return json?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("\n\n") || "";
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function embedText(apiKey, text, timeoutMs = 15000) {
  if (!apiKey) throw new Error("GEMINI API key missing for embeddings");
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(EMBED_URL(apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] }
      }),
      signal: controller.signal
    });
    clearTimeout(id);
    const json = await resp.json();
    if (!resp.ok) {
      throw new Error(`Embed failed: ${json?.error?.message || resp.status}`);
    }
    const vals = json?.embedding?.values;
    if (!vals) throw new Error("Embedding response missing");
    return vals;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// ---------- Utility: format context items ----------
function formatRetrievedContext(items) {
  if (!items || !items.length) return "No retrieved medical documents.";
  return items.map((r, i) => {
    const title = r.payload?.title || "Untitled";
    const summary = r.payload?.summary || "(No summary)";
    const url = r.payload?.url || "No URL found";
    return `[Document ${i + 1}]
TITLE: ${title}
SUMMARY: ${summary}
URL: ${url}
`;
  }).join("\n");
}

// ---------- Safe timeout helper ----------
const timeoutPromise = (ms, message = "timeout") => new Promise((_, rej) => setTimeout(() => rej(new Error(message)), ms));

// ---------- Main handler ----------
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  // Basic validation
  const body = req.body || {};
  const message = body.message?.toString?.() || "";
  const history = Array.isArray(body.history) ? body.history : [];

  if (!message) {
    return res.status(400).json({ error: "Missing 'message' field" });
  }

  // Check required environment
  const geminiKey = process.env.GEMINI_API_KEY;
  const qdrantUrl = process.env.QDRANT_URL;
  const qdrantKey = process.env.QDRANT_API_KEY;

  // Helpful logs for debugging in Vercel
  console.log("RAG Request received. message length:", message.length, "history length:", history.length);
  console.log("Env present:", {
    hasGemini: Boolean(geminiKey),
    hasQdrantUrl: Boolean(qdrantUrl),
    hasQdrantKey: Boolean(qdrantKey),
    usingLangGraph: !!medicalGraph
  });

  // Try LangGraph path first (if available)
  if (medicalGraph) {
    try {
      // small retry loop with backoff around medicalGraph.invoke
      const maxRetries = 2;
      let lastErr = null;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          // ensure invoke completes quickly — wrap with timeout
          const invokePromise = medicalGraph.invoke({ message, history });
          const result = await Promise.race([invokePromise, timeoutPromise(10000, "LangGraph invoke timed out (10s)")]);
          // Expect result to contain .answer and .sources / .sources may be array
          if (!result) throw new Error("Empty LangGraph result");
          const answer = result.answer || result.text || result.output || "";
          const sources = result.sources || result.urls || [];
          console.log("LangGraph succeeded");
          return res.status(200).json({ reply: answer, sources });
        } catch (err) {
          lastErr = err;
          console.warn(`LangGraph attempt ${attempt + 1} failed:`, err?.message || err);
          // small backoff
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }
      }
      // If loop finishes, fall through to fallback
      console.error("LangGraph failed after retries:", lastErr?.message || lastErr);
    } catch (err) {
      console.error("Unexpected LangGraph error:", err);
    }
  } else {
    console.warn("medicalGraph not available — skipping LangGraph path");
  }

  // ---------- FALLBACK direct RAG path ----------
  // Requirements: GEMINI_API_KEY, QDRANT_URL, QDRANT_API_KEY
  try {
    if (!geminiKey) throw new Error("GEMINI_API_KEY missing (fallback disabled)");
    if (!qdrantUrl || !qdrantKey) console.warn("Qdrant missing — retrieval will be skipped and Gemini will respond without context.");

    // 1) Embed the query
    let queryVector = null;
    try {
      queryVector = await embedText(geminiKey, message);
    } catch (e) {
      console.warn("Embedding failed — continuing without retrieval:", e?.message || e);
    }

    // 2) Retrieve context from Qdrant if available
    let searchResults = [];
    if (queryVector && qdrantUrl && qdrantKey) {
      try {
        // Best-effort: target collection name 'medical_knowledge' (change if you used different name)
        searchResults = await qdrant.search("medical_knowledge", {
          vector: queryVector,
          limit: 4
        });
      } catch (e) {
        console.warn("Qdrant search failed:", e?.message || e);
        searchResults = [];
      }
    }

    // 3) Build final prompt with retrieved context
    const contextText = formatRetrievedContext(searchResults || []);
    const systemPrompt = `You are VytalCare AI — a safety-focused medical information assistant.
Rules:
- Use retrieved context to answer.
- Never provide diagnosis; provide educational info and advise to consult a professional.
Format:
ANSWER:
(Your answer)
SOURCES:
- include urls
`;

    const finalPrompt = `
SYSTEM:
${systemPrompt}

USER QUESTION:
${message}

RETRIEVED CONTEXT:
${contextText}

FINAL ANSWER:
`;

    // 4) Call Gemini REST
    const answer = await generateGeminiResponse(geminiKey, finalPrompt, 20000);

    // 5) Clean out model-inserted "SOURCES:" to avoid duplication
    const cleaned = answer.replace(/(?:^|\n)SOURCES?:[\s\S]*/gi, "").trim();

    // 6) Return
    const sourcesList = (searchResults || []).map(s => s.payload?.url || null).filter(Boolean);
    return res.status(200).json({ reply: cleaned || "Sorry, I couldn't generate a response.", sources: sourcesList });

  } catch (err) {
    // final fallback: graceful message + diagnostics
    console.error("Final RAG fallback failed:", err?.message || err);
    return res.status(200).json({
      reply: "I’m sorry, I couldn’t process that request right now. Please try again in a moment.",
      sources: [],
      error: "Backend RAG request failed (final fallback)",
      details: err?.message || String(err)
    });
  }
}
