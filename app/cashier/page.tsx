'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Query } from 'appwrite'
import { Clock3, Loader2, LockKeyhole, RefreshCw } from 'lucide-react'
import { databases, client, getAppwriteConfig } from '@/lib/appwrite'

type OrderItem = {
  name: string
  quantity: number
  price: number
}

type OrderDocument = {
  $id: string
  $createdAt?: string
  order_number?: string | number | null
  orderNumber?: string | number | null
  restaurant_id?: string | null
  table_number?: string | number | null
  notes?: string | null
  items?: string | OrderItem[] | null
  total_price?: number | string | null
  status?: string | null
}

function getOrderNumber(order: OrderDocument) {
  const value = order.order_number ?? order.orderNumber
  if (value !== null && value !== undefined && String(value).trim()) {
    return String(value).trim()
  }

  return order.$id ? `#${order.$id.slice(-4)}` : '#---'
}

function playSound() {
  try {
    const AudioContextConstructor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextConstructor) return

    const context = new AudioContextConstructor()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(880, context.currentTime)
    gain.gain.setValueAtTime(0.3, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.00001, context.currentTime + 0.5)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.5)
    void context.resume()
  } catch (audioError) {
    console.error('Audio play failed', audioError)
  }
}

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

function isActiveOrderStatus(status: OrderDocument['status']) {
  return status === 'pending' ||
    status === 'processing' ||
    status === 'Sent to Kitchen'
}

export default function CashierPage() {
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const [restaurantId, setRestaurantId] = useState<string | null>(null)
  const [workspaceStatus, setWorkspaceStatus] = useState<'checking' | 'valid' | 'invalid'>('checking')
  const [orders, setOrders] = useState<OrderDocument[]>([])
  const [printOrder, setPrintOrder] = useState<OrderDocument | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [audioEnabled, setAudioEnabled] = useState(false)
  const handledRealtimeOrderIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!printOrder) return

    const printTimer = window.setTimeout(() => {
      window.print()
    }, 100)

    return () => window.clearTimeout(printTimer)
  }, [printOrder])

  const activeOrders = useMemo(
    () => orders.filter(order => isActiveOrderStatus(order.status)),
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
    if (!authorized) {
      setWorkspaceStatus('checking')
      setRestaurantId(null)
      return
    }

    let unsubscribe: (() => void) | undefined
    let cancelled = false
    handledRealtimeOrderIds.current.clear()

    const loadOrders = async () => {
      setIsLoading(true)
      setError(null)
      setWorkspaceStatus('checking')
      setRestaurantId(null)

      try {
        const {
          databaseId,
          restaurantsCollectionId,
          ordersCollectionId,
        } = getAppwriteConfig()
        const hostname = window.location.hostname
        const targetSubdomain = hostname.includes('vercel.app') ||
          hostname.includes('localhost')
          ? 'burgerhouse'
          : hostname.split('.')[0]
        const restaurantResponse = await databases.listDocuments(
          databaseId,
          restaurantsCollectionId,
          [Query.equal('subdomain', targetSubdomain)]
        )
        const restaurant = restaurantResponse.documents[0] as { $id?: string } | undefined
        const currentRestaurantId = restaurant?.$id

        if (!currentRestaurantId) {
          if (!cancelled) setWorkspaceStatus('invalid')
          return
        }

        if (!cancelled) {
          setRestaurantId(currentRestaurantId)
          setWorkspaceStatus('valid')
        }

        const response = await databases.listDocuments(
          databaseId,
          ordersCollectionId,
          [
            Query.equal('restaurant_id', currentRestaurantId),
            Query.equal('status', ['pending', 'processing', 'Sent to Kitchen']),
            Query.orderDesc('$createdAt'),
          ]
        )

        if (!cancelled) {
          setOrders(
            (response.documents as unknown as OrderDocument[]).filter(
              order => order.restaurant_id === currentRestaurantId
            )
          )
        }

        if (cancelled) return

        const stopSubscription = client.subscribe(
          `databases.${databaseId}.collections.${ordersCollectionId}.documents`,
          async realtimeEvent => {
            if (cancelled) return

            const order = realtimeEvent.payload as unknown as OrderDocument
            const isCreated = realtimeEvent.events.some(event => event.endsWith('.create'))
            if (
              !isCreated ||
              !order.$id ||
              order.restaurant_id !== currentRestaurantId ||
              !isActiveOrderStatus(order.status)
            ) return

            if (handledRealtimeOrderIds.current.has(order.$id)) return
            handledRealtimeOrderIds.current.add(order.$id)

            let completeOrder = order
            try {
              completeOrder = await databases.getDocument(
                databaseId,
                ordersCollectionId,
                order.$id
              ) as unknown as OrderDocument
            } catch (fetchError) {
              console.error('Failed to fetch complete realtime order document', fetchError)
            }

            if (cancelled) return

            setOrders(current => [
              completeOrder,
              ...current.filter(existing => existing.$id !== completeOrder.$id),
            ])
            setPrintOrder(completeOrder)
            playSound()
          }
        )
        unsubscribe = stopSubscription
      } catch (loadError) {
        if (!cancelled) {
          setWorkspaceStatus('invalid')
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

  if (workspaceStatus === 'checking') {
    return <main className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">Resolving restaurant workspace...</main>
  }

  if (workspaceStatus === 'invalid' || !restaurantId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center text-slate-100">
        <h1 className="text-2xl font-semibold">Invalid Restaurant Workspace</h1>
        <p className="text-slate-400">This cashier terminal is not linked to a valid restaurant.</p>
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
                className="no-print rounded-lg border border-slate-700 px-3 py-2 hover:bg-slate-800"
                onClick={() => {
                  playSound()
                  setAudioEnabled(true)
                }}
              >
                {audioEnabled ? 'Audio Enabled' : 'Enable Audio Alerts'}
              </button>
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
                  {order.notes?.trim() && (
                    <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-100">
                      <strong>Note:</strong> {order.notes}
                    </div>
                  )}
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-lg font-bold">Total ${orderTotal(order)}</span>
                    <span className="flex items-center gap-1 text-xs text-slate-500">
                      <Clock3 className="h-3 w-3" />
                      {order.$createdAt ? new Date(order.$createdAt).toLocaleTimeString() : 'Just now'}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>

      {printOrder && (
        <section id="thermal-receipt" className="thermal-receipts">
          <div className="thermal-receipt receipt-kitchen">
            <h1>--- KITCHEN TICKET ---</h1>
            <p className="receipt-order-number">
              {getOrderNumber(printOrder)}
            </p>
            <p className="receipt-table">{printOrder.table_number || 'N/A'}</p>
            <p>{printOrder.$createdAt ? new Date(printOrder.$createdAt).toLocaleString() : ''}</p>
            {printOrder.notes?.trim() && <p className="receipt-note">NOTE: {printOrder.notes}</p>}
            <hr />
            {parseOrderItems(printOrder.items).map((item, index) => (
              <div key={`${printOrder.$id}-kitchen-${index}`} className="receipt-line receipt-item">
                <strong>{item.quantity}x {item.name}</strong>
              </div>
            ))}
          </div>
          <div className="thermal-receipt receipt-customer">
            <h1>--- CUSTOMER CHECK ---</h1>
            <p className="receipt-order-number">
              {getOrderNumber(printOrder)}
            </p>
            <p className="receipt-table">{printOrder.table_number || 'N/A'}</p>
            <p>{printOrder.$createdAt ? new Date(printOrder.$createdAt).toLocaleString() : ''}</p>
            {printOrder.notes?.trim() && <p className="receipt-note">NOTE: {printOrder.notes}</p>}
            <hr />
            {parseOrderItems(printOrder.items).map((item, index) => (
              <div key={`${printOrder.$id}-customer-${index}`} className="receipt-line">
                <span>{item.quantity}x {item.name}</span>
                <span>${(Number(item.price) * item.quantity).toFixed(2)}</span>
              </div>
            ))}
            <hr />
            <div className="receipt-line"><strong>Subtotal</strong><strong>${orderTotal(printOrder)}</strong></div>
            <div className="receipt-line receipt-total"><strong>Grand Total</strong><strong>${orderTotal(printOrder)}</strong></div>
            <p className="receipt-footer">Thank you for dining with us!</p>
          </div>
        </section>
      )}

      <style jsx global>{`
        .thermal-receipts { display: none; }
        @media print {
          @page { size: 80mm auto; margin: 0; }
          html, body { width: 80mm; margin: 0; padding: 0; background: #fff !important; }
          .cashier-dashboard { display: none !important; }
          .no-print { display: none !important; }
          .thermal-receipts { display: block !important; width: 80mm; }
          .thermal-receipt {
            display: block !important;
            width: 72mm;
            padding: 4mm;
            color: #000;
            background: #fff;
            font: 12px/1.35 monospace;
          }
          .receipt-kitchen {
            page-break-after: always;
            break-after: page;
          }
          .thermal-receipt h1 { margin: 0 0 4mm; text-align: center; font-size: 16px; font-weight: 900; }
          .thermal-receipt p { margin: 1mm 0; text-align: center; }
          .thermal-receipt .receipt-order-number {
            display: block !important;
            visibility: visible !important;
            margin: 1mm 0 2mm !important;
            text-align: center;
            font-size: 18px;
            line-height: 1.2;
            font-weight: 900;
          }
          .thermal-receipt .receipt-table { font-size: 20px; font-weight: 900; }
          .thermal-receipt .receipt-note {
            margin: 3mm 0 !important;
            border: 1px solid #000;
            padding: 2mm;
            text-align: left;
            font-weight: 900;
          }
          .thermal-receipt hr { border: 0; border-top: 1px dashed #000; margin: 3mm 0; }
          .receipt-line { display: flex; justify-content: space-between; gap: 3mm; margin: 1.5mm 0; }
          .receipt-item { justify-content: flex-start; font-size: 15px; }
          .receipt-total { margin-top: 3mm; font-size: 15px; }
          .receipt-footer { margin-top: 8mm !important; font-weight: 700; }
        }
      `}</style>
    </>
  )
}
