// /workflow/medical-graph.js
import { StateGraph, END } from "@langchain/langgraph";
import fetch from "node-fetch";
import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from "dotenv";
dotenv.config();

/* ============================================================
   QDRANT CLIENT
============================================================ */
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
  checkCompatibility: false,
});

/* ============================================================
   GEMINI HELPERS (REST API v1)
============================================================ */
const GEMINI_MODEL = "models/gemini-2.5-flash";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;


async function askGemini(prompt) {
  const response = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }),
  });

  const json = await response.json();

  if (json.error) {
    throw new Error(json.error.message);
  }

  return json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function embed(text) {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] },
      }),
    }
  );

  const json = await resp.json();
  return json.embedding.values;
}

/* ============================================================
   NODE 1 — Combined classification, triage, safety check, doctor need,
   AND follow-up question generation
============================================================ */

async function nodeAnalyze(state) {
  const prompt = `
You are a medical pre-screening AI. Analyze the user's message and output structured JSON.

USER MESSAGE:
${state.message}

Respond ONLY in valid JSON:
{
  "category": "symptoms | test_report | general_question",
  "triage": "low | medium | high",
  "needs_doctor": true/false,
  "followup_question": "string"
}
`;

  const output = await askGemini(prompt);

  let parsed = {};
  try {
    parsed = JSON.parse(output);
  } catch (e) {
    parsed = {
      category: "general_question",
      triage: "low",
      needs_doctor: false,
      followup_question: "",
    };
  }

  return {
    ...state,
    category: parsed.category,
    triage: parsed.triage,
    needs_doctor: parsed.needs_doctor,
    followup_question: parsed.followup_question,
  };
}

/* ============================================================
   NODE 2 — RAG RETRIEVAL
============================================================ */

async function nodeRetrieve(state) {
  const vec = await embed(state.message);

  const results = await qdrant.search("medical_knowledge", {
    vector: vec,
    limit: 4,
  });

  const formatted = results
    .map(
      (r, i) => `
[Document ${i + 1}]
TITLE: ${r.payload?.title}
SUMMARY: ${r.payload?.summary}
URL: ${r.payload?.url}
`
    )
    .join("\n");

  return {
    ...state,
    context: formatted,
    sources: results.map((r) => r.payload?.url || "No URL"),
  };
}

/* ============================================================
   NODE 3 — FINAL ANSWER
============================================================ */

async function nodeFinal(state) {
  const finalPrompt = `
You are VytalCare Medical Assistant.

USER QUESTION:
${state.message}

TRIAGE LEVEL:
${state.triage}

FOLLOW-UP QUESTION:
${state.followup_question}

NEEDS DOCTOR:
${state.needs_doctor}

RETRIEVED MEDICAL CONTEXT:
${state.context}

Write a clear, safe medical answer that:
- Uses the context
- Provides correct info
- Does NOT diagnose
- Does NOT prescribe medication
- Adds this disclaimer at the end:
"This is general information, not a medical diagnosis. Consult a healthcare professional for personal advice."

FORMAT:
ANSWER:
(text here)
`;

  const answer = await askGemini(finalPrompt);

  return {
    ...state,
    answer,
  };
}

/* ============================================================
   BUILD GRAPH (FAST MODE — ONLY 2 GEMINI CALLS)
============================================================ */

const graph = new StateGraph({
  channels: {
    message: "string",
    category: "string",
    triage: "string",
    needs_doctor: "boolean",
    followup_question: "string",
    context: "string",
    sources: "array",
    answer: "string",
  },
});

// Node names MUST match here
graph.addNode("analyze", nodeAnalyze);
graph.addNode("retrieve", nodeRetrieve);
graph.addNode("final", nodeFinal);

// Graph flow
graph.addEdge("__start__", "analyze");
graph.addEdge("analyze", "retrieve");
graph.addEdge("retrieve", "final");
graph.addEdge("final", END);

export default graph.compile();
