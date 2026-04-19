import { NextResponse } from 'next/server'
import { Products, CountryCode } from 'plaid'
import { createClient } from '../../../../lib/supabase-server'
import { plaidClient } from '../../../../lib/plaid'

export async function POST() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: 'Glide',
      products: [Products.Auth, Products.Investments, Products.Liabilities],
      country_codes: [CountryCode.Us],
      language: 'en',
    })
    return NextResponse.json({ link_token: response.data.link_token })
  } catch (err) {
    const message = err?.response?.data?.error_message || err.message || 'failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
