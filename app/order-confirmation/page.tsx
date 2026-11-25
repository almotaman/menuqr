'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, Download, Share2 } from 'lucide-react'
import { client, databases, getAppwriteConfig } from '@/lib/appwrite-client'
import { isWithinLast24Hours } from '@/lib/order-guards'
import RestaurantLogoHeader from '@/components/restaurant-logo-header'
import { resolveRestaurantTheme, type LogoStyle } from '@/lib/restaurant-theme'

type ReceiptItem = {
  name: string
  quantity: number
  price: number
  variantName?: string
  variantPrice?: number
  addOns?: Array<{ name: string; price: number }>
  notes?: string
}

type StoredOrder = {
  orderId?: string
  orderNumber?: string | number
  tableNumber?: string | number
  diningMode?: string
  items?: ReceiptItem[]
  totalAmount?: number
  timestamp?: string
  createdAt?: string
  status?: string
  pagedAt?: string | null
  pageMeRequested?: boolean
  brand?: {
    restaurantName?: string
    restaurantSlug?: string
    logoUrl?: string | null
    theme?: { primaryColor: string; secondaryColor: string; backgroundColor: string; logoStyle: LogoStyle }
  }
}

function normalizeStatus(status?: string | null) {
  const value = String(status || '').trim().toLowerCase()
  if (value === 'done') return 'Done'
  if (value === 'preparing') return 'Preparing'
  return 'Sent to Kitchen'
}

function pagerStorageKey(kind: 'alerted' | 'acknowledged', orderId: string) {
  return `menuqr:pager:${kind}:${orderId}`
}

function money(value: number) {
  return `${Number(value || 0).toFixed(2)} EGP`
}

export default function OrderConfirmationPage() {
  const receiptRef = useRef<HTMLDivElement>(null)
  const alertAudioRef = useRef<HTMLAudioElement>(null)
  const alertTimerRef = useRef<number | null>(null)
  const alertActiveRef = useRef(false)
  const activeOrderIdRef = useRef('')
  const prevStatusRef = useRef<{ orderId: string; status: string; pagedAt: string | null }>({ orderId: '', status: '', pagedAt: null })
  const statusEventCountRef = useRef(0)
  const alertedOrderIdsRef = useRef(new Set<string>())
  const isPagedArmedRef = useRef(false)
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null)
  const [order, setOrder] = useState<StoredOrder | null>(null)
  const [pagerMessage, setPagerMessage] = useState('')
  const [isPaging, setIsPaging] = useState(false)
  const [isPagedArmed, setIsPagedArmed] = useState(false)
  const [alertAcknowledged, setAlertAcknowledged] = useState(false)

  const syncOrder = useCallback(async (orderId: string) => {
    const eventCountAtRequest = statusEventCountRef.current
    const { databaseId, ordersCollectionId } = getAppwriteConfig()
    const document = await databases.getDocument(databaseId, ordersCollectionId, orderId)
    if (document.$id !== orderId || activeOrderIdRef.current !== orderId) return
    if (statusEventCountRef.current !== eventCountAtRequest) return
    if (!isWithinLast24Hours(document.$createdAt)) {
      isPagedArmedRef.current = false
      setIsPagedArmed(false)
      setOrder(current => current?.orderId === orderId ? { ...current, createdAt: document.$createdAt, pageMeRequested: false } : current)
      return
    }
    setOrder(current => current?.orderId === orderId ? {
      ...current,
      createdAt: document.$createdAt,
      status: normalizeStatus(String(document.status || '')),
      pagedAt: document.pagedAt || null,
      pageMeRequested: document.pageMeRequested === true,
    } : current)
    prevStatusRef.current = {
      orderId,
      status: normalizeStatus(String(document.status || '')).toLowerCase(),
      pagedAt: document.pagedAt || null,
    }
    isPagedArmedRef.current = document.pageMeRequested === true
    setIsPagedArmed(isPagedArmedRef.current)
    try {
      setAlertAcknowledged(localStorage.getItem(pagerStorageKey('acknowledged', orderId)) === '1')
    } catch { setAlertAcknowledged(false) }
  }, [])

  const stopReadyAlert = useCallback(() => {
    alertActiveRef.current = false
    if (alertTimerRef.current !== null) window.clearTimeout(alertTimerRef.current)
    alertTimerRef.current = null
    const audio = alertAudioRef.current
    if (audio) {
      audio.onended = null
      audio.onerror = null
      audio.pause()
      audio.loop = false
      try { audio.currentTime = 0 } catch {}
    }
    if (wakeLockRef.current) {
      void wakeLockRef.current.release().catch(() => undefined)
      wakeLockRef.current = null
    }
  }, [])

  const startReadyAlert = useCallback(() => {
    if (alertActiveRef.current) return
    const audio = alertAudioRef.current
    if (!audio) return
    alertActiveRef.current = true
    audio.loop = false
    audio.muted = false
    audio.volume = 0.65
    audio.onended = () => {
      if (!alertActiveRef.current) return
      alertTimerRef.current = window.setTimeout(() => {
        if (!alertActiveRef.current) return
        try { audio.currentTime = 0 } catch {}
        void audio.play().catch(error => {
          alertActiveRef.current = false
          console.warn('Order-ready audio could not replay', error)
        })
      }, 15000)
    }
    audio.onerror = () => {
      alertActiveRef.current = false
      console.warn('Order-ready audio file is unavailable.')
    }
    try { audio.currentTime = 0 } catch {}
    void audio.play().catch(error => {
      alertActiveRef.current = false
      audio.onended = null
      audio.pause()
      audio.loop = false
      console.warn('Order-ready audio could not play', error)
    })
  }, [])

  useEffect(() => {
    window.addEventListener('pagehide', stopReadyAlert)
    return () => {
      window.removeEventListener('pagehide', stopReadyAlert)
      stopReadyAlert()
    }
  }, [stopReadyAlert])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    let stored: StoredOrder = {}
    try {
      stored = JSON.parse(localStorage.getItem('last_placed_order') || '{}') as StoredOrder
    } catch (error) {
      console.error('Unable to read the saved order receipt', error)
    }
    setOrder({
      ...stored,
      orderId: params.get('orderId') || stored.orderId,
      tableNumber: params.get('table') || stored.tableNumber,
      diningMode: params.get('mode') || stored.diningMode,
    })
    activeOrderIdRef.current = params.get('orderId') || stored.orderId || ''
    if (stored.orderId) {
      prevStatusRef.current = { orderId: params.get('orderId') || stored.orderId, status: normalizeStatus(stored.status), pagedAt: stored.pagedAt || null }
      try { setAlertAcknowledged(localStorage.getItem(pagerStorageKey('acknowledged', params.get('orderId') || stored.orderId)) === '1') } catch {}
    }
  }, [])

  useEffect(() => {
    if (!order?.orderId) return
    statusEventCountRef.current = 0
    isPagedArmedRef.current = false
    setIsPagedArmed(false)
    void syncOrder(order.orderId).catch(error => console.error('Unable to load order pager details', error))
  }, [order?.orderId, syncOrder])

  useEffect(() => {
    const orderId = order?.orderId
    if (!orderId) return
    const syncWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void syncOrder(orderId).catch(error => console.error('Unable to refresh active order', error))
      }
    }
    document.addEventListener('visibilitychange', syncWhenVisible)
    window.addEventListener('focus', syncWhenVisible)
    return () => {
      document.removeEventListener('visibilitychange', syncWhenVisible)
      window.removeEventListener('focus', syncWhenVisible)
    }
  }, [order?.orderId, syncOrder])

  useEffect(() => {
    if (!order?.orderId || activeOrderIdRef.current !== order.orderId || !order.createdAt || !isWithinLast24Hours(order.createdAt)) return
    const { databaseId, ordersCollectionId } = getAppwriteConfig()
    const unsubscribe = client.subscribe(`databases.${databaseId}.collections.${ordersCollectionId}.documents.${order.orderId}`, event => {
      const updated = event.payload as { $id?: string; $createdAt?: string; status?: string; pagedAt?: string | null; pageMeRequested?: boolean }
      const createdAt = updated.$createdAt || order.createdAt
      if (updated.$id !== order.orderId || !isWithinLast24Hours(createdAt)) return
      statusEventCountRef.current += 1
      const currentStatus = normalizeStatus(updated.status)
      prevStatusRef.current = { orderId: order.orderId!, status: currentStatus.toLowerCase(), pagedAt: updated.pagedAt || null }
      setOrder(current => current?.orderId === order.orderId ? {
        ...current,
        status: updated.status === undefined ? current.status : normalizeStatus(updated.status),
        pagedAt: updated.pagedAt === undefined ? current.pagedAt : updated.pagedAt,
        pageMeRequested: updated.pageMeRequested === undefined ? current.pageMeRequested : updated.pageMeRequested,
      } : current)
      if (typeof updated.pageMeRequested === 'boolean') {
        isPagedArmedRef.current = updated.pageMeRequested
        setIsPagedArmed(updated.pageMeRequested)
      }
    })
    return () => unsubscribe()
  }, [order?.orderId, order?.createdAt, order?.orderNumber, startReadyAlert])

  useEffect(() => {
    if (!order?.orderId || activeOrderIdRef.current !== order.orderId || !order.createdAt || !isWithinLast24Hours(order.createdAt)) return
    if (!isPagedArmed || !isPagedArmedRef.current || normalizeStatus(order.status) !== 'Done') return

    const acknowledgedKey = pagerStorageKey('acknowledged', order.orderId)
    const alertedKey = pagerStorageKey('alerted', order.orderId)
    if (alertedOrderIdsRef.current.has(order.orderId)) return
    try {
      if (localStorage.getItem(acknowledgedKey) === '1') {
        setAlertAcknowledged(true)
        return
      }
      if (localStorage.getItem(alertedKey) === '1') return
      localStorage.setItem(alertedKey, '1')
    } catch (error) {
      console.warn('Unable to persist pager alert state', error)
    }

    alertedOrderIdsRef.current.add(order.orderId)
    setAlertAcknowledged(false)
    setPagerMessage(`Your order is ready — طلبك جاهز للاستلام (#${order.orderNumber ?? '—'})`)
    startReadyAlert()
  }, [order?.orderId, order?.createdAt, order?.orderNumber, order?.status, isPagedArmed, startReadyAlert])

  const armPager = async () => {
    if (!order?.orderId || !order.createdAt || !isWithinLast24Hours(order.createdAt)) {
      setPagerMessage('Paging is available for orders placed within the last 24 hours.')
      return
    }
    setIsPaging(true)
    try {
      const alertAudio = alertAudioRef.current
      if (alertAudio) {
        alertAudio.preload = 'auto'
        alertAudio.load()
        alertAudio.muted = true
        try {
          await alertAudio.play()
          alertAudio.pause()
          try { alertAudio.currentTime = 0 } catch {}
        } catch {
          // Keep arming even if the browser cannot unlock audio on this device.
        } finally {
          alertAudio.muted = false
        }
      }
      const wakeLockNavigator = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<unknown> } }
      if (wakeLockNavigator.wakeLock) wakeLockRef.current = await wakeLockNavigator.wakeLock.request('screen').catch(() => null) as { release: () => Promise<void> } | null
      const observedEventsAtArm = statusEventCountRef.current
      const response = await fetch(`/api/orders/${encodeURIComponent(order.orderId)}/pager`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'arm' }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to arm pager.')
      if (statusEventCountRef.current === observedEventsAtArm) {
        prevStatusRef.current = { orderId: order.orderId, status: normalizeStatus(result.order?.status || order.status), pagedAt: result.order?.pagedAt || null }
        setOrder(current => current?.orderId === order.orderId ? {
          ...current,
          status: normalizeStatus(result.order?.status || current.status),
          pagedAt: result.order?.pagedAt || null,
          pageMeRequested: true,
        } : current)
      } else {
        setOrder(current => current?.orderId === order.orderId ? { ...current, pageMeRequested: true } : current)
      }
      isPagedArmedRef.current = true
      setIsPagedArmed(true)
      setPagerMessage(`We’ll alert you when order #${order.orderNumber ?? '—'} is ready.`)
    } catch (error) { setPagerMessage(error instanceof Error ? error.message : 'Unable to arm pager.') }
    finally { setIsPaging(false) }
  }

  const downloadOrShareReceipt = async () => {
    if (!receiptRef.current) return
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(receiptRef.current, {
        backgroundColor: '#ffffff',
        scale: Math.min(window.devicePixelRatio || 1, 2),
      })
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Could not create the receipt image.')
      const file = new File([blob], `receipt-${order?.orderId || 'order'}.png`, { type: 'image/png' })
      if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Order receipt' })
        return
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file.name
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Unable to share or download receipt', error)
      window.alert('The receipt could not be exported. Please try again.')
    }
  }

  const backToMenu = () => {
    stopReadyAlert()
    localStorage.removeItem('last_placed_order')
    const params = new URLSearchParams(window.location.search)
    const restaurantSlug = params.get('restaurantSlug') || window.location.hostname.split('.')[0] || 'restaurant'
    const table = params.get('table') || params.get('table_number') || params.get('t') ||
      (order?.tableNumber != null ? String(order.tableNumber) : null) ||
      (() => { try { return window.sessionStorage.getItem(`3ainly_table_${restaurantSlug}`) } catch { return null } })()
    const requestedPath = params.get('menuPath')
    const menuPath = requestedPath?.startsWith('/') && !requestedPath.startsWith('//') ? requestedPath : '/'
    const menuUrl = new URL(menuPath, window.location.origin)
    if (table) {
      menuUrl.searchParams.set('table', table)
      try { window.sessionStorage.setItem(`3ainly_table_${restaurantSlug}`, table) } catch {}
    }
    window.location.href = `${menuUrl.pathname}${menuUrl.search}${menuUrl.hash}`
  }

  const dismissReadyAlert = () => {
    if (!order?.orderId) return
    try {
      localStorage.setItem(pagerStorageKey('acknowledged', order.orderId), '1')
      localStorage.setItem(pagerStorageKey('alerted', order.orderId), '1')
    } catch (error) { console.warn('Unable to save pager acknowledgement', error) }
    alertedOrderIdsRef.current.add(order.orderId)
    setAlertAcknowledged(true)
    stopReadyAlert()
  }

  const items = order?.items || []
  const currentStage = normalizeStatus(order?.status)
  const isWithinPagerWindow = Boolean(order?.createdAt && isWithinLast24Hours(order.createdAt))
  const total = Number(order?.totalAmount ?? items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0))
  const receiptTheme = order?.brand?.theme || resolveRestaurantTheme({}, order?.brand?.restaurantSlug || 'restaurant', 'receipt')

  return (
    <main className="flex min-h-[100dvh] items-center justify-center px-4 py-5 sm:px-6" style={{ backgroundColor: receiptTheme.backgroundColor, color: receiptTheme.primaryColor }}>
      <div className="flex max-h-[calc(100dvh-2.5rem)] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <header className="shrink-0 px-6 py-5 text-center" style={{ backgroundColor: receiptTheme.primaryColor, color: receiptTheme.secondaryColor }}>
          <RestaurantLogoHeader name={order?.brand?.restaurantName || 'Restaurant'} logoUrl={order?.brand?.logoUrl} logoStyle={receiptTheme.logoStyle} primaryColor={receiptTheme.secondaryColor} secondaryColor={receiptTheme.primaryColor} compact />
          <CheckCircle2 className="mx-auto mb-2 h-12 w-12" />
          <h1 className="text-2xl font-bold">Order Confirmed</h1>
          <p className="mt-1 text-sm text-emerald-50">Your order has been received by the restaurant.</p>
        </header>

        {currentStage === 'Done' && <div role="alert" className="border-b-4 border-emerald-700 bg-emerald-500 px-5 py-5 text-center text-white shadow-lg"><p className="text-xl font-extrabold">Done — Ready for Pickup</p><p className="mt-1 font-semibold">Order #{order?.orderNumber ?? '—'} · Please collect your order</p><button type="button" onClick={dismissReadyAlert} disabled={alertAcknowledged} className="mt-3 rounded-lg border border-white/80 px-4 py-2 text-sm font-bold hover:bg-emerald-600 disabled:opacity-80">{alertAcknowledged ? 'Got It' : 'Got It / Dismiss Alert'}</button></div>}

        <section ref={receiptRef} className="min-h-0 flex-1 overflow-y-auto bg-white p-5 sm:p-6">
          <div className="mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">Order progress</p>
            <ol className="grid grid-cols-3 gap-2 text-center text-xs sm:text-sm">
              {(['Sent to Kitchen', 'Preparing', 'Done'] as const).map((stage, index) => {
                const stageIndex = ['Sent to Kitchen', 'Preparing', 'Done'].indexOf(currentStage)
                const complete = stageIndex >= index
                return <li key={stage} className={`rounded-lg px-2 py-2 font-semibold ${complete ? 'bg-emerald-600 text-white' : 'bg-white text-slate-400 ring-1 ring-slate-200'}`} aria-current={currentStage === stage ? 'step' : undefined}>{index + 1}. {stage}</li>
              })}
            </ol>
            {!isWithinPagerWindow && <p className="mt-2 text-xs text-slate-500">Live status and pager alerts are available for orders placed within the last 24 hours.</p>}
          </div>
          <div className="mb-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4">
            <div><p className="text-xs uppercase tracking-wide text-slate-500">Order Number</p><p className="mt-1 font-bold">{order?.orderNumber ?? (order?.orderId ? `#${order.orderId.slice(-6)}` : '—')}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-slate-500">Table</p><p className="mt-1 font-bold">{order?.tableNumber || '—'}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-slate-500">Dining Mode</p><p className="mt-1 font-semibold capitalize">{order?.diningMode === 'alone' ? 'Dining alone' : order?.diningMode === 'group' ? 'Group dining' : '—'}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-slate-500">Time</p><p className="mt-1 font-semibold">{order?.timestamp || new Date().toLocaleString()}</p></div>
          </div>

          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500">Your items</h2>
          {items.length ? <div className="divide-y divide-slate-100">
            {items.map((item, index) => {
              const lineTotal = Number(item.price || 0) * Number(item.quantity || 0)
              return <div key={`${item.name}-${index}`} className="py-3">
                <div className="flex justify-between gap-3"><span className="font-semibold">{item.quantity}× {item.name}</span><span className="shrink-0 font-medium">{money(lineTotal)}</span></div>
                {item.variantName && <p className="mt-1 text-sm text-slate-500">Variant: {item.variantName}{item.variantPrice ? ` (+${money(item.variantPrice)})` : ''}</p>}
                {item.addOns?.map((addOn, addOnIndex) => <p key={`${addOn.name}-${addOnIndex}`} className="text-sm text-slate-500">+ {addOn.name} ({money(addOn.price)})</p>)}
                {item.notes && <p className="text-sm italic text-slate-500">Note: {item.notes}</p>}
              </div>
            })}
          </div> : <p className="py-5 text-center text-slate-500">Receipt items are unavailable.</p>}
          <div className="mt-2 flex justify-between border-t border-dashed border-slate-300 pt-4 text-lg font-bold"><span>Total</span><span>{money(total)}</span></div>
          {order?.orderId && <p className="mt-3 text-center text-xs text-slate-400">Order ID: {order.orderId}</p>}
        </section>

        <footer className="grid shrink-0 grid-cols-1 gap-3 border-t border-slate-100 p-4 sm:grid-cols-2">
          <button type="button" onClick={() => void armPager()} disabled={isPaging || isPagedArmed || !order?.orderId || !order.createdAt || !isWithinLast24Hours(order.createdAt)} className="min-h-12 rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{isPaging ? 'Enabling pager…' : isPagedArmed ? 'Pager Armed' : 'Page Me When Done'} {order?.orderNumber ? `(#${order.orderNumber})` : ''}</button>
          {pagerMessage && currentStage !== 'Done' && <p className="col-span-full text-center text-sm text-emerald-700">{pagerMessage}</p>}
          <button type="button" onClick={() => void downloadOrShareReceipt()} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white hover:bg-slate-800"><Share2 className="h-4 w-4" /><Download className="h-4 w-4" />Download / Share Receipt</button>
          <button type="button" onClick={backToMenu} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-700 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" />Back to Menu</button>
        </footer>
      </div>
      <audio ref={alertAudioRef} src="/sounds/order-ready.mp3" preload="auto" className="hidden" />
    </main>
  )
}
