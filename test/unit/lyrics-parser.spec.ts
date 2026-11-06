// T020 — Lectura de la letra (feature 006, research D4–D5) con los fixtures reales de Letras.com (T004) y casos límite.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { countLines, decodeEntities, elementContent, lyricsToHtml, parseLetrasHtml } from '../../server/utils/lyrics-parser'

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')

const page = (body: string, head = '') => `<html><head>${head}</head><body>${body}</body></html>`

describe('parseLetrasHtml con el fixture real de una canción', () => {
  const parsed = parseLetrasHtml(fixture('letras-song.html'))

  it('lee el título del <h1> y el artista del bloque title-secondary (no el primer <h2> de la cabecera)', () => {
    expect(parsed?.title).toBe('De Buenas (part. Josh Gamez)')
    expect(parsed?.artist).toBe('Musiko')
  })

  it('lee las estrofas en el orden de la página, sin líneas vacías', () => {
    expect(parsed!.stanzas.length).toBeGreaterThan(5)
    expect(parsed!.stanzas[0]).toEqual(['Jay Jay', 'Musiko', 'Billy', 'Dime, dime'])
    expect(parsed!.stanzas[1]![0]).toBe('A veces despierto con ganas de no amanecer')
    // Las indicaciones entre paréntesis se conservan.
    expect(parsed!.stanzas[6]![1]).toBe('Cuando te llamo no me dejas en espera (cuando te llamo yo)')
    for (const stanza of parsed!.stanzas) {
      expect(stanza.length).toBeGreaterThan(0)
      for (const line of stanza) expect(line).toBe(line.trim())
    }
  })
})

describe('parseLetrasHtml sin letra', () => {
  it('la página de artista real no tiene letra', () => {
    expect(parseLetrasHtml(fixture('letras-no-lyrics.html'))).toBeNull()
  })

  it('un contenedor sin líneas no es letra', () => {
    expect(parseLetrasHtml(page('<h1>T</h1><div class="lyric-original"><p> </p><p><br></p></div>'))).toBeNull()
    expect(parseLetrasHtml(page('<h1>T</h1><div class="lyric-original"/>'))).toBeNull()
    expect(parseLetrasHtml('')).toBeNull()
  })
})

describe('parseLetrasHtml, casos sintéticos', () => {
  it('un </div> interior no corta el contenedor', () => {
    const html = page('<h1>T</h1><div class="x lyric-original y"><div class="ad"><span>publicidad</span></div><p>uno<br>dos</p><div></div><p>tres</p></div><p>fuera</p>')
    expect(parseLetrasHtml(html)!.stanzas).toEqual([['publicidad'], ['uno', 'dos'], ['tres']])
  })

  it('<br>, <br/> y <br /> separan líneas; espacios y saltos se normalizan', () => {
    const html = page('<h1>T</h1><div class="lyric-original"><p>a<br/>b<br />c<BR>  d\n  e  </p></div>')
    expect(parseLetrasHtml(html)!.stanzas).toEqual([['a', 'b', 'c', 'd e']])
  })

  it('decodifica entidades con nombre y numéricas', () => {
    const html = page('<h1>Coraz&oacute;n &amp; alma</h1><div class="lyric-original"><p>ni&ntilde;o&nbsp;m&aacute;s<br>It&#39;s &#x2014; &quot;ya&quot;<br>&raro;</p></div>')
    const parsed = parseLetrasHtml(html)!
    expect(parsed.title).toBe('Corazón & alma')
    expect(parsed.stanzas).toEqual([['niño más', 'It\'s — "ya"', '&raro;']])
  })

  it('ignora comentarios, scripts y estilos dentro del contenedor', () => {
    const html = page('<h1>T</h1><div class="lyric-original"><!-- <p>no</p> --><script>var p = "<p>no</p>"</script><style>p{}</style><p>sí</p></div>')
    expect(parseLetrasHtml(html)!.stanzas).toEqual([['sí']])
  })

  it('conserva «(Coro)» y «x2»', () => {
    const html = page('<h1>T</h1><div class="lyric-original"><p>(Coro)<br>Aleluya x2</p></div>')
    expect(parseLetrasHtml(html)!.stanzas).toEqual([['(Coro)', 'Aleluya x2']])
  })

  it('sin <h1> usa el <title> «TÍTULO - Artista - LETRAS.COM»', () => {
    const html = page('<div class="lyric-original"><p>l</p></div>', '<title>\n  CANCIÓN - Banda - LETRAS.COM\n</title>')
    expect(parseLetrasHtml(html)).toEqual({ title: 'CANCIÓN', artist: 'Banda', stanzas: [['l']] })
  })

  it('sin título ni artista en la página → null en ambos', () => {
    expect(parseLetrasHtml(page('<div class="lyric-original"><p>l</p></div>'))).toEqual({ title: null, artist: null, stanzas: [['l']] })
    expect(parseLetrasHtml(page('<div class="lyric-original"><p>l</p></div>', '<title>Solo título</title>'))).toEqual({ title: 'Solo título', artist: null, stanzas: [['l']] })
  })

  it('el bloque del artista sin <h2> usa su texto', () => {
    const html = page('<h1>T</h1><a class="title-secondary" href="/x/">  Banda  </a><div class="lyric-original"><p>l</p></div>')
    expect(parseLetrasHtml(html)!.artist).toBe('Banda')
  })

  it('un contenedor sin cierre llega hasta el final del documento', () => {
    expect(elementContent('<div class="lyric-original"><p>a</p>', 'lyric-original')).toBe('<p>a</p>')
    expect(elementContent('<div class="otro"></div>', 'lyric-original')).toBeNull()
  })
})

describe('lyricsToHtml y countLines', () => {
  it('reconstruye el formato del servicio con el texto escapado', () => {
    expect(lyricsToHtml([['l1', 'l2'], ['l3']])).toBe('<div class="lyric-original"><p>l1<br>l2</p><p>l3</p></div>')
    expect(lyricsToHtml([['<script>alert("x")</script> & \'y\'']])).toBe('<div class="lyric-original"><p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;</p></div>')
  })

  it('lo reconstruido se vuelve a leer igual', () => {
    const stanzas = [['Corazón & alma', '<b>no</b>'], ['"fin"']]
    expect(parseLetrasHtml(lyricsToHtml(stanzas))!.stanzas).toEqual(stanzas)
  })

  it('cuenta las líneas de todas las estrofas', () => {
    expect(countLines([['a', 'b'], ['c'], []])).toBe(3)
    expect(countLines([])).toBe(0)
  })

  it('decodeEntities deja igual un código fuera de rango', () => {
    expect(decodeEntities('&#0; &#x110000;')).toBe('&#0; &#x110000;')
  })
})
