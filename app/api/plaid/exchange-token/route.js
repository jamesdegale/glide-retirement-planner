import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase-server'
import { plaidClient, categorize } from '../../../../lib/plaid'

export async function POST(request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { public_token, institution } = await request.json()
  if (!public_token) {
    return NextResponse.json({ error: 'missing public_token' }, { status: 400 })
  }

  try {
    const exchange = await plaidClient.itemPublicTokenExchange({ public_token })
    const accessToken = exchange.data.access_token
    const itemId = exchange.data.item_id

    const { data: itemRow, error: itemError } = await supabase
      .from('plaid_items')
      .insert({
        user_id: user.id,
        item_id: itemId,
        access_token: accessToken,
        institution_id: institution?.institution_id || null,
        institution_name: institution?.name || null,
      })
      .select()
      .single()

    if (itemError) {
      return NextResponse.json({ error: itemError.message }, { status: 500 })
    }

    const accountsResponse = await plaidClient.accountsGet({ access_token: accessToken })
    const accounts = accountsResponse.data.accounts

    const rows = accounts.map((a) => ({
      user_id: user.id,
      item_id: itemRow.id,
      account_id: a.account_id,
      name: a.name,
      official_name: a.official_name,
      mask: a.mask,
      type: a.type,
      subtype: a.subtype,
      category: categorize(a.type, a.subtype),
      current_balance: a.balances?.current ?? null,
      available_balance: a.balances?.available ?? null,
      iso_currency_code: a.balances?.iso_currency_code ?? null,
    }))

    const { error: accountsError } = await supabase
      .from('plaid_accounts')
      .upsert(rows, { onConflict: 'account_id' })

    if (accountsError) {
      return NextResponse.json({ error: accountsError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, accounts: rows.length })
  } catch (err) {
    const message = err?.response?.data?.error_message || err.message || 'failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
