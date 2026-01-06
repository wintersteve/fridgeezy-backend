import { GoogleGenAI } from "@google/genai";

if (!process.env.GOOGLE_API_KEY) {
    throw new Error("Missing GOOGLE_API_KEY environment variable");
}

export const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
