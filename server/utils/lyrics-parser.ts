// Lectura de la letra de una página de Letras.com (feature 006, research D4–D5). Puro: sin red, sin SDK ni configuración,
// para probarse con fixtures. La letra se guarda como estrofas (`string[][]`), nunca como HTML; el HTML que va al servicio
// de presentaciones se reconstruye aquí con el texto escapado.
//
// Estructura confirmada con los fixtures reales (T004): un `<div class="lyric-original">` con una `<p>` por estrofa y
// `<br>` entre líneas; el título en el único `<h1>`; el artista en el `<h2>` de `a.title-secondary`; `<title>` con la forma
// «TÍTULO - Artista - LETRAS.COM» como respaldo (el actor no entrega metadatos Open Graph).

export interface ParsedLyrics {
  /** `null` si la página no lo indica: quien guarda usa un respaldo. */
  title: string | null
  artist: string | null
  stanzas: string[][]
}

const LYRICS_CLASS = 'lyric-original'
const ARTIST_CLASS = 'title-secondary'

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
  agrave: 'à', egrave: 'è', ccedil: 'ç', atilde: 'ã', otilde: 'õ', acirc: 'â', ecirc: 'ê', ocirc: 'ô',
  iexcl: '¡', iquest: '¿', laquo: '«', raquo: '»', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', middot: '·',
}

/** Decodifica entidades con nombre (las comunes en letras en español) y numéricas; las desconocidas quedan igual. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[body] ?? match
  })
}

/** Texto plano de un fragmento: sin etiquetas, con entidades decodificadas y espacios normalizados. */
function textOf(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** Quita comentarios, `<script>`, `<style>` y `<template>` (su contenido no es texto visible). */
function stripInvisible(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
}

const hasClass = (attrs: string, name: string) => {
  const match = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs)
  const value = match?.[1] ?? match?.[2] ?? match?.[3] ?? ''
  return value.split(/\s+/).includes(name)
}

/**
 * Contenido interior del primer elemento con la clase dada. Recorre las etiquetas contando la profundidad de las del
 * mismo nombre, así un `</div>` de un hijo no corta el contenedor (sin expresiones regulares sobre HTML anidado).
 */
export function elementContent(html: string, className: string): string | null {
  const tag = /<(\/?)([a-z][a-z0-9-]*)\b([^>]*)>/gi
  let start = -1
  let name = ''
  let depth = 0
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    const [whole, closing, rawName, attrs] = match as unknown as [string, string, string, string]
    const tagName = rawName.toLowerCase()
    if (start < 0) {
      if (!closing && hasClass(attrs, className)) {
        if (attrs.trimEnd().endsWith('/')) return ''
        start = match.index + whole.length
        name = tagName
        depth = 1
      }
      continue
    }
    if (tagName !== name || attrs.trimEnd().endsWith('/')) continue
    depth += closing ? -1 : 1
    if (depth === 0) return html.slice(start, match.index)
  }
  // Sin cierre: el resto del documento.
  return start < 0 ? null : html.slice(start)
}

/** Estrofas de la letra: `<p>` = estrofa, `<br>` = línea; vacías fuera. */
function readStanzas(content: string): string[][] {
  // En HTML un salto de línea del código es solo espacio: las líneas las marca `<br>`.
  const withBreaks = content.replace(/\s+/g, ' ').replace(/<br\s*\/?>/gi, '\n')
  return withBreaks
    .split(/<\/?p\b[^>]*>/i)
    .map(chunk => chunk.split('\n').map(textOf).filter(line => line !== ''))
    .filter(stanza => stanza.length > 0)
}

function firstTagText(html: string, tagName: string): string | null {
  const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}\\s*>`, 'i').exec(html)
  const text = match ? textOf(match[1]!) : ''
  return text === '' ? null : text
}

/** «TÍTULO - Artista - LETRAS.COM» → [título, artista] (sin el sitio). */
function titleSegments(html: string): string[] {
  const title = firstTagText(html, 'title')
  if (!title) return []
  const segments = title.split(/\s+-\s+/).map(s => s.trim()).filter(Boolean)
  if (segments.length > 1 && /letras\.com/i.test(segments[segments.length - 1]!)) segments.pop()
  return segments
}

/** Título, artista y estrofas, o `null` si la página no trae letra (sin contenedor o sin ninguna línea). */
export function parseLetrasHtml(html: string): ParsedLyrics | null {
  const clean = stripInvisible(html)
  const content = elementContent(clean, LYRICS_CLASS)
  if (content === null) return null
  const stanzas = readStanzas(content)
  if (stanzas.length === 0) return null

  const segments = titleSegments(clean)
  const title = firstTagText(clean, 'h1') ?? segments[0] ?? null
  const artistBlock = elementContent(clean, ARTIST_CLASS)
  const artist = (artistBlock !== null ? (firstTagText(artistBlock, 'h2') ?? (textOf(artistBlock) || null)) : null)
    ?? (segments.length > 1 ? segments[1]! : null)
  return { title, artist, stanzas }
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ESCAPES[c]!)

/** HTML que entiende el servicio de presentaciones, reconstruido con el texto escapado. */
export function lyricsToHtml(stanzas: string[][]): string {
  return `<div class="${LYRICS_CLASS}">${stanzas.map(stanza => `<p>${stanza.map(escapeHtml).join('<br>')}</p>`).join('')}</div>`
}

export function countLines(stanzas: string[][]): number {
  return stanzas.reduce((total, stanza) => total + stanza.length, 0)
}
