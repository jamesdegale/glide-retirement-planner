'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '../../lib/supabase'

export default function SignUpPage() {
  const router = useRouter()
  const supabase = createClient()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setLoading(true)

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    if (data.session) {
      router.push('/dashboard')
      router.refresh()
    } else {
      setMessage('Check your email for a confirmation link to finish signing up.')
    }
  }

  return (
    <main className="min-h-screen bg-slate-900 flex flex-col">
      <nav className="px-6 py-4">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-white text-2xl font-bold tracking-tight">Glide</span>
          <span className="text-blue-400 text-sm font-medium">by Clark.com</span>
        </Link>
      </nav>

      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="bg-slate-800 rounded-2xl p-8 border border-slate-700 shadow-xl">
            <h1 className="text-white text-3xl font-bold mb-2">Create your account</h1>
            <p className="text-slate-400 mb-8">Start planning your financial future today.</p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-slate-300 text-sm font-medium mb-2">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 focus:border-blue-500 focus:outline-none text-white rounded-lg px-4 py-3"
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-slate-300 text-sm font-medium mb-2">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 focus:border-blue-500 focus:outline-none text-white rounded-lg px-4 py-3"
                />
                <p className="text-slate-500 text-xs mt-2">At least 6 characters.</p>
              </div>

              {error && (
                <div className="bg-red-950/50 border border-red-900 text-red-300 text-sm rounded-lg px-4 py-3">
                  {error}
                </div>
              )}

              {message && (
                <div className="bg-blue-950/50 border border-blue-900 text-blue-300 text-sm rounded-lg px-4 py-3">
                  {message}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-500 hover:bg-blue-400 disabled:bg-blue-800 disabled:text-blue-300 text-white font-medium py-3 rounded-lg transition-colors"
              >
                {loading ? 'Creating account…' : 'Create account'}
              </button>
            </form>

            <p className="text-slate-400 text-sm text-center mt-6">
              Already have an account?{' '}
              <Link href="/signin" className="text-blue-400 hover:text-blue-300">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
