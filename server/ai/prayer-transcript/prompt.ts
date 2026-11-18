// Mensaje de usuario de la lectura de una foto. El comportamiento detallado (leer literal, conservar saltos de línea, no
// corregir, avisar si no hay nada legible) vive en el system prompt del preset `@preset/pray-requests-transcription`, que el
// equipo edita en OpenRouter sin desplegar; aquí basta una línea. Privacidad: el prompt no lleva nombres, notas, IP ni ids;
// al modelo solo llega la foto.

/** Instrucción de la lectura: no depende de la petición. */
export function buildTranscriptPrompt(): string {
  return 'Transcribe la petición de oración de la imagen adjunta.'
}
