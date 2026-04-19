import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase-server'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('retirement_plans')
    .select('inputs, results, updated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ plan: data })
}

export async function PUT(request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { inputs, results } = body || {}
  if (!inputs || typeof inputs !== 'object') {
    return NextResponse.json({ error: 'Invalid inputs' }, { status: 400 })
  }

  const { error } = await supabase
    .from('retirement_plans')
    .upsert(
      {
        user_id: user.id,
        inputs,
        results: results || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
