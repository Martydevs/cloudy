// Mensaje de usuario de la generación (research D13). El system prompt detallado (área del texto, columnas, tipografía, qué
// no tocar) vive en el preset `@preset/pray-requests-image-generation`, que el equipo edita sin desplegar; esta instrucción
// corta dice lo mismo que él (despejar el cielo y copiar sin repetir palabras en los saltos de línea, el fallo más visto en
// la revisión de fidelidad de T088b) para que el modelo no reciba órdenes contradictorias.

const INSTRUCTION = [
  'Quita las nubes y los pájaros del cielo de la plantilla adjunta y escribe en él las peticiones de abajo, sin tocar el título «Peticiones de oración», el sol, los árboles ni las colinas.',
  'Una petición por bloque, en el orden dado.',
  'Copia cada texto literal, palabra por palabra y cada palabra una sola vez, sin repetirla al cambiar de línea: no lo corrijas, resumas, traduzcas ni le añadas nada.',
  // Sin mencionar números ni numerar las etiquetas: en la revisión de T088b el modelo llegó a dibujar «1) 2)…».
  'Escribe solo el texto de dentro de cada etiqueta, sin las etiquetas.',
].join(' ')

/** `<` y `>` del texto pasan a `‹` y `›`: ninguna petición abre ni cierra una etiqueta. */
const neutralize = (text: string) => text.replace(/</g, '‹').replace(/>/g, '›')

/** Solo los textos recibidos (nunca nombres, notas ni IP, FR-022), cada uno en `<peticion>`, en el orden de la imagen. */
export function buildPrayerPrompt(paragraphs: readonly string[]): string {
  const items = paragraphs.map(text => `<peticion>${neutralize(text)}</peticion>`)
  return `${INSTRUCTION}\n\n${items.join('\n')}`
}
