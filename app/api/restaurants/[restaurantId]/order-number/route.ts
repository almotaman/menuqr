import { NextRequest, NextResponse } from 'next/server'
import { getServerAppwriteConfig } from '@/lib/appwrite'

export const runtime = 'nodejs'

type RestaurantDoc = { $id: string; orderResetIntervalHours?: number | null; lastOrderResetAt?: string | null; currentOrderNumber?: number | null }
const locks = new Map<string, Promise<void>>()

function getSafeErrorCauses(error: unknown) {
  const causes: Array<{ name?: string; code?: string; message?: string }> = []
  let current = error
  const apiKey = process.env.APPWRITE_API_KEY?.trim()
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const value = current as { name?: string; code?: string; message?: string; cause?: unknown }
    causes.push({
      name: value.name,
      code: value.code,
      message: value.message?.slice(0, 300).replace(apiKey || /$^/, '[REDACTED]'),
    })
    current = value.cause
  }
  return causes
}

class AppwriteRequestError extends Error {
  constructor(
    message: string,
    readonly details: { operation: string; status?: number; code?: number; type?: string },
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = 'AppwriteRequestError'
  }
}

async function appwriteRequest<T>(
  operation: string,
  url: string,
  config: ReturnType<typeof getServerAppwriteConfig>,
  init?: RequestInit
): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('X-Appwrite-Project', config.projectId)
  headers.set('X-Appwrite-Key', config.apiKey)
  if (init?.body) headers.set('Content-Type', 'application/json')
  // Use Node's native fetch without an SDK-supplied Undici dispatcher. This
  // avoids passing an Agent from a different Undici version into Vercel's fetch.
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      cache: 'no-store',
      headers,
    })
  } catch (error) {
    throw new AppwriteRequestError(`Appwrite ${operation} network request failed.`, { operation }, error)
  }

  const body = await response.json().catch(() => null) as (T & { message?: string; code?: number; type?: string }) | null
  if (!response.ok) {
    throw new AppwriteRequestError(body?.message || `Appwrite ${operation} request failed.`, {
      operation,
      status: response.status,
      code: body?.code,
      type: body?.type,
    })
  }
  if (!body) throw new Error(`Appwrite ${operation} returned an empty or invalid JSON response.`)
  return body as T
}

async function serialized<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) || Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => { release = resolve })
  const queued = previous.then(() => current)
  locks.set(key, queued)
  await previous
  try { return await action() } finally { release(); if (locks.get(key) === queued) locks.delete(key) }
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params
  try {
    const collectionId = process.env.NEXT_PUBLIC_APPWRITE_RESTAURANTS_COLLECTION_ID?.trim()
    if (!collectionId) return NextResponse.json({ error: 'Restaurants collection is not configured.' }, { status: 500 })
    const config = getServerAppwriteConfig()
    const { databaseId } = config
    const documentUrl = `${config.endpoint}/databases/${encodeURIComponent(databaseId)}/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(restaurantId)}`
    const orderNumber = await serialized(restaurantId, async () => {
      const restaurant = await appwriteRequest<RestaurantDoc>('read restaurant', documentUrl, config)
      const now = new Date()
      const interval = Number(restaurant.orderResetIntervalHours || 0)
      const lastReset = restaurant.lastOrderResetAt ? new Date(restaurant.lastOrderResetAt).getTime() : NaN
      const shouldReset = interval > 0 && (!Number.isFinite(lastReset) || now.getTime() - lastReset >= interval * 3600000)
      const next = shouldReset ? 1 : Math.max(0, Number(restaurant.currentOrderNumber) || 0) + 1
      await appwriteRequest<RestaurantDoc>('update restaurant', documentUrl, config, {
        method: 'PUT',
        body: JSON.stringify({ data: { currentOrderNumber: next, ...(shouldReset ? { lastOrderResetAt: now.toISOString() } : {}) } }),
      })
      return next
    })
    return NextResponse.json({ orderNumber })
  } catch (error) {
    const causes = getSafeErrorCauses(error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    const apiKey = process.env.APPWRITE_API_KEY?.trim()
    console.error('Order number allocation failed', {
      restaurantId,
      operation: error instanceof AppwriteRequestError ? error.details.operation : 'configuration or allocation',
      ...(error instanceof AppwriteRequestError ? error.details : {}),
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: errorMessage.slice(0, 300).replace(apiKey || /$^/, '[REDACTED]'),
      causes,
    })
    return NextResponse.json({ error: 'Unable to allocate an order number.' }, { status: 500 })
  }
}
