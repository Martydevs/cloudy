import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { RuntimeConfig } from 'nuxt/schema'

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

// SAME INSTRUCTION AND PROMPT AS THE OPENAI PROVIDER, DEFINED ONCE IN openai.ts
export { IMAGE_EXTRACTION_INSTRUCTION, IMAGE_EXRTACTION_PROMPT } from './openai'
