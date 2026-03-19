import { fetchFromMedlinePlusConnect } from "./ingest/fetch_medlineplus_connect.js";
import { embedAndUpload } from "./ingest/embed_and_upload.js";
import dotenv from "dotenv";
dotenv.config();

async function test() {
  try {
    const query = "appendectomy";
    console.log(`🔍 Testing for: ${query}`);
    
    const results = await fetchFromMedlinePlusConnect(query);
    console.log(`📄 Found ${results.length} entries.`);
    
    if (results.length > 0) {
      console.log("🚀 Starting embedAndUpload...");
      // Try forcing v1
      await embedAndUpload([results[0]], query);
      console.log("✅ Successfully uploaded one embedding.");
    }
  } catch (err) {
    console.error("❌ Test failed!");
    console.error("Error Message:", err.message);
    console.error("Error Stack:", err.stack);
    if (err.response) {
      console.error("Error response data:", JSON.stringify(err.response.data, null, 2));
      console.error("Error response status:", err.response.status);
    }
  }
}

test();
