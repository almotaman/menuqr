'use client'

import React, { useState, useEffect } from 'react'
import { Client, Databases, Query } from 'appwrite'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

// Initialize Appwrite client
const client = new Client()
.setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1')
.setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID || '')

const databases = new Databases(client)

const DATABASE_ID = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || ''
const RESTAURANTS_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_RESTAURANTS_COLLECTION_ID || ''
const MENU_COLLECTION_ID = process.env.NEXT_PUBLIC_APPWRITE_MENU_COLLECTION_ID || ''

export default function Page() {
const [restaurant, setRestaurant] = useState(null)
const [menuItems, setMenuItems] = useState<any[]>([])
const [loading, setLoading] = useState(true)
const [error, setError] = useState<string | null>(null)

useEffect(() => {
async function fetchData() {
try {
setLoading(true)
setError(null)

    // 1. Determine subdomain
    let targetSubdomain = 'burgerhouse'
    if (typeof window !== 'undefined') {
      const hostname = window.location.hostname
      if (!hostname.includes('vercel.app') && !hostname.includes('localhost') && !hostname.includes('127.0.0.1')) {
        const parts = hostname.split('.')
        if (parts.length > 2) {
          targetSubdomain = parts[0]
        }
      }
    }

    // 2. Query restaurants collection by subdomain
    const restaurantRes = await databases.listDocuments(
      DATABASE_ID,
      RESTAURANTS_COLLECTION_ID,
      [Query.equal('subdomain', targetSubdomain)]
    )

    if (restaurantRes.documents.length === 0) {
      setError(`No restaurant found for subdomain "${targetSubdomain}"`)
      setLoading(false)
      return
    }

    const currentRestaurant = restaurantRes.documents[0]
    setRestaurant(currentRestaurant)

    // 3. Query menu collection using restaurant_id relationship attribute
    const menuRes = await databases.listDocuments(
      DATABASE_ID,
      MENU_COLLECTION_ID,
      [Query.equal('restaurant_id', currentRestaurant.$id)]
    )

    setMenuItems(menuRes.documents)
  } catch (err: any) {
    console.error('Appwrite fetch error:', err)
    setError(err.message || 'Failed to load restaurant menu.')
  } finally {
    setLoading(false)
  }
}

fetchData()


}, [])

if (loading) {
return (



Loading menu...


)
}

if (error) {
return (


  </div>
)


}

return (




{restaurant?.name || 'Restaurant Menu'}


{restaurant?.description || 'Welcome! Explore our delicious offerings below.'}



    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {menuItems.length > 0 ? (
        menuItems.map((item) => (
          <Card key={item.$id} className="overflow-hidden shadow-sm hover:shadow-md transition-shadow">
            {item.image_url && (
              <div className="h-48 w-full relative overflow-hidden bg-gray-100">
                <img 
                  src={item.image_url} 
                  alt={item.name} 
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <CardHeader>
              <div className="flex justify-between items-start">
                <CardTitle className="text-xl font-bold">{item.name}</CardTitle>
                <span className="text-lg font-semibold text-green-600">${item.price}</span>
              </div>
              <CardDescription>{item.description}</CardDescription>
            </CardHeader>
            {item.category && (
              <CardContent>
                <span className="inline-block bg-gray-100 text-gray-800 text-xs px-2.5 py-1 rounded-full font-medium">
                  {item.category}
                </span>
              </CardContent>
            )}
          </Card>
        ))
      ) : (
        <div className="col-span-2 text-center py-12 text-gray-500">
          No menu items available for this restaurant yet.
        </div>
      )}
    </div>
  </div>
</div>


)
}
