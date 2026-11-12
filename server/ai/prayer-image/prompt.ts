// Mensaje de usuario de la generación (research D13). El system prompt detallado (estilo, contraste, qué no tocar de la
// plantilla) vive en el preset `@preset/pray-requests-image-generation`, que el equipo edita sin desplegar.

const INSTRUCTION = [
  'Rellena solo el espacio vacío bajo el título «Peticiones de oración» de la plantilla adjunta con las peticiones de abajo.',
  'Escribe un párrafo por petición, en el orden dado.',
  'Copia cada texto literal: no lo corrijas, resumas, traduzcas ni le añadas nada.',
].join(' ')

/** `<` y `>` del texto pasan a `‹` y `›`: ninguna petición abre ni cierra una etiqueta. */
const neutralize = (text: string) => text.replace(/</g, '‹').replace(/>/g, '›')

/** Solo los textos recibidos (nunca nombres, notas ni IP, FR-022), cada uno en `<peticion n="…">`. */
export function buildPrayerPrompt(paragraphs: readonly string[]): string {
  const items = paragraphs.map((text, i) => `<peticion n="${i + 1}">${neutralize(text)}</peticion>`)
  return `${INSTRUCTION}\n\n${items.join('\n')}`
}
