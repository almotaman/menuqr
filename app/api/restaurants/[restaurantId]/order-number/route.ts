import { NextRequest, NextResponse } from 'next/server'
import { databases, getServerAppwriteConfig } from '@/lib/appwrite'

type RestaurantDoc = { $id: string; orderResetIntervalHours?: number | null; lastOrderResetAt?: string | null; currentOrderNumber?: number | null }
const locks = new Map<string, Promise<void>>()

async function serialized<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) || Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => { release = resolve })
  locks.set(key, previous.then(() => current))
  await previous
  try { return await action() } finally { release(); if (locks.get(key) === current) locks.delete(key) }
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ restaurantId: string }> }) {
  try {
    const { restaurantId } = await params
    const collectionId = process.env.NEXT_PUBLIC_APPWRITE_RESTAURANTS_COLLECTION_ID
    if (!collectionId) return NextResponse.json({ error: 'Restaurants collection is not configured.' }, { status: 500 })
    const { databaseId } = getServerAppwriteConfig()
    const orderNumber = await serialized(restaurantId, async () => {
      const restaurant = await databases.getDocument(databaseId, collectionId, restaurantId) as unknown as RestaurantDoc
      const now = new Date()
      const interval = Number(restaurant.orderResetIntervalHours || 0)
      const lastReset = restaurant.lastOrderResetAt ? new Date(restaurant.lastOrderResetAt).getTime() : NaN
      const shouldReset = interval > 0 && (!Number.isFinite(lastReset) || now.getTime() - lastReset >= interval * 3600000)
      const next = shouldReset ? 1 : Math.max(0, Number(restaurant.currentOrderNumber) || 0) + 1
      await databases.updateDocument(databaseId, collectionId, restaurantId, { currentOrderNumber: next, ...(shouldReset ? { lastOrderResetAt: now.toISOString() } : {}) })
      return next
    })
    return NextResponse.json({ orderNumber })
  } catch (error) {
    console.error('Order number allocation failed', error)
    return NextResponse.json({ error: 'Unable to allocate an order number.' }, { status: 500 })
  }
}
