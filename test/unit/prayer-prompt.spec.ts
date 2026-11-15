// T009 — Prompt de usuario de la generación de imágenes de peticiones (feature 007, research D13; feature 008: el modelo lee
// las fotos de los invitados).
import { describe, expect, it } from 'vitest'
import { buildPrayerPrompt, photoLabel } from '../../server/ai/prayer-image/prompt'

describe('buildPrayerPrompt', () => {
  it('dice qué es cada imagen adjunta y pide leer cada foto y escribirla en orden, un bloque por foto', () => {
    const prompt = buildPrayerPrompt(3)
    expect(prompt).toMatch(/La primera imagen adjunta es la plantilla y las siguientes son fotos de peticiones de oración/)
    expect(prompt).toMatch(/en orden/)
    expect(prompt).toMatch(/Lee el texto escrito en cada foto/)
    expect(prompt).toMatch(/un bloque por foto, en el mismo orden/)
  })

  it('con una sola foto habla en singular', () => {
    const prompt = buildPrayerPrompt(1)
    expect(prompt).toMatch(/la siguiente es la foto de una petición de oración/)
    expect(prompt).toMatch(/Lee el texto escrito en la foto/)
    expect(prompt).not.toMatch(/un bloque por foto/)
  })

  it('va alineada con el preset: despeja el cielo y copia literal, cada palabra una sola vez', () => {
    const prompt = buildPrayerPrompt(2)
    expect(prompt).toMatch(/Quita las nubes y los pájaros del cielo/)
    expect(prompt).toMatch(/sin tocar el título «Peticiones de oración», el sol, los árboles ni las colinas/)
    expect(prompt).toMatch(/literal, palabra por palabra/)
    expect(prompt).toMatch(/cada palabra una sola vez, sin repetirla al cambiar de línea/)
    expect(prompt).toMatch(/no lo corrijas, resumas, traduzcas ni le añadas nada/)
  })

  // Revisión T088b: con números en el prompt el modelo llegó a numerar las peticiones («1) 2)…»).
  it('prohíbe dibujar números, etiquetas, nombres o notas y no lleva dígitos ni etiquetas', () => {
    for (const count of [1, 2, 3, 4]) {
      const prompt = buildPrayerPrompt(count)
      expect(prompt).toMatch(/No dibujes números, etiquetas, nombres de quien envía ni notas/)
      expect(prompt).not.toMatch(/\d/)
      expect(prompt).not.toMatch(/<peticion/)
    }
  })
})

describe('photoLabel', () => {
  it('rotula cada foto con su posición (1-based)', () => {
    expect(photoLabel(1)).toBe('Foto de la petición 1')
    expect(photoLabel(4)).toBe('Foto de la petición 4')
  })
})
