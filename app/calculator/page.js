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

export default async function CalculatorPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/signin')

  const { data: plaidRaw } = await supabase
    .from('plaid_accounts')
    .select('id, name, official_name, mask, type, subtype, category, current_balance, plaid_items(institution_name)')

  const plaidAccounts = (plaidRaw || [])
    .filter((a) => a.category !== 'loans' && (Number(a.current_balance) || 0) > 0)
    .map((a) => ({
      id: a.id,
      name: a.name || a.official_name || 'Account',
      institution: a.plaid_items?.institution_name || '',
      mask: a.mask,
      balance: Number(a.current_balance) || 0,
      type: mapPlaidToAccountType(a.subtype, a.category),
    }))

  const { data: savedPlan } = await supabase
    .from('retirement_plans')
    .select('inputs, results, updated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  return (
    <CalculatorClient
      userEmail={user.email}
      plaidAccounts={plaidAccounts}
      savedPlan={savedPlan || null}
    />
  )
}
