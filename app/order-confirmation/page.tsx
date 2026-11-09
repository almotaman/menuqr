'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, Download, Share2 } from 'lucide-react'

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
}

function money(value: number) {
  return `${Number(value || 0).toFixed(2)} EGP`
}

export default function OrderConfirmationPage() {
  const receiptRef = useRef<HTMLDivElement>(null)
  const [order, setOrder] = useState<StoredOrder | null>(null)

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
  }, [])

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
    localStorage.removeItem('last_placed_order')
    window.location.href = '/'
  }

  const items = order?.items || []
  const total = Number(order?.totalAmount ?? items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0))

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-slate-950 px-4 py-5 text-slate-900 sm:px-6">
      <div className="flex max-h-[calc(100dvh-2.5rem)] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <header className="shrink-0 bg-emerald-600 px-6 py-7 text-center text-white">
          <CheckCircle2 className="mx-auto mb-2 h-12 w-12" />
          <h1 className="text-2xl font-bold">Order Confirmed</h1>
          <p className="mt-1 text-sm text-emerald-50">Your order has been received by the restaurant.</p>
        </header>

        <section ref={receiptRef} className="min-h-0 flex-1 overflow-y-auto bg-white p-5 sm:p-6">
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
          <button type="button" onClick={() => void downloadOrShareReceipt()} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white hover:bg-slate-800"><Share2 className="h-4 w-4" /><Download className="h-4 w-4" />Download / Share Receipt</button>
          <button type="button" onClick={backToMenu} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-700 hover:bg-slate-50"><ArrowLeft className="h-4 w-4" />Back to Menu</button>
        </footer>
      </div>
    </main>
  )
}
