'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '../../lib/supabase'

export default function SignOutButton() {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)

  async function handleSignOut() {
    setLoading(true)
    await supabase.auth.signOut()
    router.push('/signin')
    router.refresh()
  }

  return (
    <button
      onClick={handleSignOut}
      disabled={loading}
      className="text-slate-300 hover:text-white text-sm border border-slate-700 hover:border-slate-600 rounded-lg px-3 py-1.5 disabled:opacity-50"
    >
      {loading ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
