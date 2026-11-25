import type { CSSProperties } from 'react'
import type { LogoStyle } from '@/lib/restaurant-theme'

type Props = {
  name: string
  logoUrl?: string | null
  logoStyle: LogoStyle
  primaryColor: string
  secondaryColor: string
  compact?: boolean
}

export default function RestaurantLogoHeader({
  name,
  logoUrl,
  logoStyle,
  primaryColor,
  secondaryColor,
  compact = false,
}: Props) {
  const title = <h1 className="text-2xl font-bold capitalize" style={{ color: primaryColor }}>{name}</h1>
  const mark = logoUrl ? (
    <img src={logoUrl} alt={`${name} logo`} className="h-full w-full rounded-full bg-white object-cover" />
  ) : (
    <span className="flex h-full w-full items-center justify-center rounded-full bg-white font-bold" style={{ color: primaryColor }}>
      {name?.[0]?.toUpperCase() || 'R'}
    </span>
  )

  if (logoStyle === 'full-header') {
    return (
      <header className="w-full rounded-2xl px-4 py-5 text-center sm:px-6" style={{ backgroundColor: secondaryColor } as CSSProperties}>
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={`${name} logo`}
            className={`mx-auto w-full object-contain ${compact ? 'max-h-28' : 'max-h-40'}`}
          />
        ) : <div className="mx-auto h-20 w-20">{mark}</div>}
        <div className="mt-3">{title}</div>
      </header>
    )
  }

  const centered = logoStyle === 'center-circle'
  return (
    <header className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${centered ? 'flex-col text-center' : 'text-left'}`}>
      <div className="h-14 w-14 shrink-0 rounded-full p-1 shadow-sm" style={{ backgroundColor: secondaryColor }}>{mark}</div>
      {title}
    </header>
  )
}
