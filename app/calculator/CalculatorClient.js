'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Script from 'next/script'
import SignOutButton from '../dashboard/SignOutButton'

const ACCOUNT_TYPES = [
  { value: '401k', label: '401(k) / 403(b) / TSP', bucket: 'pretax' },
  { value: 'traditional_ira', label: 'Traditional IRA', bucket: 'pretax' },
  { value: 'roth_ira', label: 'Roth IRA', bucket: 'roth' },
  { value: 'brokerage', label: 'Taxable Brokerage', bucket: 'brokerage' },
  { value: 'cash', label: 'Cash / Savings', bucket: 'cash' },
  { value: 'pension', label: 'Pension', bucket: 'pretax' },
  { value: 'real_estate', label: 'Real Estate', bucket: 'real_estate' },
]

const TYPE_META = Object.fromEntries(ACCOUNT_TYPES.map((t) => [t.value, t]))

const OWNERS = [
  { value: 'self', label: 'You' },
  { value: 'spouse', label: 'Spouse' },
  { value: 'joint', label: 'Joint' },
]

const DEFAULT_INPUTS = {
  currentAge: 40,
  lifeExpectancy: 90,
  retirementAge: 65,
  retirementIncomeNeeded: 80000,
  monthlySavings: 1500,
  increaseSavings: false,
  savingsIncreaseRate: 2,
  socialSecurityAmount: 2000,
  socialSecurityAge: 67,
  spouseEnabled: false,
  spouseCurrentAge: 40,
  spouseRetirementAge: 65,
  spouseSSAmount: 0,
  spouseSSAge: 67,
  preRetirementReturn: 9,
  postRetirementReturn: 6,
  inflationRate: 2.5,
  retirementBalanceGoal: 0,
  expectLumpSum: false,
  lumpSumAmount: 0,
  lumpSumAge: 65,
  incomeSources: [],
  majorExpenses: [],
  accounts: [],
  showFutureDollars: false,
}

function fmt(value) {
  if (value == null || !isFinite(value)) return '$0'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(Math.round(value))
}

function parseMoney(value) {
  if (typeof value === 'number') return value
  if (!value) return 0
  const n = parseFloat(String(value).replace(/[^0-9.-]/g, ''))
  return isNaN(n) ? 0 : n
}

function randNormal() {
  let u = 0,
    v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

function bucketKey(type) {
  return TYPE_META[type]?.bucket || 'brokerage'
}

function aggregateBuckets(accounts) {
  const buckets = { cash: 0, brokerage: 0, pretax: 0, roth: 0, real_estate: 0 }
  for (const a of accounts) {
    const b = bucketKey(a.type)
    buckets[b] = (buckets[b] || 0) + Number(a.balance || 0)
  }
  return buckets
}

function sumInvestable(b) {
  return b.cash + b.brokerage + b.pretax + b.roth
}

function withdrawFromBuckets(buckets, needed, yearlySpendFuture, withinRMD) {
  const cashFloor = yearlySpendFuture
  let remaining = needed
  const seq = []

  if (withinRMD && buckets.pretax > 0 && remaining > 0) {
    const rmd = Math.min(buckets.pretax * 0.06, remaining)
    if (rmd > 0) {
      buckets.pretax -= rmd
      remaining -= rmd
      seq.push({ from: 'pretax', amount: rmd, note: 'RMD' })
    }
  }

  if (remaining > 0 && buckets.brokerage > 0) {
    const t = Math.min(buckets.brokerage, remaining)
    buckets.brokerage -= t
    remaining -= t
    seq.push({ from: 'brokerage', amount: t })
  }

  if (remaining > 0 && buckets.cash > cashFloor) {
    const t = Math.min(buckets.cash - cashFloor, remaining)
    buckets.cash -= t
    remaining -= t
    seq.push({ from: 'cash', amount: t })
  }

  if (remaining > 0 && buckets.pretax > 0) {
    const t = Math.min(buckets.pretax, remaining)
    buckets.pretax -= t
    remaining -= t
    seq.push({ from: 'pretax', amount: t })
  }

  if (remaining > 0 && buckets.roth > 0) {
    const t = Math.min(buckets.roth, remaining)
    buckets.roth -= t
    remaining -= t
    seq.push({ from: 'roth', amount: t })
  }

  if (remaining > 0 && buckets.cash > 0) {
    const t = Math.min(buckets.cash, remaining)
    buckets.cash -= t
    remaining -= t
    seq.push({ from: 'cash', amount: t, note: 'below floor' })
  }

  return { shortfall: remaining, seq }
}

function growAccumulation(buckets, annualReturn, contributions) {
  const investable = sumInvestable(buckets)
  if (investable > 0) {
    const growthFactor = 1 + annualReturn
    buckets.cash *= growthFactor
    buckets.brokerage *= growthFactor
    buckets.pretax *= growthFactor
    buckets.roth *= growthFactor
  }
  if (contributions > 0) {
    if (buckets.pretax > 0 || investable === 0) buckets.pretax += contributions
    else if (buckets.brokerage > 0) buckets.brokerage += contributions
    else if (buckets.roth > 0) buckets.roth += contributions
    else buckets.cash += contributions
  }
}

function computeAdditionalIncomeFuture(age, incomeSources, currentAge, inflationRate) {
  let total = 0
  for (const s of incomeSources) {
    if (age >= s.startAge && age <= s.endAge) {
      let base = s.amount * 12
      if (s.dollarType === 'today') {
        base *= Math.pow(1 + inflationRate, s.startAge - currentAge)
      }
      const fromStart = age - s.startAge
      if (s.inflationAdjust && fromStart > 0) {
        base *= Math.pow(1 + inflationRate, fromStart)
      }
      total += base
    }
  }
  return total
}

function computeMajorExpenseFuture(age, majorExpenses, currentAge, inflationRate) {
  let total = 0
  for (const e of majorExpenses) {
    if (e.age === age) {
      let amt = e.amount
      if (e.dollarType === 'today') {
        amt *= Math.pow(1 + inflationRate, age - currentAge)
      }
      total += amt
    }
  }
  return total
}

function runProjection(i, opts = {}) {
  const {
    currentAge,
    lifeExpectancy,
    retirementAge,
    retirementIncomeNeeded,
    monthlySavings,
    increaseSavings,
    socialSecurityAmount,
    socialSecurityAge,
    spouseEnabled,
    spouseCurrentAge,
    spouseSSAmount,
    spouseSSAge,
    expectLumpSum,
    lumpSumAmount,
    lumpSumAge,
    incomeSources,
    majorExpenses,
    accounts,
  } = i

  const preRetirementReturn = (i.preRetirementReturn || 0) / 100
  const postRetirementReturn = (i.postRetirementReturn || 0) / 100
  const inflationRate = (i.inflationRate || 0) / 100
  const ssIncrease = (i.savingsIncreaseRate || 0) / 100

  const stochastic = opts.stochastic || false
  const sigma = opts.sigma || 0.12

  let buckets = aggregateBuckets(accounts)
  let savings = monthlySavings
  const preData = []
  const yearsToRetirement = retirementAge - currentAge

  preData.push({
    age: currentAge,
    contributions: 0,
    growth: 0,
    majorExpense: 0,
    balance: sumInvestable(buckets) + buckets.real_estate,
    investable: sumInvestable(buckets),
  })

  for (let year = 1; year <= yearsToRetirement; year++) {
    const age = currentAge + year
    const contributions = savings * 12
    const ret = stochastic ? preRetirementReturn + sigma * randNormal() : preRetirementReturn
    const beforeInvestable = sumInvestable(buckets)
    growAccumulation(buckets, ret, contributions)
    const afterInvestable = sumInvestable(buckets)
    const growth = afterInvestable - beforeInvestable - contributions

    let majorExpense = computeMajorExpenseFuture(age, majorExpenses, currentAge, inflationRate)
    if (majorExpense > 0) {
      let remaining = majorExpense
      for (const b of ['cash', 'brokerage', 'pretax', 'roth']) {
        if (remaining <= 0) break
        const t = Math.min(buckets[b], remaining)
        buckets[b] -= t
        remaining -= t
      }
    }

    if (expectLumpSum && age === lumpSumAge && lumpSumAge <= retirementAge) {
      buckets.brokerage += lumpSumAmount
    }

    preData.push({
      age,
      contributions,
      growth,
      majorExpense,
      balance: sumInvestable(buckets) + buckets.real_estate,
      investable: sumInvestable(buckets),
    })

    if (increaseSavings) savings *= 1 + ssIncrease
  }

  const postData = []
  const ssFutureSelf = socialSecurityAmount * 12 * Math.pow(1 + inflationRate, yearsToRetirement)
  const ssFutureSpouse = spouseEnabled
    ? spouseSSAmount * 12 * Math.pow(1 + inflationRate, yearsToRetirement)
    : 0

  let runOutAge = null

  for (let year = 1; year <= lifeExpectancy - retirementAge; year++) {
    const age = retirementAge + year
    const yearsFromRetirement = year
    const yearsFromToday = yearsToRetirement + year

    const incomeNeededFuture = retirementIncomeNeeded * Math.pow(1 + inflationRate, yearsFromToday)
    const ssSelf = age >= socialSecurityAge ? ssFutureSelf * Math.pow(1 + inflationRate, yearsFromRetirement) : 0
    const spouseAgeNow = spouseEnabled ? spouseCurrentAge + (age - currentAge) : 0
    const ssSpouse =
      spouseEnabled && spouseAgeNow >= spouseSSAge
        ? ssFutureSpouse * Math.pow(1 + inflationRate, yearsFromRetirement)
        : 0
    const ssIncome = ssSelf + ssSpouse

    const otherIncome = computeAdditionalIncomeFuture(age, incomeSources, currentAge, inflationRate)

    let lumpSumIncome = 0
    if (expectLumpSum && age === lumpSumAge && lumpSumAge > retirementAge) {
      lumpSumIncome = lumpSumAmount
      buckets.brokerage += lumpSumAmount
    }

    const majorExpense = computeMajorExpenseFuture(age, majorExpenses, currentAge, inflationRate)

    const ret = stochastic ? postRetirementReturn + sigma * randNormal() : postRetirementReturn
    const growthFactor = 1 + ret
    buckets.cash *= growthFactor
    buckets.brokerage *= growthFactor
    buckets.pretax *= growthFactor
    buckets.roth *= growthFactor
    const startBalance = sumInvestable(buckets)

    const netNeed = Math.max(0, incomeNeededFuture - ssIncome - otherIncome + majorExpense)
    const withinRMD = age >= 68 || (spouseEnabled && spouseAgeNow >= 68)
    const withdrawal = withdrawFromBuckets(buckets, netNeed, incomeNeededFuture, withinRMD)

    const endBalance = sumInvestable(buckets)
    const growth = startBalance - (endBalance + (netNeed - withdrawal.shortfall))

    if (endBalance <= 0 && runOutAge === null && year < lifeExpectancy - retirementAge) {
      runOutAge = age
    }

    postData.push({
      age,
      withdrawal: netNeed,
      withdrawalGross: incomeNeededFuture,
      ssIncome,
      otherIncome,
      lumpSumIncome,
      majorExpense,
      growth,
      balance: endBalance + buckets.real_estate,
      investable: endBalance,
      seq: withdrawal.seq,
      shortfall: withdrawal.shortfall,
      withinRMD,
    })
  }

  return {
    preData,
    postData,
    runOutAge,
    finalBalance: postData.length > 0 ? postData[postData.length - 1].investable : sumInvestable(buckets),
    finalWithRealEstate:
      postData.length > 0
        ? postData[postData.length - 1].balance
        : sumInvestable(buckets) + buckets.real_estate,
    retirementBalance: preData[preData.length - 1]?.investable || 0,
  }
}

function runMonteCarlo(inputs, runs = 1000) {
  const results = []
  let successes = 0
  const target =
    (runProjection(inputs).retirementBalance || 0) * (inputs.retirementBalanceGoal / 100)
  for (let i = 0; i < runs; i++) {
    const r = runProjection(inputs, { stochastic: true, sigma: 0.12 })
    const final = r.finalBalance
    results.push(final)
    if (r.runOutAge === null && final >= target) successes += 1
  }
  results.sort((a, b) => a - b)
  const pick = (p) => results[Math.max(0, Math.min(results.length - 1, Math.floor(p * results.length)))]
  return {
    probability: successes / runs,
    p25: pick(0.25),
    p50: pick(0.5),
    p75: pick(0.75),
    runs,
  }
}

export default function CalculatorClient({ userEmail, plaidAccounts, savedPlan }) {
  const [inputs, setInputs] = useState(() => {
    if (savedPlan?.inputs) return { ...DEFAULT_INPUTS, ...savedPlan.inputs }
    return DEFAULT_INPUTS
  })
  const [prepopChoice, setPrepopChoice] = useState(() => {
    if (savedPlan?.inputs) return 'loaded'
    return plaidAccounts.length > 0 ? 'pending' : 'manual'
  })
  const [saveState, setSaveState] = useState({ status: 'idle', message: '' })
  const pdfReadyRef = useRef(false)

  const setInput = (key, value) => setInputs((prev) => ({ ...prev, [key]: value }))

  const usePlaidAccounts = () => {
    const grouped = plaidAccounts.map((a) => ({
      id: crypto.randomUUID(),
      name: `${a.institution} ${a.name}${a.mask ? ` ··${a.mask}` : ''}`.trim(),
      type: a.type,
      owner: 'self',
      balance: a.balance,
    }))
    setInputs((prev) => ({ ...prev, accounts: grouped }))
    setPrepopChoice('used')
  }

  const addAccount = () => {
    setInputs((prev) => ({
      ...prev,
      accounts: [
        ...prev.accounts,
        { id: crypto.randomUUID(), name: '', type: '401k', owner: 'self', balance: 0 },
      ],
    }))
  }

  const updateAccount = (id, patch) => {
    setInputs((prev) => ({
      ...prev,
      accounts: prev.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    }))
  }

  const removeAccount = (id) => {
    setInputs((prev) => ({ ...prev, accounts: prev.accounts.filter((a) => a.id !== id) }))
  }

  const addIncomeSource = () =>
    setInputs((prev) => ({
      ...prev,
      incomeSources: [
        ...prev.incomeSources,
        {
          id: crypto.randomUUID(),
          description: 'Income',
          amount: 0,
          startAge: prev.retirementAge,
          endAge: prev.lifeExpectancy,
          dollarType: 'today',
          inflationAdjust: true,
        },
      ],
    }))
  const updateIncomeSource = (id, patch) =>
    setInputs((prev) => ({
      ...prev,
      incomeSources: prev.incomeSources.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }))
  const removeIncomeSource = (id) =>
    setInputs((prev) => ({
      ...prev,
      incomeSources: prev.incomeSources.filter((s) => s.id !== id),
    }))

  const addMajorExpense = () =>
    setInputs((prev) => ({
      ...prev,
      majorExpenses: [
        ...prev.majorExpenses,
        {
          id: crypto.randomUUID(),
          description: 'Expense',
          amount: 0,
          age: prev.currentAge,
          dollarType: 'today',
        },
      ],
    }))
  const updateMajorExpense = (id, patch) =>
    setInputs((prev) => ({
      ...prev,
      majorExpenses: prev.majorExpenses.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }))
  const removeMajorExpense = (id) =>
    setInputs((prev) => ({
      ...prev,
      majorExpenses: prev.majorExpenses.filter((e) => e.id !== id),
    }))

  const validInputs = useMemo(() => {
    return (
      inputs.retirementAge > inputs.currentAge &&
      inputs.lifeExpectancy > inputs.retirementAge &&
      inputs.accounts.length > 0
    )
  }, [inputs])

  const results = useMemo(() => {
    if (!validInputs) return null
    return runProjection(inputs)
  }, [inputs, validInputs])

  const [monte, setMonte] = useState(null)
  useEffect(() => {
    if (!validInputs) { setMonte(null); return }
    setMonte(runMonteCarlo(inputs, 1000))
  }, [inputs, validInputs])

  const totals = useMemo(() => {
    const byBucket = aggregateBuckets(inputs.accounts)
    const investable = sumInvestable(byBucket)
    const netWorth = investable + byBucket.real_estate
    const pretaxShare = investable > 0 ? byBucket.pretax / investable : 0
    return { byBucket, investable, netWorth, pretaxShare }
  }, [inputs.accounts])

  const advisorPrompts = useMemo(() => {
    const prompts = []
    if (inputs.preRetirementReturn > 8) {
      prompts.push({
        id: 'aggressive-returns',
        title: 'Aggressive return assumption',
        message:
          'Your plan assumes aggressive returns — want to stress test this with an advisor?',
      })
    }
    const selfYearsTo73 = 73 - inputs.currentAge
    const spouseYearsTo73 = inputs.spouseEnabled ? 73 - inputs.spouseCurrentAge : 999
    if ((selfYearsTo73 > 0 && selfYearsTo73 <= 5) || (spouseYearsTo73 > 0 && spouseYearsTo73 <= 5)) {
      prompts.push({
        id: 'rmd',
        title: 'Approaching RMDs',
        message:
          "You're approaching Required Minimum Distributions — have you planned for the tax impact?",
      })
    }
    if (totals.pretaxShare > 0.8 && totals.investable > 0) {
      prompts.push({
        id: 'roth-conversion',
        title: 'Roth conversion opportunity',
        message:
          'Most of your savings are pre-tax. A Roth conversion strategy could reduce your future tax burden significantly.',
      })
    }
    if (monte && monte.probability < 0.8) {
      prompts.push({
        id: 'low-prob',
        title: 'Success probability below 80%',
        message:
          'Your plan has meaningful risk of running short. An advisor can help close the gap.',
      })
    }
    if (results && results.retirementBalance > 0) {
      const wr = (inputs.retirementIncomeNeeded || 0) / (results.retirementBalance || 1)
      if (wr > 0.05) {
        prompts.push({
          id: 'withdrawal-rate',
          title: 'Withdrawal rate above 5%',
          message:
            'Your withdrawal rate is above the historically safe threshold — this is worth a conversation.',
        })
      }
    }
    if (inputs.socialSecurityAge < 67 && totals.investable > 500000) {
      prompts.push({
        id: 'ss-delay',
        title: 'Consider delaying Social Security',
        message:
          'Delaying Social Security could significantly increase your lifetime benefit.',
      })
    }
    if (inputs.spouseEnabled) {
      prompts.push({
        id: 'spouse-ss',
        title: 'Coordinate spousal strategy',
        message:
          'Have you coordinated your Social Security claiming strategy as a couple? Timing can make a major difference.',
      })
    }
    return prompts
  }, [inputs, results, monte, totals])

  const savePlan = async () => {
    setSaveState({ status: 'saving', message: '' })
    try {
      const res = await fetch('/api/retirement-plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs,
          results: results
            ? {
                retirementBalance: results.retirementBalance,
                finalBalance: results.finalBalance,
                runOutAge: results.runOutAge,
                monte,
              }
            : null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Save failed')
      }
      setSaveState({ status: 'saved', message: 'Plan saved' })
      setTimeout(() => setSaveState({ status: 'idle', message: '' }), 2500)
    } catch (err) {
      setSaveState({ status: 'error', message: err.message })
    }
  }

  const downloadPdf = async () => {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert('PDF library still loading — try again in a moment.')
      return
    }
    const { jsPDF } = window.jspdf
    const doc = new jsPDF()
    const margin = 10
    let y = margin

    const text = (t, x, yy, opts = {}) => {
      const lines = doc.splitTextToSize(t, 190)
      doc.text(lines, x, yy, opts)
      return yy + lines.length * (opts.lineHeight || 7)
    }

    doc.setFontSize(16)
    doc.setTextColor(59, 130, 246)
    y = text('Glide Retirement Plan', margin, y)
    y += 4
    doc.setFontSize(11)
    doc.setTextColor(30, 41, 59)
    y = text(`Prepared for: ${userEmail}`, margin, y, { lineHeight: 6 })
    y += 4

    doc.setFontSize(13)
    y = text('Inputs', margin, y, { lineHeight: 7 })
    doc.setFontSize(10)
    const lines = [
      `Current age: ${inputs.currentAge}  |  Retirement age: ${inputs.retirementAge}  |  Life expectancy: ${inputs.lifeExpectancy}`,
      `Monthly savings: ${fmt(inputs.monthlySavings)}  |  Annual income need (today): ${fmt(inputs.retirementIncomeNeeded)}`,
      `Social Security: ${fmt(inputs.socialSecurityAmount)}/mo at age ${inputs.socialSecurityAge}`,
      `Pre-ret. return: ${inputs.preRetirementReturn}%  |  Post-ret. return: ${inputs.postRetirementReturn}%  |  Inflation: ${inputs.inflationRate}%`,
    ]
    if (inputs.spouseEnabled) {
      lines.push(
        `Spouse age ${inputs.spouseCurrentAge}, retire ${inputs.spouseRetirementAge}, SS ${fmt(inputs.spouseSSAmount)}/mo at ${inputs.spouseSSAge}`
      )
    }
    for (const l of lines) y = text(l, margin + 4, y, { lineHeight: 6 })

    y += 4
    doc.setFontSize(13)
    y = text('Accounts', margin, y, { lineHeight: 7 })
    doc.setFontSize(10)
    if (doc.autoTable) {
      const accountRows = inputs.accounts.map((a) => [
        a.name || TYPE_META[a.type]?.label || 'Account',
        TYPE_META[a.type]?.label || a.type,
        OWNERS.find((o) => o.value === a.owner)?.label || a.owner,
        fmt(a.balance),
      ])
      doc.autoTable({
        startY: y,
        head: [['Name', 'Type', 'Owner', 'Balance']],
        body: accountRows,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [30, 58, 138] },
      })
      y = doc.lastAutoTable.finalY + 6
    }

    doc.setFontSize(13)
    y = text('Results', margin, y, { lineHeight: 7 })
    doc.setFontSize(10)
    if (results) {
      const rows = [
        `Retirement balance (future $): ${fmt(results.retirementBalance)}`,
        `Final balance at age ${inputs.lifeExpectancy}: ${fmt(results.finalBalance)}`,
        `Run-out age: ${results.runOutAge ?? '—'}`,
      ]
      if (monte) {
        rows.push(
          `Monte Carlo success: ${(monte.probability * 100).toFixed(1)}% (${monte.runs} sims)`,
          `P25 / P50 / P75 final: ${fmt(monte.p25)} / ${fmt(monte.p50)} / ${fmt(monte.p75)}`
        )
      }
      for (const l of rows) y = text(l, margin + 4, y, { lineHeight: 6 })
    }

    if (advisorPrompts.length > 0 && doc.autoTable) {
      y += 4
      doc.setFontSize(13)
      y = text('Advisor Discussion Topics', margin, y, { lineHeight: 7 })
      doc.setFontSize(10)
      doc.autoTable({
        startY: y,
        head: [['Topic', 'Message']],
        body: advisorPrompts.map((p) => [p.title, p.message]),
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [30, 58, 138] },
      })
      y = doc.lastAutoTable.finalY + 6
    }

    if (results && doc.autoTable) {
      const infl = inputs.inflationRate / 100
      const postRows = results.postData.map((r) => {
        const ytd = r.age - inputs.currentAge
        const disp = (v) => (inputs.showFutureDollars ? v : v / Math.pow(1 + infl, ytd))
        return [
          r.age,
          fmt(disp(r.withdrawalGross)),
          fmt(disp(r.ssIncome)),
          fmt(disp(r.otherIncome)),
          fmt(disp(r.growth)),
          fmt(disp(r.balance)),
        ]
      })
      doc.addPage()
      y = margin
      doc.setFontSize(13)
      y = text('Post-retirement Breakdown', margin, y, { lineHeight: 7 })
      doc.autoTable({
        startY: y,
        head: [['Age', 'Spend', 'SS', 'Other inc.', 'Growth', 'Balance']],
        body: postRows,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [30, 58, 138] },
      })
    }

    doc.save('glide-retirement-plan.pdf')
  }

  const infl = inputs.inflationRate / 100
  const yearsToRetirement = inputs.retirementAge - inputs.currentAge
  const display = (future, yearsFromToday) =>
    inputs.showFutureDollars ? future : future / Math.pow(1 + infl, yearsFromToday)

  const retirementBalanceDisplay = results
    ? display(results.retirementBalance, inputs.showFutureDollars ? 0 : yearsToRetirement)
    : 0
  const finalBalanceDisplay = results
    ? display(results.finalBalance, inputs.showFutureDollars ? 0 : inputs.lifeExpectancy - inputs.currentAge)
    : 0

  return (
    <main className="min-h-screen bg-slate-900 text-slate-100">
      <Script
        src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
        strategy="afterInteractive"
        onLoad={() => {
          pdfReadyRef.current = !!window.jspdf
        }}
      />
      <Script
        src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.23/jspdf.plugin.autotable.min.js"
        strategy="afterInteractive"
      />

      <nav className="border-b border-slate-800 px-6 py-4 flex justify-between items-center">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-white text-2xl font-bold tracking-tight">Glide</span>
          <span className="text-blue-400 text-sm font-medium">by Clark.com</span>
        </Link>
        <div className="flex items-center gap-4">
          <span className="text-slate-400 text-sm hidden sm:inline">{userEmail}</span>
          <SignOutButton />
        </div>
      </nav>

      <div className="border-b border-slate-800 px-6">
        <div className="max-w-7xl mx-auto flex gap-1">
          <Link
            href="/dashboard"
            className="px-4 py-3 text-slate-400 hover:text-white font-medium text-sm border-b-2 border-transparent hover:border-slate-600 transition-colors"
          >
            Dashboard
          </Link>
          <button className="px-4 py-3 text-white font-medium border-b-2 border-blue-500 text-sm">
            Retirement Plan
          </button>
        </div>
      </div>

      <section className="px-4 sm:px-6 py-10 max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-white text-4xl font-bold mb-2">Retirement Plan</h1>
          <p className="text-slate-400 text-lg">
            Model your glide path. Powered by Monte Carlo simulation and tax-aware withdrawal
            sequencing.
          </p>
        </div>

        {prepopChoice === 'pending' && (
          <div className="mb-8 bg-gradient-to-br from-blue-600 to-blue-800 border border-blue-500/30 rounded-2xl p-6">
            <h3 className="text-white text-lg font-semibold mb-2">
              Use your connected accounts?
            </h3>
            <p className="text-blue-100 mb-4">
              We found {plaidAccounts.length} connected account
              {plaidAccounts.length === 1 ? '' : 's'}. Pre-fill your balances from Plaid so you
              can start modelling immediately. All fields stay editable.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={usePlaidAccounts}
                className="bg-white text-blue-700 hover:bg-blue-50 font-medium px-4 py-2 rounded-lg"
              >
                Use connected accounts
              </button>
              <button
                onClick={() => setPrepopChoice('manual')}
                className="bg-blue-950/50 hover:bg-blue-950 text-blue-100 font-medium px-4 py-2 rounded-lg border border-blue-500/30"
              >
                Enter manually
              </button>
            </div>
          </div>
        )}

        {savedPlan && prepopChoice === 'loaded' && (
          <div className="mb-8 bg-slate-800 border border-slate-700 rounded-2xl p-4 flex flex-wrap items-center gap-3 justify-between">
            <div>
              <p className="text-white font-medium">Loaded your saved plan</p>
              <p className="text-slate-400 text-sm">
                Last saved {new Date(savedPlan.updated_at).toLocaleString()}
              </p>
            </div>
            {plaidAccounts.length > 0 && (
              <button
                onClick={usePlaidAccounts}
                className="bg-blue-500 hover:bg-blue-400 text-white font-medium px-4 py-2 rounded-lg"
              >
                Refresh from connected accounts
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <Section title="Basic information">
              <NumberField
                label="Current age"
                value={inputs.currentAge}
                min={10}
                max={90}
                onChange={(v) => setInput('currentAge', v)}
              />
              <NumberField
                label="Life expectancy"
                value={inputs.lifeExpectancy}
                min={50}
                max={120}
                onChange={(v) => setInput('lifeExpectancy', v)}
              />
              <NumberField
                label="Planned retirement age"
                value={inputs.retirementAge}
                min={40}
                max={90}
                onChange={(v) => setInput('retirementAge', v)}
              />
              <MoneyField
                label="Annual pre-tax income needed in retirement (today's $)"
                value={inputs.retirementIncomeNeeded}
                onChange={(v) => setInput('retirementIncomeNeeded', v)}
              />
              <MoneyField
                label="Monthly savings for retirement"
                value={inputs.monthlySavings}
                onChange={(v) => setInput('monthlySavings', v)}
              />
              <Toggle
                label="Increase monthly savings each year"
                checked={inputs.increaseSavings}
                onChange={(v) => setInput('increaseSavings', v)}
              />
              {inputs.increaseSavings && (
                <NumberField
                  label="Annual increase (%)"
                  value={inputs.savingsIncreaseRate}
                  min={0}
                  max={20}
                  step={0.5}
                  onChange={(v) => setInput('savingsIncreaseRate', v)}
                />
              )}
              <MoneyField
                label="Your monthly Social Security (today's $)"
                value={inputs.socialSecurityAmount}
                onChange={(v) => setInput('socialSecurityAmount', v)}
              />
              <NumberField
                label="Age to start Social Security"
                value={inputs.socialSecurityAge}
                min={62}
                max={70}
                onChange={(v) => setInput('socialSecurityAge', v)}
              />
            </Section>

            <Section title="Spouse / partner">
              <Toggle
                label="Include a spouse or partner"
                checked={inputs.spouseEnabled}
                onChange={(v) => setInput('spouseEnabled', v)}
              />
              {inputs.spouseEnabled && (
                <>
                  <NumberField
                    label="Spouse current age"
                    value={inputs.spouseCurrentAge}
                    min={10}
                    max={120}
                    onChange={(v) => setInput('spouseCurrentAge', v)}
                  />
                  <NumberField
                    label="Spouse planned retirement age"
                    value={inputs.spouseRetirementAge}
                    min={40}
                    max={90}
                    onChange={(v) => setInput('spouseRetirementAge', v)}
                  />
                  <MoneyField
                    label="Spouse monthly Social Security (today's $)"
                    value={inputs.spouseSSAmount}
                    onChange={(v) => setInput('spouseSSAmount', v)}
                  />
                  <NumberField
                    label="Spouse age to start Social Security"
                    value={inputs.spouseSSAge}
                    min={62}
                    max={70}
                    onChange={(v) => setInput('spouseSSAge', v)}
                  />
                </>
              )}
            </Section>

            <Section
              title="Accounts"
              right={
                <button
                  onClick={addAccount}
                  className="bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
                >
                  + Add account
                </button>
              }
            >
              {inputs.accounts.length === 0 && (
                <p className="text-slate-400 text-sm">
                  Add at least one account to run your plan.
                </p>
              )}
              <div className="space-y-3">
                {inputs.accounts.map((a) => (
                  <div
                    key={a.id}
                    className="bg-slate-900/60 border border-slate-700 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-12 gap-2"
                  >
                    <input
                      type="text"
                      placeholder="Account name"
                      value={a.name}
                      onChange={(e) => updateAccount(a.id, { name: e.target.value })}
                      className="sm:col-span-4 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                    />
                    <select
                      value={a.type}
                      onChange={(e) => updateAccount(a.id, { type: e.target.value })}
                      className="sm:col-span-3 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                    >
                      {ACCOUNT_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={a.owner}
                      onChange={(e) => updateAccount(a.id, { owner: e.target.value })}
                      className="sm:col-span-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                    >
                      {OWNERS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="$0"
                      value={a.balance ? fmt(a.balance) : ''}
                      onChange={(e) => updateAccount(a.id, { balance: parseMoney(e.target.value) })}
                      className="sm:col-span-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white text-right"
                    />
                    <button
                      onClick={() => removeAccount(a.id)}
                      className="sm:col-span-1 text-slate-500 hover:text-red-400 text-lg"
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </Section>

            <Section
              title="Additional income sources"
              right={
                <button
                  onClick={addIncomeSource}
                  className="bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
                >
                  + Add
                </button>
              }
            >
              {inputs.incomeSources.length === 0 && (
                <p className="text-slate-400 text-sm">
                  Pensions, part-time work, rental income, annuities.
                </p>
              )}
              <div className="space-y-3">
                {inputs.incomeSources.map((s) => (
                  <div key={s.id} className="bg-slate-900/60 border border-slate-700 rounded-xl p-3 space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Description"
                        value={s.description}
                        onChange={(e) => updateIncomeSource(s.id, { description: e.target.value })}
                        className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                      />
                      <button onClick={() => removeIncomeSource(s.id)} className="text-slate-500 hover:text-red-400 px-2">
                        ×
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-slate-400 flex flex-col gap-1">
                        Monthly $
                        <input
                          type="text"
                          inputMode="numeric"
                          value={s.amount ? fmt(s.amount) : ''}
                          onChange={(e) =>
                            updateIncomeSource(s.id, { amount: parseMoney(e.target.value) })
                          }
                          className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white"
                        />
                      </label>
                      <label className="text-xs text-slate-400 flex flex-col gap-1">
                        Dollar type
                        <select
                          value={s.dollarType}
                          onChange={(e) => updateIncomeSource(s.id, { dollarType: e.target.value })}
                          className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white"
                        >
                          <option value="today">Today&apos;s $</option>
                          <option value="future">Start-age $</option>
                        </select>
                      </label>
                      <label className="text-xs text-slate-400 flex flex-col gap-1">
                        Start age
                        <input
                          type="number"
                          value={s.startAge}
                          onChange={(e) =>
                            updateIncomeSource(s.id, { startAge: parseInt(e.target.value) || 0 })
                          }
                          className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white"
                        />
                      </label>
                      <label className="text-xs text-slate-400 flex flex-col gap-1">
                        End age
                        <input
                          type="number"
                          value={s.endAge}
                          onChange={(e) =>
                            updateIncomeSource(s.id, { endAge: parseInt(e.target.value) || 0 })
                          }
                          className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white"
                        />
                      </label>
                    </div>
                    <Toggle
                      label="Adjust for inflation after start age"
                      checked={s.inflationAdjust}
                      onChange={(v) => updateIncomeSource(s.id, { inflationAdjust: v })}
                    />
                  </div>
                ))}
              </div>
            </Section>

            <Section
              title="Major one-time expenses"
              right={
                <button
                  onClick={addMajorExpense}
                  className="bg-rose-500 hover:bg-rose-400 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
                >
                  + Add
                </button>
              }
            >
              {inputs.majorExpenses.length === 0 && (
                <p className="text-slate-400 text-sm">
                  Weddings, tuition, home purchase, medical.
                </p>
              )}
              <div className="space-y-3">
                {inputs.majorExpenses.map((e) => (
                  <div key={e.id} className="bg-slate-900/60 border border-slate-700 rounded-xl p-3 space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Description"
                        value={e.description}
                        onChange={(ev) => updateMajorExpense(e.id, { description: ev.target.value })}
                        className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                      />
                      <button onClick={() => removeMajorExpense(e.id)} className="text-slate-500 hover:text-red-400 px-2">
                        ×
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="text-xs text-slate-400 flex flex-col gap-1 col-span-1">
                        Amount
                        <input
                          type="text"
                          inputMode="numeric"
                          value={e.amount ? fmt(e.amount) : ''}
                          onChange={(ev) =>
                            updateMajorExpense(e.id, { amount: parseMoney(ev.target.value) })
                          }
                          className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white"
                        />
                      </label>
                      <label className="text-xs text-slate-400 flex flex-col gap-1">
                        Age
                        <input
                          type="number"
                          value={e.age}
                          onChange={(ev) =>
                            updateMajorExpense(e.id, { age: parseInt(ev.target.value) || 0 })
                          }
                          className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white"
                        />
                      </label>
                      <label className="text-xs text-slate-400 flex flex-col gap-1">
                        Dollar type
                        <select
                          value={e.dollarType}
                          onChange={(ev) => updateMajorExpense(e.id, { dollarType: ev.target.value })}
                          className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white"
                        >
                          <option value="today">Today&apos;s $</option>
                          <option value="future">Future $</option>
                        </select>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Lump sum">
              <Toggle
                label="Expecting a lump sum (inheritance, windfall)"
                checked={inputs.expectLumpSum}
                onChange={(v) => setInput('expectLumpSum', v)}
              />
              {inputs.expectLumpSum && (
                <div className="grid grid-cols-2 gap-3">
                  <MoneyField
                    label="Amount (future $)"
                    value={inputs.lumpSumAmount}
                    onChange={(v) => setInput('lumpSumAmount', v)}
                  />
                  <NumberField
                    label="Age received"
                    value={inputs.lumpSumAge}
                    min={inputs.currentAge}
                    max={inputs.lifeExpectancy}
                    onChange={(v) => setInput('lumpSumAge', v)}
                  />
                </div>
              )}
            </Section>

            <Section title="Growth assumptions">
              <NumberField
                label="Pre-retirement return (%)"
                value={inputs.preRetirementReturn}
                min={0}
                max={15}
                step={0.25}
                onChange={(v) => setInput('preRetirementReturn', v)}
              />
              <NumberField
                label="Post-retirement return (%)"
                value={inputs.postRetirementReturn}
                min={0}
                max={15}
                step={0.25}
                onChange={(v) => setInput('postRetirementReturn', v)}
              />
              <NumberField
                label="Inflation rate (%)"
                value={inputs.inflationRate}
                min={0}
                max={10}
                step={0.25}
                onChange={(v) => setInput('inflationRate', v)}
              />
              <NumberField
                label="Final balance target (% of initial retirement balance)"
                value={inputs.retirementBalanceGoal}
                min={0}
                max={200}
                step={5}
                onChange={(v) => setInput('retirementBalanceGoal', v)}
              />
            </Section>
          </div>

          <div className="space-y-6 lg:sticky lg:top-6 lg:self-start">
            <ResultsPanel
              inputs={inputs}
              results={results}
              monte={monte}
              totals={totals}
              validInputs={validInputs}
              retirementBalanceDisplay={retirementBalanceDisplay}
              finalBalanceDisplay={finalBalanceDisplay}
              onToggleFutureDollars={(v) => setInput('showFutureDollars', v)}
              onSave={savePlan}
              onDownload={downloadPdf}
              saveState={saveState}
            />

            <AdvisorPrompts prompts={advisorPrompts} />
          </div>
        </div>

        {results && monte && (
          <>
            <MonteCarloPanel inputs={inputs} monte={monte} />
            <SequencingPanel results={results} inputs={inputs} />
            <BreakdownTables results={results} inputs={inputs} />
            <AdditionalAnalysis inputs={inputs} results={results} />
          </>
        )}
      </section>
    </main>
  )
}

function Section({ title, right, children }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white text-lg font-semibold">{title}</h2>
        {right}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function NumberField({ label, value, min, max, step, onChange }) {
  return (
    <label className="block text-sm text-slate-300">
      <span className="block mb-1">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step || 1}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
      />
    </label>
  )
}

function MoneyField({ label, value, onChange }) {
  return (
    <label className="block text-sm text-slate-300">
      <span className="block mb-1">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={value ? fmt(value) : ''}
        onChange={(e) => onChange(parseMoney(e.target.value))}
        placeholder="$0"
        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
      />
    </label>
  )
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer text-sm text-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <span className="relative inline-flex h-6 w-11 items-center rounded-full bg-slate-700 peer-checked:bg-blue-500 transition-colors">
        <span className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform translate-x-1 peer-checked:translate-x-6" />
      </span>
      <span>{label}</span>
    </label>
  )
}

function ResultsPanel({
  inputs,
  results,
  monte,
  totals,
  validInputs,
  retirementBalanceDisplay,
  finalBalanceDisplay,
  onToggleFutureDollars,
  onSave,
  onDownload,
  saveState,
}) {
  if (!validInputs) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-2xl p-6 text-slate-300">
        <h3 className="text-white text-lg font-semibold mb-2">Ready to calculate</h3>
        <p className="text-slate-400 text-sm">
          Add at least one account and confirm retirement age is greater than current age.
        </p>
      </div>
    )
  }

  const isOnTrack = results.runOutAge === null
  const probability = monte?.probability ?? 0
  const probPct = Math.round(probability * 100)
  const probColor =
    probability >= 0.85 ? 'text-emerald-300' : probability >= 0.7 ? 'text-amber-300' : 'text-rose-300'

  return (
    <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-2xl p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className="text-slate-400 text-sm">Monte Carlo probability of success</p>
          <p className={`text-6xl font-bold ${probColor}`}>{probPct}%</p>
          <p className="text-slate-400 text-xs mt-1">Based on 1,000 randomized simulations</p>
        </div>
        <div
          className={`px-3 py-1 rounded-full text-sm font-medium ${
            isOnTrack ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
          }`}
        >
          {isOnTrack ? 'On track' : `Runs out at ${results.runOutAge}`}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-slate-900 rounded-xl p-4">
          <p className="text-slate-400 text-xs uppercase tracking-wide">At retirement</p>
          <p className="text-white text-2xl font-bold">{fmt(retirementBalanceDisplay)}</p>
          <p className="text-slate-500 text-xs">
            ({inputs.showFutureDollars ? 'future' : "today's"} $)
          </p>
        </div>
        <div className="bg-slate-900 rounded-xl p-4">
          <p className="text-slate-400 text-xs uppercase tracking-wide">At age {inputs.lifeExpectancy}</p>
          <p className="text-white text-2xl font-bold">{fmt(finalBalanceDisplay)}</p>
          <p className="text-slate-500 text-xs">
            ({inputs.showFutureDollars ? 'future' : "today's"} $)
          </p>
        </div>
      </div>

      <div className="mb-4">
        <p className="text-slate-400 text-xs uppercase tracking-wide mb-2">Current net worth</p>
        <p className="text-white text-xl font-semibold">{fmt(totals.netWorth)}</p>
        <p className="text-slate-500 text-xs">
          Investable {fmt(totals.investable)} · Real estate {fmt(totals.byBucket.real_estate)}
        </p>
      </div>

      <Toggle
        label="Show all results in future dollars"
        checked={inputs.showFutureDollars}
        onChange={onToggleFutureDollars}
      />

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          onClick={onSave}
          disabled={saveState.status === 'saving'}
          className="bg-blue-500 hover:bg-blue-400 disabled:bg-blue-900 text-white font-medium px-4 py-2 rounded-lg"
        >
          {saveState.status === 'saving'
            ? 'Saving…'
            : saveState.status === 'saved'
              ? 'Saved ✓'
              : 'Save your plan'}
        </button>
        <button
          onClick={onDownload}
          className="bg-slate-700 hover:bg-slate-600 text-white font-medium px-4 py-2 rounded-lg"
        >
          Download PDF
        </button>
      </div>
      {saveState.status === 'error' && (
        <p className="mt-2 text-rose-300 text-sm">{saveState.message}</p>
      )}
    </div>
  )
}

function AdvisorPrompts({ prompts }) {
  if (!prompts || prompts.length === 0) return null
  return (
    <div className="space-y-3">
      {prompts.map((p) => (
        <div
          key={p.id}
          className="bg-blue-950/40 border border-blue-500/40 rounded-xl p-4 flex flex-col gap-3"
        >
          <div>
            <p className="text-blue-200 text-xs uppercase tracking-wide font-semibold">
              {p.title}
            </p>
            <p className="text-slate-100 text-sm mt-1">{p.message}</p>
          </div>
          <button
            type="button"
            className="self-start bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
          >
            Talk to an advisor
          </button>
        </div>
      ))}
    </div>
  )
}

function MonteCarloPanel({ inputs, monte }) {
  const max = Math.max(monte.p25, monte.p50, monte.p75, 1)
  const infl = inputs.inflationRate / 100
  const years = inputs.lifeExpectancy - inputs.currentAge
  const disp = (v) => (inputs.showFutureDollars ? v : v / Math.pow(1 + infl, years))
  const bars = [
    { label: '25th percentile', value: disp(monte.p25), color: 'bg-rose-500' },
    { label: 'Median', value: disp(monte.p50), color: 'bg-blue-500' },
    { label: '75th percentile', value: disp(monte.p75), color: 'bg-emerald-500' },
  ]
  const dispMax = Math.max(...bars.map((b) => b.value), 1)
  return (
    <div className="mt-10 bg-slate-800 border border-slate-700 rounded-2xl p-6">
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-4">
        <div>
          <h3 className="text-white text-xl font-semibold">Monte Carlo outcomes</h3>
          <p className="text-slate-400 text-sm">
            Portfolio value at age {inputs.lifeExpectancy} across {monte.runs} simulations (
            {inputs.showFutureDollars ? 'future' : "today's"} dollars)
          </p>
        </div>
      </div>
      <div className="space-y-4">
        {bars.map((b) => (
          <div key={b.label}>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-300">{b.label}</span>
              <span className="text-white font-semibold">{fmt(b.value)}</span>
            </div>
            <div className="h-3 bg-slate-900 rounded-full overflow-hidden">
              <div
                className={`h-full ${b.color}`}
                style={{ width: `${Math.max(3, (b.value / dispMax) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SequencingPanel({ results, inputs }) {
  const totalsBySource = { brokerage: 0, cash: 0, pretax: 0, roth: 0 }
  for (const row of results.postData) {
    for (const s of row.seq) totalsBySource[s.from] = (totalsBySource[s.from] || 0) + s.amount
  }
  const total = Object.values(totalsBySource).reduce((a, b) => a + b, 0) || 1
  const infl = inputs.inflationRate / 100
  const ytr = inputs.retirementAge - inputs.currentAge
  const disp = (v) => (inputs.showFutureDollars ? v : v / Math.pow(1 + infl, ytr))

  const anyRMD = results.postData.some((r) => r.withinRMD && r.seq.some((s) => s.note === 'RMD'))

  return (
    <div className="mt-8 bg-slate-800 border border-slate-700 rounded-2xl p-6">
      <h3 className="text-white text-xl font-semibold mb-2">Withdrawal sequencing</h3>
      <p className="text-slate-400 text-sm mb-4">
        Withdrawals are automatically sequenced: taxable brokerage first, then cash above a
        1-year expense floor, then pre-tax (401(k), Traditional IRA), finally Roth.
        {anyRMD && ' Pre-tax draws are accelerated in the 5 years leading up to RMD age 73.'}
        Real estate is excluded from retirement projections.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {[
          { key: 'brokerage', label: '1. Taxable brokerage' },
          { key: 'cash', label: '2. Cash (above 1yr floor)' },
          { key: 'pretax', label: '3. Pre-tax (401k/IRA)' },
          { key: 'roth', label: '4. Roth last' },
        ].map((item) => {
          const amt = totalsBySource[item.key] || 0
          const pct = (amt / total) * 100
          return (
            <div key={item.key} className="bg-slate-900 rounded-xl p-4">
              <p className="text-slate-400 text-xs uppercase">{item.label}</p>
              <p className="text-white text-xl font-bold mt-1">{fmt(disp(amt))}</p>
              <p className="text-slate-500 text-xs mt-1">{pct.toFixed(0)}% of total</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BreakdownTables({ results, inputs }) {
  const infl = inputs.inflationRate / 100
  const disp = (v, yearsFromToday) =>
    inputs.showFutureDollars ? v : v / Math.pow(1 + infl, yearsFromToday)

  return (
    <div className="mt-8 space-y-8">
      <div>
        <h3 className="text-white text-xl font-semibold mb-3">
          Pre-retirement ({inputs.showFutureDollars ? 'future' : "today's"} dollars)
        </h3>
        <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Age</th>
                <th className="px-4 py-3 text-right">Contributions</th>
                <th className="px-4 py-3 text-right">Growth</th>
                <th className="px-4 py-3 text-right">Major expense</th>
                <th className="px-4 py-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {results.preData.map((r) => {
                const ytd = r.age - inputs.currentAge
                return (
                  <tr key={r.age} className="border-t border-slate-700 text-slate-200">
                    <td className="px-4 py-2">{r.age}</td>
                    <td className="px-4 py-2 text-right">{fmt(disp(r.contributions, ytd))}</td>
                    <td className="px-4 py-2 text-right">{fmt(disp(r.growth, ytd))}</td>
                    <td className="px-4 py-2 text-right">{fmt(disp(r.majorExpense, ytd))}</td>
                    <td className="px-4 py-2 text-right font-semibold text-white">
                      {fmt(disp(r.balance, ytd))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="text-white text-xl font-semibold mb-3">
          Post-retirement ({inputs.showFutureDollars ? 'future' : "today's"} dollars)
        </h3>
        <div className="bg-slate-800 border border-slate-700 rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Age</th>
                <th className="px-4 py-3 text-right">Spend</th>
                <th className="px-4 py-3 text-right">Social Security</th>
                <th className="px-4 py-3 text-right">Other income</th>
                <th className="px-4 py-3 text-right">Growth</th>
                <th className="px-4 py-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {results.postData.map((r) => {
                const ytd = r.age - inputs.currentAge
                return (
                  <tr key={r.age} className="border-t border-slate-700 text-slate-200">
                    <td className="px-4 py-2">
                      {r.age}
                      {r.withinRMD && r.seq.some((s) => s.note === 'RMD') && (
                        <span className="ml-2 text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">
                          RMD
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">{fmt(disp(r.withdrawalGross, ytd))}</td>
                    <td className="px-4 py-2 text-right">{fmt(disp(r.ssIncome, ytd))}</td>
                    <td className="px-4 py-2 text-right">{fmt(disp(r.otherIncome, ytd))}</td>
                    <td className="px-4 py-2 text-right">{fmt(disp(r.growth, ytd))}</td>
                    <td className="px-4 py-2 text-right font-semibold text-white">
                      {fmt(disp(r.balance, ytd))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function AdditionalAnalysis({ inputs, results }) {
  const infl = inputs.inflationRate / 100
  const ytr = inputs.retirementAge - inputs.currentAge
  const disp = (v) => (inputs.showFutureDollars ? v : v / Math.pow(1 + infl, ytr))

  const fourPct = results.retirementBalance * 0.04
  const years = inputs.lifeExpectancy - inputs.retirementAge
  const spendItAll =
    years > 0
      ? (results.retirementBalance * Math.pow(1 + inputs.postRetirementReturn / 100, years)) / years
      : 0

  return (
    <div className="mt-8 bg-slate-800 border border-slate-700 rounded-2xl p-6 space-y-4">
      <div>
        <h3 className="text-white text-xl font-semibold mb-2">4% rule analysis</h3>
        <p className="text-slate-300 text-sm">
          Applying the 4% rule to your retirement balance, you could safely withdraw{' '}
          <strong className="text-white">{fmt(disp(fourPct))}</strong> per year starting at age{' '}
          {inputs.retirementAge} and increase with inflation. Historically this approach
          succeeds 95-98% of the time over 30 years.
        </p>
      </div>
      <div>
        <h3 className="text-white text-xl font-semibold mb-2">Spend-it-all estimate</h3>
        <p className="text-slate-300 text-sm">
          If your goal is to exhaust the portfolio by age {inputs.lifeExpectancy}, a rough
          estimate is <strong className="text-white">{fmt(disp(spendItAll))}</strong> per year
          (ignoring Social Security and other income). Use this as an upper-bound spending
          reference only.
        </p>
      </div>
    </div>
  )
}
