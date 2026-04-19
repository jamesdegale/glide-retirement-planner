'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'

const PERIODS = [
  { key: '1M', months: 1 },
  { key: '3M', months: 3 },
  { key: '6M', months: 6 },
  { key: '1Y', months: 12 },
  { key: 'All', months: Infinity },
]

const CATEGORY_ORDER = ['retirement', 'investment', 'banking', 'real_estate', 'loans']
const CATEGORY_META = {
  retirement: { label: 'Retirement', icon: '🏦' },
  investment: { label: 'Investment', icon: '📈' },
  banking: { label: 'Banking', icon: '💳' },
  real_estate: { label: 'Real Estate', icon: '🏠' },
  loans: { label: 'Loans & Credit', icon: '📋' },
  other: { label: 'Other', icon: '📁' },
}

const MANUAL_TYPES = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: '401k', label: '401(k)' },
  { value: 'ira', label: 'Traditional IRA' },
  { value: 'roth_ira', label: 'Roth IRA' },
  { value: 'brokerage', label: 'Brokerage' },
  { value: 'real_estate', label: 'Real Estate' },
  { value: 'mortgage', label: 'Mortgage' },
  { value: 'auto_loan', label: 'Auto Loan' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'other', label: 'Other' },
]

const INSIGHTS = [
  {
    id: 'rebalance',
    title: 'Portfolio rebalancing',
    body: 'Your retirement accounts make up over 80% of your investable assets. An advisor can help you evaluate if this allocation matches your risk tolerance.',
  },
  {
    id: 'tax',
    title: 'Tax-loss harvesting',
    body: 'With a taxable brokerage account, you may be able to offset gains with strategic losses before year-end.',
  },
  {
    id: 'emergency',
    title: 'Emergency fund check',
    body: 'Financial experts recommend keeping 3-6 months of expenses in liquid savings. Is your cash reserve right-sized?',
  },
]

function fmt(v) {
  if (v == null || !isFinite(v)) return '$0'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v)
}

function fmtCompact(v) {
  if (v == null || !isFinite(v)) return '$0'
  const abs = Math.abs(v)
  if (abs >= 1_000_000)
    return '$' + (v / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'M'
  if (abs >= 1_000)
    return '$' + (v / 1_000).toLocaleString('en-US', { maximumFractionDigits: 0 }) + 'k'
  return fmt(v)
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-lg text-sm">
      <p className="text-slate-500 text-xs">{d.label}</p>
      <p className="text-slate-900 font-semibold">{fmt(d.net_worth)}</p>
      <p className="text-slate-400 text-xs">
        Assets {fmt(d.total_assets)} · Liabilities {fmt(d.total_liabilities)}
      </p>
    </div>
  )
}

export default function DashboardClient({ userEmail, accounts, snapshots, financials }) {
  const router = useRouter()
  const [period, setPeriod] = useState('1Y')
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [collapsedCats, setCollapsedCats] = useState({})
  const [showManualForm, setShowManualForm] = useState(false)
  const [manualForm, setManualForm] = useState({
    institution_name: '',
    name: '',
    account_type: 'checking',
    balance: '',
  })
  const [manualSaving, setManualSaving] = useState(false)
  const [manualError, setManualError] = useState(null)

  const hasAccounts = accounts.length > 0

  const groups = useMemo(() => {
    const g = {}
    for (const cat of [...CATEGORY_ORDER, 'other']) g[cat] = []
    for (const a of accounts) {
      const key = g[a.displayCategory] ? a.displayCategory : 'other'
      g[key].push(a)
    }
    return g
  }, [accounts])

  const groupTotals = useMemo(() => {
    const t = {}
    for (const [cat, list] of Object.entries(groups)) {
      t[cat] = list.reduce((sum, a) => sum + (Number(a.current_balance) || 0), 0)
    }
    return t
  }, [groups])

  const visibleCategories = useMemo(
    () => [...CATEGORY_ORDER, 'other'].filter((cat) => groups[cat]?.length > 0),
    [groups]
  )

  const chartData = useMemo(() => {
    if (!snapshots.length) return []
    const now = new Date()
    const p = PERIODS.find((x) => x.key === period)
    const cutoff =
      p.months === Infinity
        ? new Date(0)
        : new Date(now.getFullYear(), now.getMonth() - p.months, now.getDate())
    return snapshots
      .filter((s) => new Date(s.snapshot_date) >= cutoff)
      .map((s) => ({
        ...s,
        label: new Date(s.snapshot_date).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      }))
  }, [snapshots, period])

  const netWorthChange = useMemo(() => {
    if (chartData.length < 2) return { value: 0, pct: 0 }
    const first = chartData[0].net_worth
    const last = chartData[chartData.length - 1].net_worth
    const diff = last - first
    return { value: diff, pct: first ? (diff / first) * 100 : 0 }
  }, [chartData])

  const toggleCat = (cat) =>
    setCollapsedCats((prev) => ({ ...prev, [cat]: !prev[cat] }))

  const removeAccount = useCallback(
    async (id, source) => {
      setRemoving(id)
      try {
        const res = await fetch(`/api/accounts?id=${id}&source=${source}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('Remove failed')
        router.refresh()
      } catch {
        alert('Failed to remove account')
      } finally {
        setRemoving(null)
      }
    },
    [router]
  )

  const saveManualAccount = useCallback(async () => {
    setManualSaving(true)
    setManualError(null)
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manualForm),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Save failed')
      }
      setShowManualForm(false)
      setManualForm({ institution_name: '', name: '', account_type: 'checking', balance: '' })
      router.refresh()
    } catch (err) {
      setManualError(err.message)
    } finally {
      setManualSaving(false)
    }
  }, [manualForm, router])

  const handleSignOut = useCallback(async () => {
    const { createClient } = await import('../../lib/supabase')
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/signin')
    router.refresh()
  }, [router])

  if (!hasAccounts) {
    return (
      <Shell userEmail={userEmail} onSignOut={handleSignOut}>
        <EmptyState
          showManualForm={showManualForm}
          manualForm={manualForm}
          setManualForm={setManualForm}
          manualSaving={manualSaving}
          manualError={manualError}
          onAddManual={() => setShowManualForm(true)}
          onSaveManual={saveManualAccount}
          onCancelManual={() => setShowManualForm(false)}
        />
      </Shell>
    )
  }

  return (
    <Shell userEmail={userEmail} onSignOut={handleSignOut}>
      <div className="flex flex-col lg:flex-row gap-6 px-4 sm:px-6 py-6 max-w-[1400px] mx-auto">
        {/* LEFT SIDEBAR */}
        <aside className="w-full lg:w-60 flex-shrink-0 order-2 lg:order-1">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-3 py-2.5 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-900">Accounts</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {visibleCategories.map((cat) => {
                const meta = CATEGORY_META[cat] || CATEGORY_META.other
                const collapsed = collapsedCats[cat]
                return (
                  <div key={cat}>
                    <button
                      onClick={() => toggleCat(cat)}
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        <svg
                          className={`w-3 h-3 text-slate-400 transition-transform ${collapsed ? '-rotate-90' : ''}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                          {meta.label}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-semibold text-slate-700 tabular-nums">
                          {fmt(groupTotals[cat])}
                        </span>
                        <span className="block text-[10px] text-emerald-500 tabular-nums">
                          +$0
                        </span>
                      </div>
                    </button>
                    {!collapsed &&
                      groups[cat].map((a) => {
                        const stale = a.source === 'plaid' && a.updated_at &&
                          (Date.now() - new Date(a.updated_at).getTime()) > 86400000
                        const dotColor = a.source === 'manual'
                          ? 'bg-slate-300'
                          : stale
                            ? 'bg-red-400'
                            : 'bg-emerald-400'

                        return (
                          <div
                            key={`${a.source}-${a.id}`}
                            onClick={() => setSelectedAccount(selectedAccount === a.id ? null : a.id)}
                            className={`px-3 py-1.5 cursor-pointer group transition-colors ${
                              selectedAccount === a.id
                                ? 'bg-blue-50 border-l-2 border-blue-500'
                                : 'hover:bg-slate-50 border-l-2 border-transparent'
                            }`}
                          >
                            {/* Line 1: institution + balance */}
                            <div className="flex items-center justify-between gap-1">
                              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
                                <span className="text-[13px] font-medium text-slate-800 truncate">
                                  {a.institution}
                                  {a.mask && <span className="text-slate-400"> ···{a.mask}</span>}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <span className="text-[13px] font-semibold text-slate-900 tabular-nums">
                                  {fmtCompact(a.current_balance)}
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    removeAccount(a.id, a.source)
                                  }}
                                  disabled={removing === a.id}
                                  className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all p-0.5"
                                  aria-label="Remove"
                                >
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                            {/* Line 2: account name + change */}
                            <div className="flex items-center justify-between pl-[14px]">
                              <span className="text-[11px] text-slate-400 truncate">
                                {a.name}
                              </span>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-[10px] text-slate-400 tabular-nums">
                                  --
                                </span>
                                {stale && (
                                  <Link
                                    href="/accounts/add"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-[10px] text-red-500 hover:text-red-600 font-medium"
                                  >
                                    Reconnect
                                  </Link>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                )
              })}
            </div>
            <div className="p-2 border-t border-slate-100 space-y-1.5">
              <Link
                href="/accounts/add"
                className="block w-full text-center text-xs font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg px-3 py-1.5 transition-colors"
              >
                + Add account
              </Link>
              <button
                onClick={() => setShowManualForm(!showManualForm)}
                className="block w-full text-center text-xs font-medium text-slate-600 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-lg px-3 py-1.5 transition-colors"
              >
                Add manually
              </button>
            </div>
          </div>

          {selectedAccount && (
            <AccountDetail
              account={accounts.find((a) => a.id === selectedAccount)}
            />
          )}
        </aside>

        {/* MAIN AREA */}
        <main className="flex-1 min-w-0 order-1 lg:order-2 space-y-6">
          {/* Manual form */}
          {showManualForm && (
            <ManualForm
              form={manualForm}
              setForm={setManualForm}
              saving={manualSaving}
              error={manualError}
              onSave={saveManualAccount}
              onCancel={() => setShowManualForm(false)}
            />
          )}

          {/* Net Worth Chart */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
              <div>
                <p className="text-sm text-slate-500 mb-0.5">Net worth</p>
                <p className="text-4xl font-bold text-slate-900 tracking-tight">
                  {fmt(financials.netWorth)}
                </p>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-sm text-slate-500">
                    Assets{' '}
                    <span className="font-medium text-slate-700">{fmt(financials.assets)}</span>
                  </span>
                  <span className="text-slate-300">|</span>
                  <span className="text-sm text-slate-500">
                    Liabilities{' '}
                    <span className="font-medium text-slate-700">{fmt(financials.liabilities)}</span>
                  </span>
                </div>
                {chartData.length >= 2 && (
                  <p className="mt-1">
                    <span
                      className={`text-sm font-semibold ${
                        netWorthChange.value >= 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}
                    >
                      {netWorthChange.value >= 0 ? '+' : ''}
                      {fmt(netWorthChange.value)} ({netWorthChange.pct >= 0 ? '+' : ''}
                      {netWorthChange.pct.toFixed(1)}%)
                    </span>
                    <span className="text-slate-400 text-xs ml-1.5">
                      past {period === 'All' ? `${chartData.length} months` : period}
                    </span>
                  </p>
                )}
              </div>
              <div className="flex bg-slate-100 rounded-lg p-0.5">
                {PERIODS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setPeriod(p.key)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                      period === p.key
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {p.key}
                  </button>
                ))}
              </div>
            </div>

            {chartData.length >= 2 ? (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                    <defs>
                      <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#f1f5f9" vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: '#94a3b8', fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={fmtCompact}
                      width={50}
                      domain={['dataMin - 5000', 'dataMax + 5000']}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="net_worth"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="url(#nwGrad)"
                      dot={false}
                      activeDot={{ r: 4, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-52 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-slate-400 text-sm">
                    We&apos;re building your history — check back soon.
                  </p>
                  <p className="text-slate-400 text-xs mt-1">
                    A snapshot is recorded every time you visit.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="Total Assets" value={financials.assets} />
            <StatCard label="Total Liabilities" value={financials.liabilities} />
            <StatCard label="Net Worth" value={financials.netWorth} highlight />
          </div>
        </main>

        {/* RIGHT PANEL — Insights */}
        <aside className="w-full lg:w-[280px] flex-shrink-0 order-3">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-900">Insights</h2>
            </div>
            <div className="divide-y divide-slate-100">
              {INSIGHTS.map((insight) => (
                <div key={insight.id} className="px-4 py-4">
                  <h3 className="text-sm font-semibold text-slate-800 mb-1">
                    {insight.title}
                  </h3>
                  <p className="text-xs text-slate-500 leading-relaxed mb-3">
                    {insight.body}
                  </p>
                  <button className="text-xs font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md px-2.5 py-1.5 transition-colors">
                    Talk to an advisor
                  </button>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </Shell>
  )
}

function Shell({ children, userEmail, onSignOut }) {
  return (
    <div className="min-h-screen bg-[#f8fafc]">
      {/* Top nav */}
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

      {/* Tabs */}
      <div className="bg-white border-b border-slate-200 px-6">
        <div className="max-w-[1400px] mx-auto flex gap-6">
          <button className="px-1 py-3 text-sm font-medium text-blue-600 border-b-2 border-blue-500">
            Dashboard
          </button>
          <Link
            href="/calculator"
            className="px-1 py-3 text-sm font-medium text-slate-500 hover:text-slate-700 border-b-2 border-transparent hover:border-slate-300 transition-colors"
          >
            Retirement Plan
          </Link>
        </div>
      </div>

      {children}
    </div>
  )
}

function StatCard({ label, value, highlight }) {
  return (
    <div
      className={`rounded-xl border p-5 shadow-sm ${
        highlight
          ? 'bg-blue-50 border-blue-200'
          : 'bg-white border-slate-200'
      }`}
    >
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <p
        className={`text-2xl font-bold tabular-nums ${
          highlight ? 'text-blue-700' : 'text-slate-900'
        }`}
      >
        {fmt(value)}
      </p>
    </div>
  )
}

function AccountDetail({ account: a }) {
  if (!a) return null
  return (
    <div className="mt-4 bg-white border border-slate-200 rounded-xl shadow-sm p-4">
      <h3 className="text-sm font-semibold text-slate-900 mb-3">{a.name}</h3>
      <div className="space-y-2 text-sm">
        <Row label="Institution" value={a.institution} />
        <Row label="Type" value={a.subtype || a.type || '—'} />
        <Row label="Balance" value={fmt(a.current_balance)} bold />
        <Row label="Source" value={a.source === 'plaid' ? 'Plaid' : 'Manual'} />
        {a.updated_at && (
          <Row
            label="Last updated"
            value={new Date(a.updated_at).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          />
        )}
      </div>
    </div>
  )
}

function Row({ label, value, bold }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={bold ? 'font-semibold text-slate-900' : 'text-slate-700'}>{value}</span>
    </div>
  )
}

function ManualForm({ form, setForm, saving, error, onSave, onCancel }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
      <h3 className="text-sm font-semibold text-slate-900 mb-4">Add account manually</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="block mb-1 text-slate-600">Institution name</span>
          <input
            type="text"
            placeholder="e.g. Fidelity, Chase"
            value={form.institution_name}
            onChange={(e) => setForm({ ...form, institution_name: e.target.value })}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
          />
        </label>
        <label className="block text-sm">
          <span className="block mb-1 text-slate-600">Account name</span>
          <input
            type="text"
            placeholder="e.g. Savings, 401k"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
          />
        </label>
        <label className="block text-sm">
          <span className="block mb-1 text-slate-600">Account type</span>
          <select
            value={form.account_type}
            onChange={(e) => setForm({ ...form, account_type: e.target.value })}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
          >
            {MANUAL_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="block mb-1 text-slate-600">Balance</span>
          <input
            type="number"
            placeholder="0"
            value={form.balance}
            onChange={(e) => setForm({ ...form, balance: e.target.value })}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
          />
        </label>
      </div>
      {error && <p className="mt-3 text-red-600 text-sm">{error}</p>}
      <div className="flex gap-3 mt-4">
        <button
          onClick={onSave}
          disabled={saving || !form.name}
          className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white font-medium text-sm px-4 py-2 rounded-lg transition-colors"
        >
          {saving ? 'Saving...' : 'Save account'}
        </button>
        <button
          onClick={onCancel}
          className="border border-slate-200 hover:bg-slate-50 text-slate-600 font-medium text-sm px-4 py-2 rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function EmptyState({
  onAddManual,
  showManualForm,
  manualForm,
  setManualForm,
  manualSaving,
  manualError,
  onSaveManual,
  onCancelManual,
}) {
  return (
    <div className="max-w-xl mx-auto px-4 py-16">
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-blue-50 border border-blue-100 mb-4">
          <svg className="w-7 h-7 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Welcome to Glide</h1>
        <p className="text-slate-500">
          Connect your accounts to see your full financial picture.
        </p>
      </div>

      <div className="space-y-3">
        <Link
          href="/accounts/add"
          className="flex items-center gap-4 bg-white border border-slate-200 hover:border-blue-300 rounded-xl p-4 shadow-sm transition-colors group"
        >
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.39a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.344 8.25" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-800 group-hover:text-blue-600 transition-colors">
              Connect accounts with Plaid
            </p>
            <p className="text-xs text-slate-500">Automatically sync bank, brokerage, and retirement accounts.</p>
          </div>
          <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </Link>

        <button
          onClick={onAddManual}
          className="w-full flex items-center gap-4 bg-white border border-slate-200 hover:border-blue-300 rounded-xl p-4 shadow-sm transition-colors group text-left"
        >
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-800 group-hover:text-blue-600 transition-colors">
              Add manually
            </p>
            <p className="text-xs text-slate-500">Real estate, property, or accounts Plaid doesn&apos;t cover.</p>
          </div>
          <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      </div>

      {showManualForm && (
        <div className="mt-6">
          <ManualForm
            form={manualForm}
            setForm={setManualForm}
            saving={manualSaving}
            error={manualError}
            onSave={onSaveManual}
            onCancel={onCancelManual}
          />
        </div>
      )}
    </div>
  )
}
