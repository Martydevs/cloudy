import { createOpenAI } from "@ai-sdk/openai"
import { RuntimeConfig } from 'nuxt/schema'

// AI PROVIDER DECLARATION FOR MAIN USE CASE, IMAGE CONTENT EXTRACTION

// OPENAI CLIENT
export const openaiClient = (config: RuntimeConfig) => {
  return createOpenAI({
    apiKey: config.openaiApikey,
    organization: config.openaiOrg,
    project: config.openaiProj
  })
}

// PASS THIS AS INSTRUCTION OF THE TEXT GENERATION FUNCTION

export const IMAGE_EXTRACTION_INSTRUCTION = `
Extract the legible text from each image, exactly as written. Images can contain any kind of text (photos, screenshots, documents, handwritten or digital notes), but are often sticky notes or prayer requests that carry the Skykids logo.

Rules:
- Return only the content: the text itself, in original order, keeping line breaks and names.
- Omit the Skykids logo and the word "Skykids" wherever it appears, along with decorative elements (stickers, borders, icons, watermarks).
- Do not interpret, correct, summarize, translate, or add anything. Keep the original language.
- Skip illegible or ambiguous text.
- With multiple images, transcribe each in order, separated by a blank line.
- If no legible text remains, return exactly: [texto no reconocido]

Output only the transcription, with no preamble or comments.`

// PASS THIS AS PROMPT OF THE TEXT GENERATION FUNCTION
export const IMAGE_EXRTACTION_PROMPT = "Extract the content of the following images"