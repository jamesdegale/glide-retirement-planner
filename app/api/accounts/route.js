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

  const { data, error } = await supabase.from('manual_accounts').insert({
    user_id: user.id,
    institution_name: institution_name || null,
    name,
    type: meta.type,
    subtype: meta.subtype,
    category: meta.category,
    current_balance: parseFloat(balance) || 0,
  }).select('id, updated_at').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id: data.id, updated_at: data.updated_at })
}

export async function DELETE(request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const source = searchParams.get('source')
  const cascade = searchParams.get('cascade') === '1'

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

  // Clean up scenario references. Default: convert linked accounts to freeform.
  // When cascade=1: remove the account from each scenario's accounts array entirely.
  const { data: scenarios } = await supabase
    .from('retirement_scenarios')
    .select('id, inputs')
    .eq('user_id', user.id)
  for (const sc of scenarios || []) {
    const accounts = sc.inputs?.accounts || []
    let modified = false
    let updated
    if (cascade) {
      updated = accounts.filter((a) => {
        if (a.linkedAccount?.sourceId === id) { modified = true; return false }
        return true
      })
    } else {
      updated = accounts.map((a) => {
        if (a.linkedAccount?.sourceId === id) { modified = true; return { ...a, linkedAccount: null } }
        return a
      })
    }
    if (modified) {
      await supabase
        .from('retirement_scenarios')
        .update({ inputs: { ...sc.inputs, accounts: updated }, updated_at: new Date().toISOString() })
        .eq('id', sc.id)
        .eq('user_id', user.id)
    }
  }

  return NextResponse.json({ ok: true })
}
