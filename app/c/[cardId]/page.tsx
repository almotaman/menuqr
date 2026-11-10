import { Query } from 'node-appwrite'
import { redirect } from 'next/navigation'
import { databases } from '@/lib/appwrite'

export const dynamic = 'force-dynamic'

type CardDocument = {
  card_id?: string
  is_active?: boolean
  target_url?: string
}

function unavailableMessage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-center text-slate-100">
      <div className="max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
        <h1 className="text-2xl font-bold">Card unavailable</h1>
        <p className="mt-3 text-slate-400">
          This card could not be found or is currently inactive. Please contact the card owner.
        </p>
      </div>
    </main>
  )
}

export default async function CardRedirectPage({
  params,
}: {
  params: Promise<{ cardId: string }>
}) {
  const { cardId } = await params

  let card: CardDocument | undefined
  try {
    const result = await databases.listDocuments(
      'tablesdb',
      '6af380dd000646ca1cb8',
      [Query.equal('card_id', cardId), Query.limit(1)]
    )
    card = result.documents[0] as unknown as CardDocument | undefined
    console.info('Card redirect lookup completed', {
      cardId,
      matchCount: result.documents.length,
      isActive: card?.is_active,
      hasTargetUrl: Boolean(card?.target_url),
    })
  } catch (error) {
    const details = error && typeof error === 'object'
      ? error as { message?: unknown; code?: unknown; response?: unknown }
      : undefined
    console.error('Could not resolve QR/NFC card redirect', {
      cardId,
      message: details?.message ?? String(error),
      code: details?.code,
      response: details?.response,
      error,
    })
    return unavailableMessage()
  }

  if (!card) {
    console.warn('No Appwrite card matched the requested cardId', { cardId })
    return unavailableMessage()
  }

  if (card.is_active !== true) {
    console.warn('Appwrite card is inactive', { cardId, isActive: card.is_active })
    return unavailableMessage()
  }

  const targetUrl = card.target_url?.trim()
  if (!targetUrl) {
    console.warn('Appwrite card has no target_url', { cardId })
    return unavailableMessage()
  }

  try {
    const target = new URL(targetUrl)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      console.warn('Appwrite card target_url has an unsupported protocol', {
        cardId,
        protocol: target.protocol,
      })
      return unavailableMessage()
    }
  } catch {
    console.warn('Appwrite card target_url is not a valid URL', { cardId })
    return unavailableMessage()
  }

  redirect(targetUrl)
}
