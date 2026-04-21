import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase-server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('retirement_scenarios')
    .select('id, name, is_base, inputs, results, updated_at')
    .eq('user_id', user.id)
    .order('is_base', { ascending: false })
    .order('created_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ scenarios: data || [] })
}

export async function POST(request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, inputs, is_base } = body || {}
  if (!inputs) return NextResponse.json({ error: 'Inputs required' }, { status: 400 })

  const { data, error } = await supabase
    .from('retirement_scenarios')
    .insert({
      user_id: user.id,
      name: name || 'New scenario',
      is_base: is_base || false,
      inputs,
    })
    .select('id, name, is_base, inputs, results, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ scenario: data })
}

export async function PUT(request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { id, inputs, results, name } = body || {}
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const update = { updated_at: new Date().toISOString() }
  if (inputs) update.inputs = inputs
  if (results !== undefined) update.results = results
  if (name !== undefined) update.name = name

  const { error } = await supabase
    .from('retirement_scenarios')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { data: scenario } = await supabase
    .from('retirement_scenarios')
    .select('is_base')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (scenario?.is_base) {
    return NextResponse.json({ error: 'Cannot delete base plan' }, { status: 400 })
  }

  const { error } = await supabase
    .from('retirement_scenarios')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
