import { createGoogleGenerativeAI } from "@ai-sdk/google"
import type { RuntimeConfig } from 'nuxt/schema'

// AI PROVIDER DECLARATION FOR MAIN USE CASE, IMAGE CONTENT EXTRACTION

// GOOGLE CLIENT
export const googleClient = (config: RuntimeConfig) => {
  return createGoogleGenerativeAI({
    apiKey: config.googleApikey
  })
}

// DEFAULT MODEL FOR IMAGE CONTENT EXTRACTION
// USAGE: generateText({ model: googleClient(config)(GEMINI_DEFAULT_MODEL), ... })
export const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite'
