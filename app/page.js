export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50">
      <nav className="bg-slate-900 px-6 py-4 flex justify-between items-center">
        <div className="flex items-baseline gap-2">
          <span className="text-white text-2xl font-bold tracking-tight">Glide</span>
          <span className="text-blue-400 text-sm font-medium">by Clark.com</span>
        </div>
        <div className="flex gap-4 items-center">
          <a href="/signin" className="text-slate-300 text-sm hover:text-white">Sign in</a>
          <a href="/signup" className="bg-blue-500 hover:bg-blue-400 text-white text-sm px-4 py-2 rounded-lg">Get started free</a>
        </div>
      </nav>

      <section className="bg-slate-900 px-6 py-24 text-center">
        <h1 className="text-white text-5xl font-bold max-w-2xl mx-auto leading-tight mb-6">
          Know exactly where you stand financially
        </h1>
        <p className="text-slate-400 text-xl max-w-xl mx-auto mb-10">
          Track your net worth, model retirement scenarios, and build a plan you can actually follow.
        </p>
        <a href="/signup" className="bg-blue-500 hover:bg-blue-400 text-white text-lg px-8 py-4 rounded-xl inline-block">
          Start for free
        </a>
      </section>

      <section className="px-6 py-20 max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100">
            <div className="text-3xl mb-4">📊</div>
            <h2 className="text-slate-900 text-xl font-semibold mb-3">Track</h2>
            <p className="text-slate-500">Connect your accounts and see your complete financial picture — net worth, investments, and savings — in one place.</p>
          </div>
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100">
            <div className="text-3xl mb-4">🔭</div>
            <h2 className="text-slate-900 text-xl font-semibold mb-3">Plan</h2>
            <p className="text-slate-500">Run scenarios, model different retirement ages, and see exactly how today's decisions affect your future.</p>
          </div>
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100">
            <div className="text-3xl mb-4">✈️</div>
            <h2 className="text-slate-900 text-xl font-semibold mb-3">Glide</h2>
            <p className="text-slate-500">Get a personalized plan and the confidence to stay on course — so you can stop worrying and start living.</p>
          </div>
        </div>
      </section>

      <section className="bg-slate-900 px-6 py-16 text-center">
        <h2 className="text-white text-3xl font-bold mb-4">Ready to get clarity?</h2>
        <p className="text-slate-400 mb-8">Free to start. No credit card required.</p>
        <a href="/signup" className="bg-blue-500 hover:bg-blue-400 text-white text-lg px-8 py-4 rounded-xl inline-block">
          Create your free account
        </a>
      </section>

      <footer className="px-6 py-8 text-center text-slate-400 text-sm">
        <p>© 2026 Glide · A Clark.com product · <a href="#" className="hover:text-slate-600">Privacy</a> · <a href="#" className="hover:text-slate-600">Terms</a></p>
      </footer>
    </main>
  );
}