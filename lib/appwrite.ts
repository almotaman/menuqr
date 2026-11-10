import 'server-only'

import { Client, Databases } from 'node-appwrite'

const endpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT
const projectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT
const apiKey = process.env.APPWRITE_API_KEY
const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID

const client = new Client()
if (endpoint) client.setEndpoint(endpoint)
if (projectId) client.setProject(projectId)
if (apiKey) client.setKey(apiKey)

export const databases = new Databases(client)
export { client }

export function getServerAppwriteConfig() {
  if (!endpoint || !projectId || !apiKey || !databaseId) {
    throw new Error(
      'Missing Appwrite server configuration. Set NEXT_PUBLIC_APPWRITE_ENDPOINT, ' +
        'NEXT_PUBLIC_APPWRITE_PROJECT, NEXT_PUBLIC_APPWRITE_DATABASE_ID, and APPWRITE_API_KEY.'
    )
  }

  return { databaseId }
}
