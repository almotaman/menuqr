import { NextRequest, NextResponse } from 'next/server'
import { getServerAppwriteConfig } from '@/lib/appwrite'
import { AppwriteRestError, appwriteRestRequest, getSafeErrorCauses } from '@/lib/appwrite-rest'
import { isWithinLast24Hours } from '@/lib/order-guards'

export const runtime = 'nodejs'

type OrderDocument = {
  $id: string
  $createdAt?: string
  status?: string | null
  pageMeRequested?: boolean
  pagedAt?: string | null
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params
  try {
    const collectionId = (process.env.NEXT_PUBLIC_APPWRITE_ORDERS_COLLECTION_ID || process.env.NEXT_PUBLIC_APPWRITE_COLLECTION_ID)?.trim()
    if (!collectionId) return NextResponse.json({ error: 'Orders collection is not configured.' }, { status: 500 })
    const config = getServerAppwriteConfig()
    const documentUrl = `${config.endpoint}/databases/${encodeURIComponent(config.databaseId)}/collections/${encodeURIComponent(collectionId)}/documents/${encodeURIComponent(orderId)}`
    const order = await appwriteRestRequest<OrderDocument>('read order', documentUrl, config)
    if (order.$id !== orderId) return NextResponse.json({ error: 'Order ID did not match the requested order.' }, { status: 404 })
    if (!isWithinLast24Hours(order.$createdAt)) return NextResponse.json({ error: 'This order is outside the 24-hour paging window.' }, { status: 410 })
    const body = await request.json().catch(() => ({})) as { action?: unknown; status?: unknown }
    const updateOrder = (data: Record<string, unknown>) => appwriteRestRequest<OrderDocument>('update order', documentUrl, config, {
      method: 'PUT',
      body: JSON.stringify({ data }),
    })

    if (body.action === 'arm') {
      const updated = await updateOrder({
        pageMeRequested: true,
        pagedAt: null,
        status: order.status || 'Sent to Kitchen',
      })
      return NextResponse.json({ order: updated })
    }
    if (typeof body.status !== 'string' || !['Sent to Kitchen', 'Preparing', 'Done'].includes(body.status)) {
      return NextResponse.json({ error: 'Invalid order status. Use Sent to Kitchen, Preparing, or Done.' }, { status: 400 })
    }
    if (body.status !== 'Done') return NextResponse.json({ order: await updateOrder({ status: body.status }) })
    if (order.pageMeRequested === true && !order.pagedAt) {
      const updated = await updateOrder({ status: 'Done', pagedAt: new Date().toISOString() })
      return NextResponse.json({ order: updated, paged: true })
    }
    return NextResponse.json({ order: await updateOrder({ status: 'Done' }), paged: false })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const apiKey = process.env.APPWRITE_API_KEY?.trim()
    console.error('Pager update failed', {
      orderId,
      operation: error instanceof AppwriteRestError ? error.details.operation : 'configuration or request handling',
      ...(error instanceof AppwriteRestError ? error.details : {}),
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: errorMessage.slice(0, 300).replace(apiKey || /$^/, '[REDACTED]'),
      causes: getSafeErrorCauses(error),
    })
    if (error instanceof AppwriteRestError) {
      return NextResponse.json({ error: error.message, ...(error.details.code ? { code: error.details.code } : {}), ...(error.details.type ? { type: error.details.type } : {}) }, { status: error.details.status || 502 })
    }
    return NextResponse.json({ error: 'Pager request could not be completed. Check server Appwrite configuration and try again.' }, { status: 500 })
  }
}
