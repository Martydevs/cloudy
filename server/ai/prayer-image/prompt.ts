// Mensaje de usuario de la generación (research D13; feature 008: el modelo lee las fotos). El system prompt detallado (área
// del texto, columnas, tipografía, qué no tocar) vive en el preset `@preset/pray-requests-image-generation`, que el equipo
// edita en OpenRouter sin desplegar; esta instrucción corta dice lo mismo que él para que el modelo no reciba órdenes
// contradictorias. Privacidad (FR-022): el prompt no lleva nombres, notas, IP ni ids; al modelo solo llegan la plantilla y
// las fotos de los invitados.

/** Instrucción para una imagen con `count` fotos (1–4). */
export function buildPrayerPrompt(count: number): string {
  const photos = count === 1
    ? 'La primera imagen adjunta es la plantilla y la siguiente es la foto de una petición de oración que envió un invitado.'
    : 'La primera imagen adjunta es la plantilla y las siguientes son fotos de peticiones de oración que enviaron los invitados, en orden.'
  return [
    photos,
    count === 1
      ? 'Lee el texto escrito en la foto y escríbelo en la plantilla.'
      : 'Lee el texto escrito en cada foto y escríbelo en la plantilla, un bloque por foto, en el mismo orden.',
    'Quita las nubes y los pájaros del cielo de la plantilla y escribe ahí, sin tocar el título «Peticiones de oración», el sol, los árboles ni las colinas.',
    'Copia cada texto literal, palabra por palabra y cada palabra una sola vez, sin repetirla al cambiar de línea: no lo corrijas, resumas, traduzcas ni le añadas nada.',
    // En la revisión de T088b el modelo llegó a numerar las peticiones («1) 2)…»).
    'No dibujes números, etiquetas, nombres de quien envía ni notas: solo el texto de las fotos.',
  ].join(' ')
}

/** Rótulo que precede a cada foto en el mensaje (1-based); el modelo no debe copiarlo. */
export function photoLabel(position: number): string {
  return `Foto de la petición ${position}`
}
