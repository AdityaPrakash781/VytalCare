import { GoogleGenerativeAI } from "@google/generative-ai";
import { retrieveContext } from "../../ingest/retrieve_context.js";

export const config = {
  runtime: "edge",
};

export default async function handler(req) {
  const body = await req.json();
  const { message, history } = body;

  const encoder = new TextEncoder();

  try {
    // 1. Retrieve context from Qdrant
    const contextResults = await retrieveContext(message);

    const context = contextResults
      .map(r => `• ${r.payload.title}\n${r.payload.summary}\nURL: ${r.payload.url}`)
      .join("\n\n");

    const sources = contextResults.map(r => ({
      title: r.payload.title,
      url: r.payload.url
    }));

    // 2. Prepare Streaming Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
Use only the following context to answer the user's question.

CONTEXT:
${context}

USER:
${message}
    `;

    const stream = await model.generateContentStream(prompt);

    const readable = new ReadableStream({
      async start(controller) {
        // Send sources FIRST so frontend can show them
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ type: "sources", sources }) + "\n"
          )
        );

        // Then stream tokens
        for await (const chunk of stream.stream) {
          const text = chunk.text();
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ type: "token", token: text }) + "\n"
            )
          );
        }

        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });

  } catch (err) {
    console.error(err);
    return new Response("Error", { status: 500 });
  }
}
