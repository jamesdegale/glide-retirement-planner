import { redirect } from 'next/navigation'
import { createClient } from '../../lib/supabase-server'
import DashboardClient from './DashboardClient'

const CATEGORY_ORDER = ['retirement', 'investment', 'banking', 'other', 'loans']

function formatCategory(cat, subtype) {
  if (cat === 'other' && subtype === 'real_estate') return 'real_estate'
  return cat || 'other'
}

function computeFinancials(allAccounts) {
  const assetCategories = new Set(['retirement', 'investment', 'banking', 'real_estate', 'other'])
  let assets = 0
  let liabilities = 0

  for (const a of allAccounts) {
    const bal = Number(a.current_balance) || 0
    if (a.displayCategory === 'loans') {
      liabilities += Math.abs(bal)
    } else if (assetCategories.has(a.displayCategory)) {
      assets += bal
    }
  }

  return { assets, liabilities, netWorth: assets - liabilities }
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/signin')

  const [plaidResult, manualResult, snapshotsResult, scenariosResult] = await Promise.all([
    supabase
      .from('plaid_accounts')
      .select(
        'id, name, official_name, mask, type, subtype, category, current_balance, available_balance, iso_currency_code, updated_at, plaid_items(institution_name)'
      )
      .order('category'),
    supabase
      .from('manual_accounts')
      .select('id, institution_name, name, type, subtype, category, current_balance, updated_at')
      .order('category'),
    supabase
      .from('balance_snapshots')
      .select('total_assets, total_liabilities, net_worth, snapshot_date')
      .eq('user_id', user.id)
      .order('snapshot_date', { ascending: true }),
    supabase
      .from('retirement_scenarios')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
  ])

  const scenarioCount = scenariosResult?.count || 0

  const plaidAccounts = (plaidResult.data || []).map((a) => ({
    id: a.id,
    name: a.name || a.official_name || 'Account',
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    displayCategory: formatCategory(a.category, a.subtype),
    current_balance: Number(a.current_balance) || 0,
    institution: a.plaid_items?.institution_name || 'Linked institution',
    updated_at: a.updated_at,
    source: 'plaid',
  }))

  const manualAccounts = (manualResult.data || []).map((a) => ({
    id: a.id,
    name: a.name,
    mask: null,
    type: a.type,
    subtype: a.subtype,
    displayCategory: formatCategory(a.category, a.subtype),
    current_balance: Number(a.current_balance) || 0,
    institution: a.institution_name || 'Manual entry',
    updated_at: a.updated_at,
    source: 'manual',
  }))

  const allAccounts = [...plaidAccounts, ...manualAccounts]
  const snapshots = snapshotsResult.data || []
  const { assets, liabilities, netWorth } = computeFinancials(allAccounts)

  const today = new Date().toISOString().slice(0, 10)
  const hasToday = snapshots.some((s) => s.snapshot_date === today)

  if (!hasToday && allAccounts.length > 0) {
    await supabase.from('balance_snapshots').upsert(
      {
        user_id: user.id,
        total_assets: assets,
        total_liabilities: liabilities,
        net_worth: netWorth,
        snapshot_date: today,
      },
      { onConflict: 'user_id,snapshot_date' }
    )
    snapshots.push({
      total_assets: assets,
      total_liabilities: liabilities,
      net_worth: netWorth,
      snapshot_date: today,
    })
  }

  return (
    <DashboardClient
      userEmail={user.email}
      accounts={allAccounts}
      snapshots={snapshots}
      financials={{ assets, liabilities, netWorth }}
      scenarioCount={scenarioCount}
    />
  )
}
