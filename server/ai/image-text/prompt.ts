// INSTRUCTION AND PROMPT FOR IMAGE CONTENT EXTRACTION, SHARED BY EVERY PROVIDER (research A10)

// PASS THIS AS INSTRUCTION OF THE TEXT GENERATION FUNCTION
export const IMAGE_EXTRACTION_INSTRUCTION = `
Extract the legible text from each image, exactly as written. Images can contain any kind of text (photos, screenshots, documents, handwritten or digital notes), but are often sticky notes or prayer requests that carry the Skykids logo.

Rules:
- Return only the content: the text itself, in original order, keeping line breaks and names.
- Omit the Skykids logo and the word "Skykids" wherever it appears, along with decorative elements (stickers, borders, icons, watermarks).
- Do not interpret, correct, summarize, translate, or add anything. Keep the original language.
- Skip illegible or ambiguous text.
- If the image holds several notes, transcribe each in order, separated by a blank line.
- Answer with the object { hasText, text }: hasText true and the transcription in text; if no legible text remains, hasText false and text "".

Output only the transcription, with no preamble or comments.`

// PASS THIS AS PROMPT OF THE TEXT GENERATION FUNCTION
export const IMAGE_EXTRACTION_PROMPT = "Extract the content of the following image"
