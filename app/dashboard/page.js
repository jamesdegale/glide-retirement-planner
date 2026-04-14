import { redirect } from 'next/navigation'
import { createClient } from '../../lib/supabase-server'
import SignOutButton from './SignOutButton'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/signin')
  }

  return (
    <main className="min-h-screen bg-slate-900">
      <nav className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex justify-between items-center">
        <div className="flex items-baseline gap-2">
          <span className="text-white text-2xl font-bold tracking-tight">Glide</span>
          <span className="text-blue-400 text-sm font-medium">by Clark.com</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-slate-400 text-sm hidden sm:inline">{user.email}</span>
          <SignOutButton />
        </div>
      </nav>

      <section className="px-6 py-12 max-w-5xl mx-auto">
        <h1 className="text-white text-4xl font-bold mb-2">Your dashboard</h1>
        <p className="text-slate-400 text-lg mb-10">
          Welcome back. Here&apos;s your financial glide path at a glance.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
            <div className="text-slate-400 text-sm mb-2">Net worth</div>
            <div className="text-white text-3xl font-bold">—</div>
            <div className="text-slate-500 text-sm mt-2">Connect an account to begin</div>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
            <div className="text-slate-400 text-sm mb-2">Retirement target</div>
            <div className="text-white text-3xl font-bold">—</div>
            <div className="text-slate-500 text-sm mt-2">Set a goal to track progress</div>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6">
            <div className="text-slate-400 text-sm mb-2">On-track score</div>
            <div className="text-white text-3xl font-bold">—</div>
            <div className="text-slate-500 text-sm mt-2">Available once you have a plan</div>
          </div>
        </div>

        <div className="mt-10 bg-slate-800 border border-slate-700 rounded-2xl p-8">
          <h2 className="text-white text-xl font-semibold mb-2">Get started</h2>
          <p className="text-slate-400 mb-6">
            Finish setting up your profile so we can build your personalized plan.
          </p>
          <button className="bg-blue-500 hover:bg-blue-400 text-white font-medium px-5 py-2.5 rounded-lg">
            Set up my plan
          </button>
        </div>
      </section>
    </main>
  )
}
