// Mensaje de usuario de la lectura de una foto. El system prompt detallado (leer literal, conservar saltos de línea, no
// corregir, avisar si no hay nada legible) vive en el preset `@preset/pray-requests-transcription`, que el equipo edita en
// OpenRouter sin desplegar; esta instrucción corta dice lo mismo. Privacidad: el prompt no lleva nombres, notas, IP ni ids;
// al modelo solo llega la foto.

/** Instrucción de la lectura: no depende de la petición. */
export function buildTranscriptPrompt(): string {
  return [
    'La imagen adjunta es la foto de una petición de oración escrita a mano o impresa.',
    'Transcribe el texto tal cual está escrito y conserva sus saltos de línea: no lo corrijas, resumas, traduzcas ni le añadas nada.',
    'Si la foto no tiene texto legible, responde que no hay texto y deja el texto vacío.',
  ].join(' ')
}
