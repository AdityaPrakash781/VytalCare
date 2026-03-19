import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

async function listModels(version) {
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/${version}/models?key=${apiKey}`;
  
  try {
    const res = await fetch(url);
    const json = await res.json();
    console.log(`Version: ${version} -> Status: ${res.status}`);
    if (res.ok) {
      json.models.forEach(m => {
        if (m.supportedGenerationMethods.includes("embedContent")) {
           console.log(`- ${m.name}`);
        }
      });
    } else {
      console.log(JSON.stringify(json, null, 2));
    }
  } catch (err) {
    console.error(`Version ${version} Error:`, err.message);
  }
}

listModels("v1beta");
