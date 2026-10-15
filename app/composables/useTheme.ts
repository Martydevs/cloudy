// Tema en cookie para que el SSR pinte `data-theme` sin parpadeo (research R10, FR-043).
export type ThemeName = 'cloudy' | 'cloudy-light'

const THEMES: ThemeName[] = ['cloudy', 'cloudy-light']

export function useTheme() {
  const cookie = useCookie<ThemeName>('cloudy-theme', {
    default: () => 'cloudy',
    maxAge: 31536000,
    sameSite: 'lax',
  })
  const theme = useState<ThemeName>('theme', () => THEMES.includes(cookie.value) ? cookie.value : 'cloudy')
  const isDark = computed(() => theme.value === 'cloudy')

  function set(value: ThemeName) {
    theme.value = value
    cookie.value = value
  }

  function toggle() {
    set(isDark.value ? 'cloudy-light' : 'cloudy')
  }

  return { theme, isDark, set, toggle }
}
