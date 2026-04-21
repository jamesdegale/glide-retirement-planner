'use client'

import Link from 'next/link'

export default function WelcomeScreen({ userEmail, onSignOut }) {
  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <nav className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center">
        <div className="flex items-baseline gap-2">
          <span className="text-slate-900 text-xl font-bold tracking-tight">Glide</span>
          <span className="text-blue-500 text-xs font-medium">by Clark.com</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-slate-500 text-sm hidden sm:inline">{userEmail}</span>
          <button
            onClick={onSignOut}
            className="text-slate-500 hover:text-slate-700 text-sm border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-1.5 transition-colors"
          >
            Sign out
          </button>
        </div>
      </nav>

      <main className="max-w-[900px] mx-auto px-4 py-16 sm:py-24">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-slate-900">Welcome to Glide</h1>
          <p className="text-base text-slate-500 mt-1 mb-8">What would you like to do first?</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href="/calculator"
            className="group bg-white border border-slate-200 hover:border-blue-300 hover:shadow-md rounded-2xl p-8 transition-all cursor-pointer flex flex-col"
          >
            <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center mb-5">
              <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 14l4-4 3 3 5-6" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Plan your retirement</h2>
            <p className="text-sm text-slate-500 leading-relaxed mb-5 flex-1">
              See where you stand today and what your future looks like.
            </p>
            <span className="text-sm font-medium text-blue-600 group-hover:text-blue-700">
              Start planning →
            </span>
          </Link>

          <Link
            href="/dashboard?setup=1"
            className="group bg-white border border-slate-200 hover:border-emerald-300 hover:shadow-md rounded-2xl p-8 transition-all cursor-pointer flex flex-col"
          >
            <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-5">
              <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-slate-900 mb-2">Track your net worth</h2>
            <p className="text-sm text-slate-500 leading-relaxed mb-5 flex-1">
              Watch your finances grow across all your accounts and investments.
            </p>
            <span className="text-sm font-medium text-emerald-600 group-hover:text-emerald-700">
              Build my dashboard →
            </span>
          </Link>
        </div>

        <div className="text-center mt-8">
          <Link
            href="/calculator?demo=true"
            className="text-sm text-slate-500 underline hover:text-slate-700"
          >
            Just exploring? Try a sample plan →
          </Link>
        </div>
      </main>
    </div>
  )
}
