export const ORDER_RECENCY_MS = 24 * 60 * 60 * 1000

export function isWithinLast24Hours(createdAt: unknown, now = Date.now()): boolean {
  const timestamp = typeof createdAt === 'string' || createdAt instanceof Date
    ? new Date(createdAt).getTime()
    : NaN
  return Number.isFinite(timestamp) && timestamp >= now - ORDER_RECENCY_MS && timestamp <= now
}
