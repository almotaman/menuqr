import { NextRequest, NextResponse } from 'next/server'
import { Query } from 'node-appwrite'
import { databases, getServerAppwriteConfig } from '@/lib/appwrite'

export async function GET(request: NextRequest) {
  try {
    const subdomain = request.nextUrl.searchParams.get('subdomain')
    const collectionId = process.env.NEXT_PUBLIC_APPWRITE_RESTAURANTS_COLLECTION_ID
    if (!collectionId || !subdomain) return NextResponse.json({ error: 'Restaurant settings are unavailable.' }, { status: 400 })
    const { databaseId } = getServerAppwriteConfig()
    const found = await databases.listDocuments(databaseId, collectionId, [Query.equal('subdomain', subdomain), Query.limit(1)])
    const restaurant = found.documents[0]
    if (!restaurant) return NextResponse.json({ error: 'Restaurant was not found.' }, { status: 404 })
    return NextResponse.json({ restaurant })
  } catch (error) {
    console.error('Restaurant settings lookup failed', error)
    return NextResponse.json({ error: 'Unable to load restaurant settings.' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { subdomain, orderResetIntervalHours, resetNow } = await request.json()
    const collectionId = process.env.NEXT_PUBLIC_APPWRITE_RESTAURANTS_COLLECTION_ID
    if (!collectionId || !subdomain) return NextResponse.json({ error: 'Restaurant settings are unavailable.' }, { status: 400 })
    const { databaseId } = getServerAppwriteConfig()
    const found = await databases.listDocuments(databaseId, collectionId, [Query.equal('subdomain', subdomain), Query.limit(1)])
    const restaurant = found.documents[0]
    if (!restaurant) return NextResponse.json({ error: 'Restaurant was not found.' }, { status: 404 })
    const attributes: Record<string, unknown> = {}
    if (typeof orderResetIntervalHours === 'number' && Number.isFinite(orderResetIntervalHours) && orderResetIntervalHours >= 0) attributes.orderResetIntervalHours = orderResetIntervalHours
    if (resetNow === true) { attributes.currentOrderNumber = 0; attributes.lastOrderResetAt = new Date().toISOString() }
    return NextResponse.json({ restaurant: await databases.updateDocument(databaseId, collectionId, restaurant.$id, attributes) })
  } catch (error) {
    console.error('Restaurant settings update failed', error)
    return NextResponse.json({ error: 'Unable to save restaurant settings.' }, { status: 500 })
  }
}
