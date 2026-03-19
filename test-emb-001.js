import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

async function testREST() {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = "gemini-embedding-001";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;
  
  const payload = {
    content: { parts: [{ text: "Hello world" }] }
  };
  
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    console.log(`Model: ${model} -> Status: ${res.status}`);
    if (res.ok) console.log("Success. Vector Size:", json.embedding.values.length);
    else console.log(JSON.stringify(json, null, 2));
  } catch (err) {
    console.error(err);
  }
}

testREST();
