import { redirect } from 'next/navigation'
import { createClient } from '../../lib/supabase-server'
import CalculatorClient from './CalculatorClient'

function mapPlaidToAccountType(subtype, category) {
  const s = (subtype || '').toLowerCase()
  if (['401k', '401a', '403b', '457b', 'thrift savings plan', 'profit sharing plan', 'keogh'].includes(s)) return '401k'
  if (['roth', 'roth ira', 'roth 401k'].includes(s)) return 'roth_ira'
  if (['ira', 'simple ira', 'sep ira', 'retirement'].includes(s)) return 'traditional_ira'
  if (['pension'].includes(s)) return 'pension'
  if (['brokerage', 'mutual fund', 'stock plan', 'non-taxable brokerage account', 'cash management'].includes(s) || category === 'investment') return 'brokerage'
  if (['checking', 'savings', 'money market', 'cd', 'hsa'].includes(s) || category === 'banking') return 'cash'
  return 'brokerage'
}

function mapManualToAccountType(subtype, category) {
  const s = (subtype || '').toLowerCase()
  if (['401k', '403b', 'tsp'].includes(s)) return '401k'
  if (s === 'roth_ira' || s === 'roth') return 'roth_ira'
  if (['ira', 'traditional_ira'].includes(s)) return 'traditional_ira'
  if (['brokerage', 'taxable'].includes(s) || category === 'investment') return 'brokerage'
  if (['checking', 'savings', 'money_market', 'cd', 'hysa'].includes(s) || category === 'banking') return 'cash'
  if (s === 'other_investment') return 'other_investment'
  return 'brokerage'
}

export default async function CalculatorPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

  const [plaidResult, manualResult, scenariosResult] = await Promise.all([
    supabase
      .from('plaid_accounts')
      .select('id, name, official_name, mask, type, subtype, category, current_balance, updated_at, plaid_items(institution_name)'),
    supabase
      .from('manual_accounts')
      .select('id, institution_name, name, type, subtype, category, current_balance, updated_at')
      .eq('user_id', user.id),
    supabase
      .from('retirement_scenarios')
      .select('id, name, is_base, inputs, results, updated_at')
      .eq('user_id', user.id)
      .order('is_base', { ascending: false })
      .order('created_at'),
  ])

  const plaidAccounts = (plaidResult.data || [])
    .filter((a) => a.category !== 'loans' && (Number(a.current_balance) || 0) > 0)
    .map((a) => ({
      sourceId: a.id,
      source: 'plaid',
      name: a.name || a.official_name || 'Account',
      institution: a.plaid_items?.institution_name || '',
      mask: a.mask,
      balance: Number(a.current_balance) || 0,
      type: mapPlaidToAccountType(a.subtype, a.category),
      owner: 'self',
      updatedAt: a.updated_at,
    }))

  const manualAccounts = (manualResult.data || [])
    .filter((a) => a.category !== 'loans' && a.category !== 'real_estate' && (Number(a.current_balance) || 0) > 0)
    .map((a) => ({
      sourceId: a.id,
      source: 'manual',
      name: a.name,
      institution: a.institution_name || 'Manual entry',
      mask: null,
      balance: Number(a.current_balance) || 0,
      type: mapManualToAccountType(a.subtype, a.category),
      owner: 'self',
      updatedAt: a.updated_at,
    }))

  const existingAccounts = [...plaidAccounts, ...manualAccounts]

  return (
    <CalculatorClient
      userEmail={user.email}
      existingAccounts={existingAccounts}
      scenarios={scenariosResult.data || []}
    />
  )
}
