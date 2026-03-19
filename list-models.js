import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function list() {
  try {
    const result = await genAI.listModels();
    for (const model of result.models) {
      if (model.supportedGenerationMethods.includes("embedContent")) {
         console.log(`Model: ${model.name}, Methods: ${model.supportedGenerationMethods}`);
      }
    }
  } catch (err) {
    console.error(err);
  }
}

list();
