import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GOOGLE_API_KEY;

if (!apiKey) throw new Error("Missing GOOGLE_API_KEY environment variable");

export const genai = new GoogleGenAI({ apiKey });
