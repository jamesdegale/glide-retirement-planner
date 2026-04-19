import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase-server'

const ACCOUNT_TYPES = {
  checking:    { type: 'depository', subtype: 'checking',    category: 'banking' },
  savings:     { type: 'depository', subtype: 'savings',     category: 'banking' },
  '401k':      { type: 'investment', subtype: '401k',        category: 'retirement' },
  ira:         { type: 'investment', subtype: 'ira',          category: 'retirement' },
  roth_ira:    { type: 'investment', subtype: 'roth',         category: 'retirement' },
  brokerage:   { type: 'investment', subtype: 'brokerage',    category: 'investment' },
  real_estate: { type: 'other',      subtype: 'real_estate',  category: 'other' },
  mortgage:    { type: 'loan',       subtype: 'mortgage',     category: 'loans' },
  auto_loan:   { type: 'loan',       subtype: 'auto',         category: 'loans' },
  credit_card: { type: 'credit',     subtype: 'credit card',  category: 'loans' },
  other:       { type: 'other',      subtype: 'other',        category: 'other' },
}

export async function POST(request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { institution_name, name, account_type, balance } = body || {}

  if (!name || !account_type) {
    return NextResponse.json({ error: 'Name and account type are required' }, { status: 400 })
  }

  const meta = ACCOUNT_TYPES[account_type] || ACCOUNT_TYPES.other

  const { error } = await supabase.from('manual_accounts').insert({
    user_id: user.id,
    institution_name: institution_name || null,
    name,
    type: meta.type,
    subtype: meta.subtype,
    category: meta.category,
    current_balance: parseFloat(balance) || 0,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const source = searchParams.get('source')

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  if (source === 'manual') {
    const { error } = await supabase
      .from('manual_accounts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await supabase
      .from('plaid_accounts')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
