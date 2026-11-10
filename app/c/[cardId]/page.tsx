import { Query } from 'node-appwrite'
import { redirect } from 'next/navigation'
import { databases, getServerAppwriteConfig } from '@/lib/appwrite'

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
    const { databaseId, cardsCollectionId } = getServerAppwriteConfig()
    const result = await databases.listDocuments(
      databaseId,
      cardsCollectionId,
      [Query.equal('card_id', cardId), Query.limit(1)]
    )
    card = result.documents[0] as unknown as CardDocument | undefined
  } catch (error) {
    console.error('Could not resolve QR/NFC card redirect', error)
    return unavailableMessage()
  }

  if (!card || card.is_active !== true || !card.target_url) {
    return unavailableMessage()
  }

  try {
    const target = new URL(card.target_url)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return unavailableMessage()
    }
  } catch {
    return unavailableMessage()
  }

  redirect(card.target_url)
}
