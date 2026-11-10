import { redirect } from 'next/navigation'

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
    const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT
    const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT
    const apiKey = process.env.APPWRITE_API_KEY
    if (!endpoint || !projectId || !apiKey) {
      throw new Error(
        'Missing Appwrite configuration: NEXT_PUBLIC_APPWRITE_ENDPOINT, ' +
          'NEXT_PUBLIC_APPWRITE_PROJECT, and APPWRITE_API_KEY are required.'
      )
    }

    const queryParams = new URLSearchParams()
    queryParams.append('queries[]', JSON.stringify({
      method: 'equal',
      attribute: 'card_id',
      values: [cardId],
    }))
    queryParams.append('queries[]', JSON.stringify({ method: 'limit', values: [1] }))

    const baseUrl = endpoint.replace(/\/+$/, '')
    const requestUrl =
      `${baseUrl}/databases/tablesdb/collections/6af380dd000646ca1cb8/documents?${queryParams}`
    const response = await fetch(requestUrl, {
      method: 'GET',
      headers: {
        'X-Appwrite-Project': projectId,
        'X-Appwrite-Key': apiKey,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    })
    const result = await response.json() as {
      documents?: CardDocument[]
      message?: string
      code?: number
      type?: string
    }

    if (!response.ok) {
      throw Object.assign(new Error(result.message || `Appwrite returned HTTP ${response.status}`), {
        code: result.code ?? response.status,
        response: result,
      })
    }

    card = result.documents?.[0]
    console.info('Card redirect lookup completed', {
      cardId,
      matchCount: result.documents?.length ?? 0,
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
