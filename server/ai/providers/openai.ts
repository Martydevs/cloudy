import { createOpenAI } from "@ai-sdk/openai"
import type { RuntimeConfig } from 'nuxt/schema'

// AI PROVIDER DECLARATION FOR MAIN USE CASE, IMAGE CONTENT EXTRACTION

// OPENAI CLIENT
export const openaiClient = (config: RuntimeConfig) => {
  return createOpenAI({
    apiKey: config.openaiApikey,
    organization: config.openaiOrg,
    project: config.openaiProj,
    // Vacío = API de OpenAI; solo los e2e lo apuntan a un stub local (research A9).
    baseURL: config.openaiBaseUrl || undefined,
  })
}

export const OPENAI_DEFAULT_MODEL = "gpt-4o"
