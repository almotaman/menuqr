import 'server-only'

import type { getServerAppwriteConfig } from '@/lib/appwrite'

type ServerAppwriteConfig = ReturnType<typeof getServerAppwriteConfig>

export class AppwriteRestError extends Error {
  constructor(
    message: string,
    readonly details: { operation: string; status?: number; code?: number; type?: string },
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = 'AppwriteRestError'
  }
}

export async function appwriteRestRequest<T>(
  operation: string,
  url: string,
  config: ServerAppwriteConfig,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('X-Appwrite-Project', config.projectId)
  headers.set('X-Appwrite-Key', config.apiKey)
  if (init?.body) headers.set('Content-Type', 'application/json')

  let response: Response
  try {
    // Do not use node-appwrite here: its fetch adapter may supply a dispatcher
    // from a different Undici version than the Node runtime's native fetch.
    response = await fetch(url, { ...init, cache: 'no-store', headers })
  } catch (cause) {
    throw new AppwriteRestError(`Appwrite ${operation} could not reach the service.`, { operation, status: 502 }, cause)
  }

  const body = await response.json().catch(() => null) as (T & {
    message?: string
    code?: number
    type?: string
  }) | null
  if (!response.ok) {
    throw new AppwriteRestError(body?.message || `Appwrite ${operation} failed.`, {
      operation,
      status: response.status,
      code: body?.code,
      type: body?.type,
    })
  }
  if (!body) throw new AppwriteRestError(`Appwrite ${operation} returned an invalid response.`, { operation, status: 502 })
  return body as T
}

export function getSafeErrorCauses(error: unknown) {
  const causes: Array<{ name?: string; code?: string; message?: string }> = []
  let current = error
  const apiKey = process.env.APPWRITE_API_KEY?.trim()
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const value = current as { name?: string; code?: string; message?: string; cause?: unknown }
    causes.push({
      name: value.name,
      code: value.code,
      message: value.message?.slice(0, 300).replace(apiKey || /$^/, '[REDACTED]'),
    })
    current = value.cause
  }
  return causes
}
