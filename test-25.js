import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

async function testModel(version, modelName) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/${version}/models/${modelName}:generateContent?key=${apiKey}`;
  
  const payload = {
    contents: [{ parts: [{ text: "Say hello" }] }]
  };
  
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    console.log(`Version: ${version}, Model: ${modelName} -> Status: ${res.status}`);
    if (!res.ok) console.log("Error:", json.error?.message || JSON.stringify(json));
    else console.log("Success!");
  } catch (err) {
    console.error(`Error with ${version}:`, err.message);
  }
}

async function run() {
  const model = "gemini-2.5-flash";
  await testModel("v1", model);
  await testModel("v1beta", model);
}

run();
