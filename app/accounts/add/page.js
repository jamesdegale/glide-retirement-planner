'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { usePlaidLink } from 'react-plaid-link'

export default function AddAccountPage() {
  const router = useRouter()
  const [linkToken, setLinkToken] = useState(null)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/plaid/create-link-token', { method: 'POST' })
        const data = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(data.error || 'Unable to start Plaid')
        setLinkToken(data.link_token)
      } catch (err) {
        if (!cancelled) setError(err.message)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const onSuccess = useCallback(
    async (public_token, metadata) => {
      setStatus('saving')
      setError(null)
      try {
        const res = await fetch('/api/plaid/exchange-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_token, institution: metadata.institution }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Unable to save account')
        router.push('/dashboard')
        router.refresh()
      } catch (err) {
        setStatus('idle')
        setError(err.message)
      }
    },
    [router]
  )

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: (err) => {
      if (err) setError(err.display_message || err.error_message || 'Connection cancelled')
    },
  })

  return (
    <main className="min-h-screen bg-slate-900">
      <nav className="border-b border-slate-800 px-6 py-4 flex justify-between items-center">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-white text-2xl font-bold tracking-tight">Glide</span>
          <span className="text-blue-400 text-sm font-medium">by Clark.com</span>
        </Link>
        <Link href="/dashboard" className="text-slate-300 hover:text-white text-sm">
          ← Back to dashboard
        </Link>
      </nav>

      <section className="px-6 py-16 max-w-2xl mx-auto">
        <h1 className="text-white text-4xl font-bold mb-3">Add an account</h1>
        <p className="text-slate-400 text-lg mb-10">
          Connect your bank, brokerage, or retirement account through Plaid. We use sandbox mode,
          so you can test with Plaid&apos;s demo credentials.
        </p>

        <div className="bg-slate-800 border border-slate-700 rounded-2xl p-8">
          <h2 className="text-white text-xl font-semibold mb-2">Connect via Plaid</h2>
          <p className="text-slate-400 mb-6">
            In sandbox, use username <code className="text-blue-300">user_good</code> and password{' '}
            <code className="text-blue-300">pass_good</code>.
          </p>

          <button
            onClick={() => open()}
            disabled={!ready || !linkToken || status === 'saving'}
            className="bg-blue-500 hover:bg-blue-400 disabled:bg-blue-800 disabled:text-blue-300 text-white font-medium px-6 py-3 rounded-lg transition-colors"
          >
            {status === 'saving'
              ? 'Saving accounts…'
              : linkToken
                ? 'Connect an institution'
                : 'Preparing…'}
          </button>

          {error && (
            <div className="mt-6 bg-red-950/50 border border-red-900 text-red-300 text-sm rounded-lg px-4 py-3">
              {error}
            </div>
          )}
        </div>

        <div className="mt-8 text-slate-500 text-sm">
          <p>
            Glide will pull current balances for each linked account and group them as banking,
            investment, retirement, or loans.
          </p>
        </div>
      </section>
    </main>
  )
}
