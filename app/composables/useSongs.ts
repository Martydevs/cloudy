// Canciones (feature 006, contracts/ui.md § Composables): obtener o abrir un enlace (rastrea solo si es nueva), la ficha de una canción
// y **Volver a obtener la letra** con confirmación. Los errores llegan al usuario solo por `serverMessage()`; los 5xx con código
// (`not_configured`, `quota`, `busy`, `crawl_failed`, `waking`…) usan el texto de ese código como respaldo.
import { FetchError } from 'ofetch'
import type { MaybeRefOrGetter } from 'vue'
import type { SongDetail, SongErrorCode, SongFetchResult } from '#shared/types/api'
import { SONG_ERROR_CODES, SONG_ERROR_MESSAGES } from '#shared/constants/songs'

/** `data.code` de un error de `/api/songs/**` (FetchError de `$fetch` o NuxtError de `useFetch`). */
export function songErrorCode(error: unknown): SongErrorCode | null {
  const body = (error instanceof FetchError ? error.data : (error as { data?: unknown } | null)?.data) as { data?: { code?: unknown } } | undefined
  const code = body?.data?.code
  return typeof code === 'string' && (SONG_ERROR_CODES as readonly string[]).includes(code) ? code as SongErrorCode : null
}

/** Estado HTTP de un error de `$fetch` o de `useFetch`. */
export function songErrorStatus(error: unknown): number {
  if (error instanceof FetchError) return error.response?.status ?? 0
  return (error as { statusCode?: number } | null)?.statusCode ?? 0
}

/** Texto en español de un error de Canciones: el del servidor en 4xx; en 5xx, el de su código; 504 (plazo de Vercel), `timeout`. */
export function songErrorMessage(error: unknown, fallback: string, timeout: string = fallback): string {
  const code = songErrorCode(error)
  const codeText = code ? SONG_ERROR_MESSAGES[code] : null
  return serverMessage(error, songErrorStatus(error) === 504 ? timeout : codeText ?? fallback)
}

/** Fallo que vale la pena reintentar: servicio despertando u ocupado, plazo de Vercel (504) o red. */
export function isTransientSongError(error: unknown): boolean {
  const status = songErrorStatus(error)
  return status === 0 || status === 502 || status === 503 || status === 504
    ? !['not_configured', 'misconfigured', 'quota', 'invalid'].includes(songErrorCode(error) ?? '')
    : false
}

export function useSongs() {
  const api = useApi()
  const toast = useToast()
  const { confirm } = useConfirm()

  /**
   * Obtiene la canción del enlace (ya normalizado) sin navegar: rastrea solo si es nueva y entonces avisa «Letra obtenida».
   * Devuelve la canción, o el texto del error para mostrarlo junto al campo.
   */
  async function fetchSong(url: string): Promise<{ song: SongDetail, error: null } | { song: null, error: string }> {
    try {
      const { song, crawled } = await api<SongFetchResult>('/api/songs/fetch', { method: 'POST', body: { url } })
      if (crawled) toast.success(messages.songs.fetch.fetched)
      return { song, error: null }
    }
    catch (error) {
      return { song: null, error: songErrorMessage(error, messages.songs.fetch.failed, messages.songs.fetch.timeout) }
    }
  }

  /** Abre la canción del enlace (ya normalizado); devuelve el texto del error para mostrarlo junto al campo, o `null`. */
  async function open(url: string): Promise<string | null> {
    const { song, error } = await fetchSong(url)
    if (!song) return error
    await navigateTo(`/canciones/${song.id}`)
    return null
  }

  /** Confirma y vuelve a rastrear; la letra guardada solo cambia si el rastreo trae una letra válida (FR-010). */
  async function refreshLyrics(id: string): Promise<SongDetail | null> {
    const ok = await confirm({
      title: messages.songs.refresh.action,
      message: messages.songs.refresh.confirm,
      confirmLabel: messages.songs.refresh.confirmLabel,
    })
    if (!ok) return null
    try {
      const song = await api<SongDetail>(`/api/songs/${id}/refresh`, { method: 'POST' })
      useNuxtData<SongDetail>(`song-${id}`).data.value = song
      toast.success(messages.songs.refresh.done)
      return song
    }
    catch (error) {
      toast.error(songErrorMessage(error, messages.songs.refresh.failed, messages.songs.fetch.timeout))
      return null
    }
  }

  return { fetchSong, open, refreshLyrics }
}

/** Ficha de una canción; abrirla registra la vista en el historial (FR-027). */
export function useSong(id: MaybeRefOrGetter<string>) {
  return useApiFetch<SongDetail>(() => `/api/songs/${toValue(id)}`, { key: `song-${toValue(id)}` })
}
