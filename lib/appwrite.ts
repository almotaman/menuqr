import 'server-only'

import { Client, Databases } from 'node-appwrite'

const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT?.trim().replace(/\/+$/, '')
const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT?.trim()
const apiKey = process.env.APPWRITE_API_KEY?.trim()
const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID?.trim()

const client = new Client()

export const databases = new Databases(client)
export { client }

export function getServerAppwriteConfig() {
  if (!endpoint || !projectId || !apiKey || !databaseId) {
    throw new Error(
      'Missing Appwrite server configuration. Set NEXT_PUBLIC_APPWRITE_ENDPOINT, ' +
        'NEXT_PUBLIC_APPWRITE_PROJECT, NEXT_PUBLIC_APPWRITE_DATABASE_ID, and APPWRITE_API_KEY.'
    )
  }

  let parsedEndpoint: URL
  try {
    parsedEndpoint = new URL(endpoint)
  } catch {
    throw new Error('NEXT_PUBLIC_APPWRITE_ENDPOINT must be a valid absolute URL.')
  }
  if (!['http:', 'https:'].includes(parsedEndpoint.protocol) || parsedEndpoint.search || parsedEndpoint.hash) {
    throw new Error('NEXT_PUBLIC_APPWRITE_ENDPOINT must use HTTP(S) and cannot include a query or fragment.')
  }

  client.setEndpoint(endpoint).setProject(projectId).setKey(apiKey)

  return { endpoint, projectId, apiKey, databaseId }
}
