'use client'

import { useEffect, useMemo, useState } from 'react'
import { Query } from 'appwrite'
import { CheckCircle2, Clock3, Loader2, LockKeyhole, Printer, RefreshCw } from 'lucide-react'
import { databases, client, getAppwriteConfig } from '@/lib/appwrite'

type OrderItem = {
  name: string
  quantity: number
  price: number
}

type OrderDocument = {
  $id: string
  $createdAt?: string
  table_number?: string | number | null
  items?: string | OrderItem[] | null
  total_price?: number | string | null
  status?: string | null
}

const CHIME_URL = 'https://actions.google.com/sounds/v1/alarms/beep_short.ogg'

function parseOrderItems(items: OrderDocument['items']): OrderItem[] {
  if (Array.isArray(items)) return items
  if (typeof items !== 'string') return []

  try {
    const parsed = JSON.parse(items)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function orderTotal(order: OrderDocument) {
  return Number(order.total_price || 0).toFixed(2)
}

export default function CashierPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [orders, setOrders] = useState<OrderDocument[]>([])
  const [printOrder, setPrintOrder] = useState<OrderDocument | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeOrders = useMemo(
    () => orders.filter(order => order.status === 'pending' || order.status === 'processing'),
    [orders]
  )

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get('token')?.trim()
    const storedToken = window.localStorage.getItem('POS_SECURE_TOKEN')?.trim()

    if (urlToken) {
      window.localStorage.setItem('POS_SECURE_TOKEN', urlToken)
      params.delete('token')
      const cleanQuery = params.toString()
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}${window.location.hash}`
      )
    }

    setAuthorized(Boolean(urlToken || storedToken))
  }, [])

  useEffect(() => {
    if (!authorized) return

    let unsubscribe: (() => void) | undefined
    let cancelled = false

    const loadOrders = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const { databaseId, ordersCollectionId } = getAppwriteConfig()
        const response = await databases.listDocuments(
          databaseId,
          ordersCollectionId,
          [Query.equal('status', ['pending'])]
        )

        if (!cancelled) {
          setOrders(response.documents as unknown as OrderDocument[])
        }

        unsubscribe = client.subscribe(
          `databases.${databaseId}.collections.${ordersCollectionId}.documents`,
          realtimeEvent => {
            const order = realtimeEvent.payload as unknown as OrderDocument
            const isCreated = realtimeEvent.events.some(event => event.endsWith('.create'))
            if (!isCreated || !order.$id || order.status !== 'pending') return

            setOrders(current => [
              order,
              ...current.filter(existing => existing.$id !== order.$id),
            ])
            setPrintOrder(order)
            new Audio(CHIME_URL).play().catch(() => undefined)
            window.setTimeout(() => window.print(), 150)
          }
        )
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load orders.')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void loadOrders()
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [authorized])

  const updateOrderStatus = async (order: OrderDocument, status: 'processing' | 'completed') => {
    try {
      const { databaseId, ordersCollectionId } = getAppwriteConfig()
      await databases.updateDocument(databaseId, ordersCollectionId, order.$id, { status })
      setOrders(current =>
        status === 'completed'
          ? current.filter(existing => existing.$id !== order.$id)
          : current.map(existing =>
              existing.$id === order.$id ? { ...existing, status } : existing
            )
      )
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update order.')
    }
  }

  if (authorized === null) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">Checking terminal access...</main>
  }

  if (!authorized) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center text-slate-100">
        <LockKeyhole className="h-12 w-12 text-amber-400" />
        <h1 className="text-2xl font-semibold">Unauthorized Access</h1>
        <p className="text-slate-400">Please complete on-site terminal setup.</p>
      </main>
    )
  }

  return (
    <>
      <main className="cashier-dashboard min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium uppercase tracking-widest text-amber-400">Kitchen orders</p>
              <h1 className="text-3xl font-bold">Cashier Dashboard</h1>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-emerald-300">Live</span>
              <button
                type="button"
                className="no-print rounded-lg border border-slate-700 p-2 hover:bg-slate-800"
                onClick={() => window.location.reload()}
                aria-label="Refresh orders"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          </header>

          {error && <div className="mb-5 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</div>}
          {isLoading && <div className="mb-5 flex items-center gap-2 text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading orders...</div>}

          {activeOrders.length === 0 && !isLoading ? (
            <div className="rounded-2xl border border-dashed border-slate-700 p-16 text-center text-slate-400">
              No pending kitchen orders.
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {activeOrders.map(order => (
                <article key={order.$id} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-slate-500">Table</p>
                      <h2 className="text-2xl font-bold">{order.table_number || 'N/A'}</h2>
                    </div>
                    <span className="rounded-full bg-amber-400/15 px-3 py-1 text-xs font-semibold uppercase text-amber-300">
                      {order.status || 'pending'}
                    </span>
                  </div>
                  <div className="space-y-2 border-y border-slate-800 py-4">
                    {parseOrderItems(order.items).map((item, index) => (
                      <div key={`${order.$id}-${item.name}-${index}`} className="flex justify-between gap-3">
                        <span><strong>{item.quantity}x</strong> {item.name}</span>
                        <span className="text-slate-400">${(Number(item.price) * item.quantity).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-lg font-bold">Total ${orderTotal(order)}</span>
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <Clock3 className="h-3 w-3" />
                      {order.$createdAt ? new Date(order.$createdAt).toLocaleTimeString() : 'Just now'}
                    </span>
                  </div>
                  <div className="no-print mt-5 flex gap-2">
                    {order.status === 'pending' && (
                      <button type="button" className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold hover:bg-blue-500" onClick={() => updateOrderStatus(order, 'processing')}>
                        Processing
                      </button>
                    )}
                    <button type="button" className="flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold hover:bg-emerald-500" onClick={() => updateOrderStatus(order, 'completed')}>
                      <CheckCircle2 className="mr-1 inline h-4 w-4" /> Completed
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>

      {printOrder && (
        <section className="thermal-receipt">
          <h1>Kitchen Order</h1>
          <p>Table: {printOrder.table_number || 'N/A'}</p>
          <p>{printOrder.$createdAt ? new Date(printOrder.$createdAt).toLocaleString() : ''}</p>
          <hr />
          {parseOrderItems(printOrder.items).map((item, index) => (
            <div key={`${printOrder.$id}-print-${index}`} className="receipt-line">
              <span>{item.quantity}x {item.name}</span>
              <span>${(Number(item.price) * item.quantity).toFixed(2)}</span>
            </div>
          ))}
          <hr />
          <div className="receipt-line"><strong>Total</strong><strong>${orderTotal(printOrder)}</strong></div>
        </section>
      )}

      <style jsx global>{`
        .thermal-receipt { display: none; }
        @media print {
          @page { size: 80mm auto; margin: 0; }
          html, body { width: 80mm; margin: 0; padding: 0; background: #fff !important; }
          .cashier-dashboard { display: none !important; }
          .thermal-receipt {
            display: block !important;
            width: 72mm;
            padding: 4mm;
            color: #000;
            background: #fff;
            font: 12px/1.35 monospace;
          }
          .thermal-receipt h1 { margin: 0 0 3mm; text-align: center; font-size: 16px; }
          .thermal-receipt p { margin: 1mm 0; text-align: center; }
          .thermal-receipt hr { border: 0; border-top: 1px dashed #000; margin: 3mm 0; }
          .receipt-line { display: flex; justify-content: space-between; gap: 3mm; margin: 1.5mm 0; }
        }
      `}</style>
    </>
  )
}
