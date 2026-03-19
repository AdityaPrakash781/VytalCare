import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

async function testREST(version) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = "text-embedding-004";
  const url = `https://generativelanguage.googleapis.com/${version}/models/${model}:embedContent?key=${apiKey}`;
  
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
    console.log(`Version: ${version} -> Status: ${res.status}`);
    if (!res.ok) console.log(JSON.stringify(json, null, 2));
    else console.log("Success (first 10 values):", json.embedding.values.slice(0, 10));
  } catch (err) {
    console.error(`Version ${version} Error:`, err.message);
  }
}

async function run() {
  await testREST("v1");
  await testREST("v1beta");
}

run();
