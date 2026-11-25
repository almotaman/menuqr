'use client'

import { useEffect, useMemo, useState } from 'react'
import { databases, getDirectAppwriteUrl } from '@/lib/appwrite-client'
import RestaurantLogoHeader from '@/components/restaurant-logo-header'
import {
  contrastRatio,
  isLogoStyle,
  normalizeThemeColor,
  parsePageThemes,
  readThemeFallback,
  resolveRestaurantTheme,
  type LogoStyle,
  type PageTheme,
  type ThemePage,
} from '@/lib/restaurant-theme'

const DATABASE_ID = '6aeb94480024c9a754d5'
const RESTAURANTS_TABLE_ID = '6aecc81c002c252602a9'

type RestaurantProfile = Record<string, unknown> & { $id: string; subdomain?: string; name?: string; logo_url?: string }
type Props = { restaurant: RestaurantProfile | null; onSaved: (restaurant: RestaurantProfile) => void }
type Scope = 'all' | 'page'

function validColor(value: string) { return /^#[0-9a-f]{6}$/i.test(value) }

export default function CashierCustomization({ restaurant, onSaved }: Props) {
  const slug = String(restaurant?.subdomain || 'restaurant')
  const [scope, setScope] = useState<Scope>('all')
  const [page, setPage] = useState<ThemePage>('menu')
  const [primaryColor, setPrimaryColor] = useState('#000000')
  const [secondaryColor, setSecondaryColor] = useState('#FFFFFF')
  const [backgroundColor, setBackgroundColor] = useState('#FFFFFF')
  const [logoStyle, setLogoStyle] = useState<LogoStyle>('left-circle')
  const [clearOverrides, setClearOverrides] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const supportsLogoStyle = Boolean(restaurant && Object.prototype.hasOwnProperty.call(restaurant, 'logo_style'))
  const supportsPageThemes = Boolean(restaurant && Object.prototype.hasOwnProperty.call(restaurant, 'page_themes'))

  useEffect(() => {
    if (!restaurant) return
    if (scope === 'all') {
      const fallback = readThemeFallback(slug)
      const globalLogoStyle = restaurant.logo_style ?? fallback.logo_style
      setPrimaryColor(normalizeThemeColor(restaurant.primary_color, '#000000'))
      setSecondaryColor(normalizeThemeColor(restaurant.secondary_color, '#FFFFFF'))
      setBackgroundColor(normalizeThemeColor(restaurant.background_color, '#FFFFFF'))
      setLogoStyle(isLogoStyle(globalLogoStyle) ? globalLogoStyle : 'left-circle')
    } else {
      const theme = resolveRestaurantTheme(restaurant, slug, page)
      setPrimaryColor(theme.primaryColor)
      setSecondaryColor(theme.secondaryColor)
      setBackgroundColor(theme.backgroundColor)
      setLogoStyle(theme.logoStyle)
    }
    setMessage('')
  }, [restaurant, slug, page, scope])

  const contrastWarning = useMemo(() => {
    if (!validColor(primaryColor) || !validColor(secondaryColor) || !validColor(backgroundColor)) return ''
    const primaryToBackground = contrastRatio(primaryColor, backgroundColor)
    const textToPrimary = contrastRatio(secondaryColor, primaryColor)
    if (primaryToBackground < 3 || textToPrimary < 4.5) {
      return `Low contrast: primary/background ${primaryToBackground.toFixed(1)}:1, button text/primary ${textToPrimary.toFixed(1)}:1.`
    }
    return ''
  }, [primaryColor, secondaryColor, backgroundColor])

  const save = async () => {
    if (!restaurant?.$id) return
    if (!window.localStorage.getItem('POS_SECURE_TOKEN')) {
      setMessage('Cashier session expired. Please reopen the terminal link.')
      return
    }
    if (![primaryColor, secondaryColor, backgroundColor].every(validColor)) {
      setMessage('Enter valid six-digit hex colors.')
      return
    }

    setSaving(true)
    setMessage('')
    try {
      const fallback = readThemeFallback(slug)
      const updates: Record<string, unknown> = {}
      if (scope === 'all') {
        updates.primary_color = primaryColor
        updates.secondary_color = secondaryColor
        updates.background_color = backgroundColor
        if (supportsLogoStyle) updates.logo_style = logoStyle
        else fallback.logo_style = logoStyle
        if (clearOverrides) {
          if (supportsPageThemes) updates.page_themes = '{}'
          else {
            fallback.page_themes = '{}'
            fallback.pageThemes = {}
          }
        }
      } else if (supportsPageThemes) {
        const pageThemes = parsePageThemes(restaurant.page_themes)
        pageThemes[page] = {
          primary_color: primaryColor,
          secondary_color: secondaryColor,
          background_color: backgroundColor,
          logo_style: logoStyle,
        } satisfies PageTheme
        updates.page_themes = JSON.stringify(pageThemes)
      } else {
        const pageThemes = fallback.pageThemes || {}
        pageThemes[page] = {
          primary_color: primaryColor,
          secondary_color: secondaryColor,
          background_color: backgroundColor,
          logo_style: logoStyle,
        } satisfies PageTheme
        fallback.pageThemes = pageThemes
      }

      let updatedRestaurant = restaurant
      if (Object.keys(updates).length) {
        updatedRestaurant = await databases.updateDocument(
          DATABASE_ID,
          RESTAURANTS_TABLE_ID,
          restaurant.$id,
          updates,
        ) as unknown as RestaurantProfile
      }
      try { window.localStorage.setItem(`3ainly_theme_${slug}`, JSON.stringify(fallback)) } catch {}
      onSaved({ ...restaurant, ...updatedRestaurant, ...updates } as RestaurantProfile)
      setMessage(scope === 'page' && !supportsPageThemes
        ? 'Page theme saved in this browser. Add the page_themes column in Appwrite to share it across devices.'
        : !supportsLogoStyle
          ? 'Theme saved. Logo style is saved in this browser until the logo_style column is added in Appwrite.'
          : 'Customization saved.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save customization.')
    } finally { setSaving(false) }
  }

  const logosBucketId = process.env.NEXT_PUBLIC_APPWRITE_LOGOS_BUCKET_ID || ''
  const logoUrl = restaurant?.logo_url && logosBucketId
    ? getDirectAppwriteUrl(logosBucketId, restaurant.logo_url)
    : null

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
      <div className="mb-5">
        <p className="text-sm font-medium uppercase tracking-widest text-amber-400">Branding</p>
        <h2 className="text-xl font-bold">Customization</h2>
        <p className="mt-1 text-sm text-slate-400">Set restaurant-wide colors or override a customer page.</p>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <button type="button" onClick={() => setScope('all')} className={`rounded-lg px-4 py-2 font-semibold ${scope === 'all' ? 'bg-amber-400 text-slate-950' : 'border border-slate-700 text-slate-300'}`}>All Pages</button>
        <button type="button" onClick={() => setScope('page')} className={`rounded-lg px-4 py-2 font-semibold ${scope === 'page' ? 'bg-amber-400 text-slate-950' : 'border border-slate-700 text-slate-300'}`}>Specific Page</button>
        {scope === 'page' && <select value={page} onChange={event => setPage(event.target.value as ThemePage)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"><option value="menu">Menu</option><option value="product">Product</option><option value="receipt">Receipt</option></select>}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['Primary color', primaryColor, setPrimaryColor],
              ['Secondary / button text', secondaryColor, setSecondaryColor],
              ['Background color', backgroundColor, setBackgroundColor],
            ].map(([label, value, setter]) => {
              const onChange = setter as (value: string) => void
              return <label key={label as string} className="text-sm text-slate-300">{label as string}<span className="mt-1 flex gap-2"><input aria-label={`${label} picker`} type="color" value={value as string} onChange={event => onChange(event.target.value)} className="h-10 w-12 cursor-pointer rounded border-0 bg-transparent" /><input aria-label={`${label} hex`} value={value as string} onChange={event => onChange(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono uppercase text-slate-100" /></span></label>
            })}
          </div>

          <label className="block text-sm text-slate-300">Logo placement<select value={logoStyle} onChange={event => isLogoStyle(event.target.value) && setLogoStyle(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"><option value="left-circle">Left Circle</option><option value="center-circle">Center Circle</option><option value="full-header">Full Header</option></select></label>
          {scope === 'all' && <label className="flex items-start gap-2 text-sm text-slate-300"><input type="checkbox" checked={clearOverrides} onChange={event => setClearOverrides(event.target.checked)} className="mt-1 accent-amber-400" />Clear per-page overrides so all pages stay uniform</label>}
          {contrastWarning && <p role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">{contrastWarning}</p>}
          {!supportsLogoStyle && <p className="text-xs text-amber-200">Appwrite does not yet have a <code>logo_style</code> column; that setting is saved in this browser.</p>}
          {scope === 'page' && !supportsPageThemes && <p className="text-xs text-amber-200">Appwrite does not yet have a <code>page_themes</code> column; page overrides are saved in this browser.</p>}
          {message && <p role="status" className="text-sm text-slate-300">{message}</p>}
          <button type="button" onClick={() => void save()} disabled={saving} className="rounded-lg bg-amber-400 px-4 py-2.5 font-bold text-slate-950 disabled:opacity-50">{saving ? 'Saving…' : 'Save customization'}</button>
        </div>

        <div className="rounded-xl border border-slate-700 bg-white p-3 text-slate-900">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Live preview · {scope === 'all' ? 'All Pages' : page}</p>
          <div style={{ backgroundColor }} className="min-h-40 rounded-lg p-3">
            <RestaurantLogoHeader name={String(restaurant?.name || slug)} logoUrl={logoUrl} logoStyle={logoStyle} primaryColor={primaryColor} secondaryColor={secondaryColor} compact />
            <button type="button" style={{ backgroundColor: primaryColor, color: secondaryColor }} className="mt-3 w-full rounded-lg px-3 py-2 text-sm font-semibold">Sample action</button>
          </div>
        </div>
      </div>
    </section>
  )
}
