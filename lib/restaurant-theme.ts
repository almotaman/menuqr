export type ThemePage = 'menu' | 'product' | 'receipt'
export type LogoStyle = 'left-circle' | 'center-circle' | 'full-header'

export type PageTheme = {
  primary_color?: string
  secondary_color?: string
  background_color?: string
  logo_style?: LogoStyle
}

export type ThemeFallback = {
  logo_style?: LogoStyle
  page_themes?: string
  pageThemes?: Record<string, PageTheme>
}

const DEFAULT_THEME = {
  primary_color: '#000000',
  secondary_color: '#FFFFFF',
  background_color: '#FFFFFF',
  logo_style: 'left-circle' as LogoStyle,
}

export function normalizeThemeColor(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())
    ? value.trim()
    : fallback
}

export function parsePageThemes(value: unknown): Record<string, PageTheme> {
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch { return {} }
}

export function readThemeFallback(slug: string): ThemeFallback {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(`3ainly_theme_${slug}`) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}

export function resolveRestaurantTheme(
  restaurant: Record<string, unknown> | null | undefined,
  slug: string,
  page: ThemePage,
) {
  const fallback = readThemeFallback(slug)
  const globalLogoStyle = isLogoStyle(restaurant?.logo_style)
    ? restaurant.logo_style
    : fallback.logo_style
  const remotePageThemes = restaurant?.page_themes
  const pageThemes = parsePageThemes(
    typeof remotePageThemes === 'string' && remotePageThemes.trim()
      ? remotePageThemes
      : fallback.page_themes
  )
  const pageOverride = pageThemes[page] || fallback.pageThemes?.[page] || {}
  const primary = normalizeThemeColor(restaurant?.primary_color, DEFAULT_THEME.primary_color)
  const secondary = normalizeThemeColor(restaurant?.secondary_color, DEFAULT_THEME.secondary_color)
  const background = normalizeThemeColor(restaurant?.background_color, DEFAULT_THEME.background_color)
  const logoStyle = isLogoStyle(globalLogoStyle) ? globalLogoStyle : DEFAULT_THEME.logo_style

  return {
    primaryColor: normalizeThemeColor(pageOverride.primary_color, primary),
    secondaryColor: normalizeThemeColor(pageOverride.secondary_color, secondary),
    backgroundColor: normalizeThemeColor(pageOverride.background_color, background),
    logoStyle: isLogoStyle(pageOverride.logo_style) ? pageOverride.logo_style : logoStyle,
  }
}

export function isLogoStyle(value: unknown): value is LogoStyle {
  return value === 'left-circle' || value === 'center-circle' || value === 'full-header'
}

export function contrastRatio(first: string, second: string) {
  const luminance = (color: string) => {
    const channels = color.slice(1).match(/.{2}/g)?.map(channel => parseInt(channel, 16) / 255) || [0, 0, 0]
    const linear = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  }
  const a = luminance(first)
  const b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
