import { NextRequest, NextResponse } from 'next/server'
import { databases, getServerAppwriteConfig } from '@/lib/appwrite'
import { isWithinLast24Hours } from '@/lib/order-guards'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params
    const { databaseId } = getServerAppwriteConfig()
    const collectionId = process.env.NEXT_PUBLIC_APPWRITE_ORDERS_COLLECTION_ID || process.env.NEXT_PUBLIC_APPWRITE_COLLECTION_ID
    if (!collectionId) return NextResponse.json({ error: 'Orders collection is not configured.' }, { status: 500 })
    const order = await databases.getDocument(databaseId, collectionId, orderId)
    if (order.$id !== orderId || !isWithinLast24Hours(order.$createdAt)) return NextResponse.json({ error: 'This order is outside the paging window.' }, { status: 410 })
    const body = await request.json().catch(() => ({}))
    if (body.action === 'arm') {
      const updated = await databases.updateDocument(databaseId, collectionId, orderId, {
        pageMeRequested: true,
        pagedAt: null,
        status: order.status || 'Sent to Kitchen',
      })
      return NextResponse.json({ order: updated })
    }
    if (!['Sent to Kitchen', 'Preparing', 'Done'].includes(body.status)) return NextResponse.json({ error: 'Invalid order status.' }, { status: 400 })
    if (body.status !== 'Done') return NextResponse.json({ order: await databases.updateDocument(databaseId, collectionId, orderId, { status: body.status }) })
    if (order.pageMeRequested === true && !order.pagedAt) {
      const updated = await databases.updateDocument(databaseId, collectionId, orderId, { status: 'Done', pagedAt: new Date().toISOString() })
      return NextResponse.json({ order: updated, paged: true })
    }
    return NextResponse.json({ order: await databases.updateDocument(databaseId, collectionId, orderId, { status: 'Done' }), paged: false })
  } catch (error) {
    console.error('Pager update failed', error)
    return NextResponse.json({ error: 'Unable to update this order.' }, { status: 500 })
  }
}
