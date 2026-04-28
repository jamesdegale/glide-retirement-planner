'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Script from 'next/script'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  ComposedChart,
  Bar,
  Line,
  Legend,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'

const ACCOUNT_TYPES = [
  { value: '401k', label: '401(k) / 403(b)', bucket: 'pretax' },
  { value: 'traditional_ira', label: 'Traditional IRA', bucket: 'pretax' },
  { value: 'roth_ira', label: 'Roth IRA', bucket: 'roth' },
  { value: 'brokerage', label: 'Brokerage', bucket: 'brokerage' },
  { value: 'cash', label: 'Cash / Savings', bucket: 'cash' },
  { value: 'other_investment', label: 'Other investments', bucket: 'brokerage' },
]
const LEGACY_ACCOUNT_TYPES = [
  { value: 'real_estate', label: 'Real Estate', bucket: 'real_estate' },
]
const TYPE_META = Object.fromEntries([...ACCOUNT_TYPES, ...LEGACY_ACCOUNT_TYPES].map((t) => [t.value, t]))
const OWNERS = [
  { value: 'self', label: 'You' },
  { value: 'spouse', label: 'Spouse' },
  { value: 'joint', label: 'Joint' },
]

function ageFromBirthDate(birthDate) {
  if (!birthDate) return 0
  const bd = new Date(birthDate)
  const now = new Date()
  let age = now.getFullYear() - bd.getFullYear()
  const m = now.getMonth() - bd.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < bd.getDate())) age--
  return age
}

function migrateInputs(raw) {
  const m = { ...raw }
  if (!m.birthDate && m.currentAge) {
    m.birthDate = `${new Date().getFullYear() - m.currentAge}-01-01`
  }
  if (!m.spouseBirthDate && m.spouseCurrentAge) {
    m.spouseBirthDate = `${new Date().getFullYear() - m.spouseCurrentAge}-01-01`
  }
  const hasLegacyIncome = m.annualHouseholdIncome != null && m.userAnnualIncome == null
  if (hasLegacyIncome) {
    const hhi = m.annualHouseholdIncome || 0
    if (m.spouseEnabled) {
      m.userAnnualIncome = Math.round(hhi * 0.6)
      m.spouseAnnualIncome = Math.round(hhi * 0.4)
    } else {
      m.userAnnualIncome = hhi
      m.spouseAnnualIncome = 0
    }
  }
  const hasLegacySavings = m.monthlySavings != null && m.userMonthlySavings == null
  if (hasLegacySavings) {
    const ms = m.monthlySavings || 0
    if (m.spouseEnabled) {
      m.userMonthlySavings = Math.round(ms * 0.6)
      m.spouseMonthlySavings = Math.round(ms * 0.4)
    } else {
      m.userMonthlySavings = ms
      m.spouseMonthlySavings = 0
    }
  }
  delete m.annualHouseholdIncome
  delete m.monthlySavings
  delete m.currentAge
  delete m.spouseCurrentAge
  const pensions = (m.accounts || []).filter((a) => a.type === 'pension')
  if (pensions.length > 0) {
    const converted = pensions.map((p) => ({
      id: crypto.randomUUID(),
      description: p.name || 'Pension',
      amount: Math.round((p.balance * 0.05) / 12),
      startAge: m.retirementAge || 65,
      endAge: m.lifeExpectancy || 90,
      dollarType: 'today',
      inflationAdjust: false,
    }))
    m.incomeSources = [...(m.incomeSources || []), ...converted]
    m.accounts = (m.accounts || []).filter((a) => a.type !== 'pension')
  }
  m.accounts = (m.accounts || []).map((a) => ({
    ...a,
    linkedAccount: a.linkedAccount || null,
  }))
  return m
}

const DEFAULT_INPUTS = {
  birthDate: '', lifeExpectancy: 90, retirementAge: 65, retirementIncomeNeeded: 80000,
  userAnnualIncome: 0, userMonthlySavings: 0,
  spouseAnnualIncome: 0, spouseMonthlySavings: 0,
  increaseSavings: false, savingsIncreaseRate: 2,
  socialSecurityAmount: 2000, socialSecurityAge: 67,
  spouseEnabled: false, spouseBirthDate: '', spouseRetirementAge: 65, spouseSSAmount: 0, spouseSSAge: 67,
  preRetirementReturn: 9, postRetirementReturn: 6, inflationRate: 2.5, retirementBalanceGoal: 0,
  stateTaxRate: 0,
  expectLumpSum: false, lumpSumAmount: 0, lumpSumAge: 65,
  incomeSources: [], majorExpenses: [], accounts: [], showFutureDollars: false,
}

function estimateSSBenefit(annualIncome) {
  if (!annualIncome || annualIncome < 30000) return 0
  const monthlyIncome = annualIncome / 12
  if (monthlyIncome <= 1174) return Math.round(monthlyIncome * 0.9)
  if (monthlyIncome <= 7078) return Math.round(1174 * 0.9 + (monthlyIncome - 1174) * 0.32)
  return Math.round(1174 * 0.9 + (7078 - 1174) * 0.32 + (Math.min(monthlyIncome, 14500) - 7078) * 0.15)
}

const FIELD_HELP = {
  userMonthlySavings: 'Includes 401(k) contributions, IRA contributions, and any taxable investing.',
  spouseMonthlySavings: "Includes 401(k) contributions, IRA contributions, and any taxable investing. Enter $0 if your spouse doesn't have a dedicated savings vehicle.",
  retirementIncomeNeeded: "Gross pre-tax income you'll need annually in retirement, in today's dollars. A common rule of thumb is 70–80% of what you currently earn. Taxes are modeled separately and will appear in your plan results.",
}

function SSHelper({ annualIncome, currentAge, isSpouse }) {
  const est = estimateSSBenefit(annualIncome || 0)
  const showEstimate = (annualIncome || 0) > 0 && currentAge > 0 && est > 0
  return (
    <p className="text-xs text-slate-500 leading-relaxed mt-1">
      {isSpouse ? 'Visit ssa.gov/myaccount for a personalized estimate.' : "Don't know your estimate? Visit ssa.gov/myaccount for a personalized number."}
      {showEstimate && (isSpouse
        ? <> Based on {fmt(annualIncome)} of annual income, a rough estimate would be around {fmt(est)}/month at age 67.</>
        : <> As a rough estimate, someone currently earning {fmt(annualIncome)} at age {currentAge} might expect around {fmt(est)}/month at age 67.</>
      )}
      {' '}This estimate assumes roughly 30 years of work at similar earnings. Your actual benefit depends on your full earnings history.
    </p>
  )
}

function HelperText({ children }) {
  return <p className="text-xs text-slate-500 leading-relaxed mt-1">{children}</p>
}

function timeAgo(isoString) {
  if (!isoString) return 'never'
  const t = new Date(isoString).getTime()
  if (!isFinite(t)) return 'never'
  const diff = Date.now() - t
  if (diff < 0) return 'just now'
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) === 1 ? '' : 's'} ago`
  if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) === 1 ? '' : 's'} ago`
  return `${Math.floor(days / 365)} year${Math.floor(days / 365) === 1 ? '' : 's'} ago`
}

function calcTypeToManualMeta(type) {
  switch (type) {
    case '401k': return { account_type: '401k', subtype: '401k', category: 'retirement' }
    case 'traditional_ira': return { account_type: 'ira', subtype: 'ira', category: 'retirement' }
    case 'roth_ira': return { account_type: 'roth_ira', subtype: 'roth_ira', category: 'retirement' }
    case 'brokerage': return { account_type: 'brokerage', subtype: 'brokerage', category: 'investment' }
    case 'cash': return { account_type: 'savings', subtype: 'savings', category: 'banking' }
    case 'other_investment': return { account_type: 'other', subtype: 'other_investment', category: 'investment' }
    default: return { account_type: 'other', subtype: 'other', category: 'other' }
  }
}

const FIELD_TOOLTIPS = {
  retirementAge: 'The age you plan to stop working full-time. This is when your primary income stops and portfolio withdrawals begin.',
  spouseRetirementAge: 'The age your spouse plans to stop working full-time.',
  lifeExpectancy: 'Plan for longer than you expect. Current life expectancy at 65 is roughly 85 for men and 88 for women, but half of people live beyond that. Planning to 90–95 provides a safety margin.',
  retirementIncomeNeeded: "What you'll need to spend each year in retirement, in today's dollars. A common rule of thumb is 70–80% of your pre-retirement income, since you won't be saving, commuting, or paying FICA. Adjust based on your planned lifestyle.",
  userAnnualIncome: "Your current annual income in today's dollars. Used to project earned income during working years.",
  spouseAnnualIncome: "Your spouse's current annual income in today's dollars.",
  userMonthlySavings: "What you currently save each month in today's dollars. This includes 401(k) contributions, IRA contributions, and any taxable investing.",
  spouseMonthlySavings: "Your spouse's monthly savings in today's dollars. Enter $0 if your spouse doesn't have a dedicated savings vehicle.",
  increaseSavings: 'Raises your monthly savings by the specified percentage each year, modeling typical career earnings growth.',
  socialSecurityAmount: "Your estimated monthly benefit in today's dollars. Get your estimate from ssa.gov/myaccount. Benefits grow with inflation each year automatically.",
  socialSecurityAge: 'Claiming at 62 reduces benefits permanently. Claiming at full retirement age (67) provides your full benefit. Delaying to 70 increases benefits by about 8% per year. Timing matters — a lot.',
  spouseSSAmount: "Your spouse's estimated monthly benefit in today's dollars. Get an estimate from ssa.gov/myaccount.",
  spouseSSAge: 'Each spouse can claim independently. Delaying increases benefits by about 8% per year up to age 70.',
  preRetirementReturn: 'Your expected annual portfolio return before retirement. Historical stock market average is about 7% real (10% nominal). A diversified portfolio of stocks and bonds typically returns 5–8% over long periods. Higher assumptions are optimistic.',
  postRetirementReturn: 'Your expected annual return during retirement. Usually lower than pre-retirement because portfolios get more conservative (more bonds, less stocks) to reduce volatility. Typical range is 4–6%.',
  inflationRate: 'Historical average is about 2.5–3%. The Fed targets 2%. Recent years have seen higher inflation — using a slightly higher rate (2.5–3%) builds in a safety margin.',
  retirementBalanceGoal: "The portion of your retirement-age balance you want remaining at life expectancy, as a percentage. Set to 0 if you don't have a specific target. Set to 100 if you want to preserve your full retirement principal (e.g., for inheritance). Set to 50 if you're comfortable drawing down half over your lifetime.",
  stateTaxRate: 'Your effective state income tax rate in retirement. Many retirees pay 0% (Florida, Texas, Tennessee, Nevada, Washington, Wyoming, South Dakota, New Hampshire, Alaska). Typical state tax rates range from 3–6%. California, New York, New Jersey, and a few others run higher.',
  incomeSourceDescription: "A short name for this income source (e.g., 'Teacher's pension', 'Rental income', 'Part-time consulting').",
  incomeSourceAmount: 'The amount paid to you each month. For pensions and annuities, use the stated benefit. For rental income, use expected net monthly income after expenses.',
  incomeSourceStartAge: 'The age when this income begins. For a pension, this is usually your retirement age or a specific age specified in the plan.',
  incomeSourceEndAge: 'The age when this income ends. Most pensions continue for life — set this to your life expectancy. Some income sources like part-time work may end earlier.',
  incomeSourceDollarType: "Today's dollars means the amount will be inflated by the time it starts. Start-age dollars means the amount as stated at the time it begins — no inflation adjustment beforehand. Use 'Start-age' when your pension statement gives you a specific benefit amount.",
  incomeSourceInflationAdjust: "Most pensions don't have cost-of-living adjustments. Social Security does. If unsure, check your pension documents — the difference over 30 years is significant.",
}

function makeDemoInputs() {
  return {
    ...DEFAULT_INPUTS,
    birthDate: '1969-06-15',
    spouseEnabled: true,
    spouseBirthDate: '1971-03-22',
    retirementAge: 65,
    spouseRetirementAge: 62,
    lifeExpectancy: 90,
    retirementIncomeNeeded: 110000,
    userAnnualIncome: 160000,
    userMonthlySavings: 2000,
    spouseAnnualIncome: 80000,
    spouseMonthlySavings: 500,
    socialSecurityAmount: 2800,
    socialSecurityAge: 67,
    spouseSSAmount: 1900,
    spouseSSAge: 67,
    preRetirementReturn: 7,
    postRetirementReturn: 5,
    inflationRate: 2.5,
    stateTaxRate: 0,
    accounts: [
      { id: 'demo-401k', name: 'Fidelity 401(k)', type: '401k', owner: 'self', balance: 425000 },
      { id: 'demo-roth', name: 'Vanguard Roth IRA', type: 'roth_ira', owner: 'self', balance: 85000 },
      { id: 'demo-trad', name: 'Spouse Traditional IRA', type: 'traditional_ira', owner: 'spouse', balance: 210000 },
      { id: 'demo-brok', name: 'Schwab Brokerage', type: 'brokerage', owner: 'joint', balance: 195000 },
      { id: 'demo-cash', name: 'Chase Savings', type: 'cash', owner: 'joint', balance: 45000 },
    ],
    incomeSources: [],
    majorExpenses: [],
  }
}

function fmt(v) {
  if (v == null || !isFinite(v)) return '$0'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.round(v))
}
function fmtCompact(v) {
  if (v == null || !isFinite(v)) return '$0'
  const abs = Math.abs(v)
  if (abs >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M'
  if (abs >= 1e3) return '$' + Math.round(v / 1e3) + 'k'
  return fmt(v)
}
function parseMoney(v) {
  if (typeof v === 'number') return v
  if (!v) return 0
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''))
  return isNaN(n) ? 0 : n
}
function randNormal() {
  let u = 0, v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
function bucketKey(type) { return TYPE_META[type]?.bucket || 'brokerage' }
function aggregateBuckets(accounts) {
  const b = { cash: 0, brokerage: 0, pretax: 0, roth: 0, real_estate: 0 }
  for (const a of accounts) b[bucketKey(a.type)] = (b[bucketKey(a.type)] || 0) + Number(a.balance || 0)
  return b
}
function sumInvestable(b) { return b.cash + b.brokerage + b.pretax + b.roth }

function withdrawFromBuckets(buckets, needed, yearlySpend, withinRMD) {
  const floor = yearlySpend; let rem = needed; const seq = []
  if (withinRMD && buckets.pretax > 0 && rem > 0) { const t = Math.min(buckets.pretax * 0.04, rem); buckets.pretax -= t; rem -= t; seq.push({ from: 'pretax', amount: t, note: 'RMD' }) }
  if (rem > 0 && buckets.brokerage > 0) { const t = Math.min(buckets.brokerage, rem); buckets.brokerage -= t; rem -= t; seq.push({ from: 'brokerage', amount: t }) }
  if (rem > 0 && buckets.cash > floor) { const t = Math.min(buckets.cash - floor, rem); buckets.cash -= t; rem -= t; seq.push({ from: 'cash', amount: t }) }
  if (rem > 0 && buckets.pretax > 0) { const t = Math.min(buckets.pretax, rem); buckets.pretax -= t; rem -= t; seq.push({ from: 'pretax', amount: t }) }
  if (rem > 0 && buckets.roth > 0) { const t = Math.min(buckets.roth, rem); buckets.roth -= t; rem -= t; seq.push({ from: 'roth', amount: t }) }
  if (rem > 0 && buckets.cash > 0) { const t = Math.min(buckets.cash, rem); buckets.cash -= t; rem -= t; seq.push({ from: 'cash', amount: t, note: 'below floor' }) }
  return { shortfall: rem, seq }
}
function growAccumulation(buckets, ret, contributions) {
  const inv = sumInvestable(buckets)
  if (inv > 0) { const g = 1 + ret; buckets.cash *= g; buckets.brokerage *= g; buckets.pretax *= g; buckets.roth *= g }
  if (contributions > 0) {
    if (buckets.pretax > 0 || inv === 0) buckets.pretax += contributions
    else if (buckets.brokerage > 0) buckets.brokerage += contributions
    else if (buckets.roth > 0) buckets.roth += contributions
    else buckets.cash += contributions
  }
}
function additionalIncome(age, sources, curAge, infl) {
  let t = 0
  for (const s of sources) {
    if (age >= s.startAge && age <= s.endAge) {
      let b = s.amount * 12
      if (s.dollarType === 'today') b *= Math.pow(1 + infl, s.startAge - curAge)
      const y = age - s.startAge
      if (s.inflationAdjust && y > 0) b *= Math.pow(1 + infl, y)
      t += b
    }
  }
  return t
}
function additionalIncomeBreakdown(age, sources, curAge, infl) {
  const items = []
  let total = 0
  for (const s of sources) {
    if (age >= s.startAge && age <= s.endAge) {
      let b = s.amount * 12
      if (s.dollarType === 'today') b *= Math.pow(1 + infl, s.startAge - curAge)
      const y = age - s.startAge
      if (s.inflationAdjust && y > 0) b *= Math.pow(1 + infl, y)
      items.push({ id: s.id, description: s.description || 'Income', amount: b })
      total += b
    }
  }
  return { total, items }
}
function majorExpAt(age, expenses, curAge, infl) {
  let t = 0
  for (const e of expenses) { if (e.age === age) { let a = e.amount; if (e.dollarType === 'today') a *= Math.pow(1 + infl, age - curAge); t += a } }
  return t
}

// ─── TAXES ────────────────────────────────────────────────────
// 2026 federal income tax brackets — approximate; simplified flat-rate state modeling.
const FEDERAL_BRACKETS_MFJ_2026 = [
  { upTo: 23850, rate: 0.10 },
  { upTo: 96950, rate: 0.12 },
  { upTo: 206700, rate: 0.22 },
  { upTo: 394600, rate: 0.24 },
  { upTo: 501050, rate: 0.32 },
  { upTo: 751600, rate: 0.35 },
  { upTo: Infinity, rate: 0.37 },
]
const FEDERAL_BRACKETS_SINGLE_2026 = [
  { upTo: 11925, rate: 0.10 },
  { upTo: 48475, rate: 0.12 },
  { upTo: 103350, rate: 0.22 },
  { upTo: 197300, rate: 0.24 },
  { upTo: 250525, rate: 0.32 },
  { upTo: 626350, rate: 0.35 },
  { upTo: Infinity, rate: 0.37 },
]
const LTCG_BRACKETS_MFJ_2026 = [
  { upTo: 96700, rate: 0.00 },
  { upTo: 600050, rate: 0.15 },
  { upTo: Infinity, rate: 0.20 },
]
const LTCG_BRACKETS_SINGLE_2026 = [
  { upTo: 48350, rate: 0.00 },
  { upTo: 533400, rate: 0.15 },
  { upTo: Infinity, rate: 0.20 },
]
const STANDARD_DEDUCTION_MFJ_2026 = 30000
const STANDARD_DEDUCTION_SINGLE_2026 = 15000

function taxOnBrackets(amount, brackets) {
  if (amount <= 0) return 0
  let tax = 0, prev = 0
  for (const b of brackets) {
    if (amount <= prev) break
    const taxableInBracket = Math.min(amount, b.upTo) - prev
    if (taxableInBracket > 0) tax += taxableInBracket * b.rate
    prev = b.upTo
  }
  return tax
}

function taxableSocialSecurity(ssGross, otherOrdinaryIncome, filingMFJ) {
  if (ssGross <= 0) return 0
  const base1 = filingMFJ ? 32000 : 25000
  const base2 = filingMFJ ? 44000 : 34000
  const provisional = otherOrdinaryIncome + (ssGross * 0.5)
  if (provisional <= base1) return 0
  if (provisional <= base2) return Math.min(ssGross * 0.5, (provisional - base1) * 0.5)
  const tier1 = Math.min(ssGross * 0.5, (base2 - base1) * 0.5)
  const tier2 = Math.max(0, (provisional - base2) * 0.85)
  return Math.min(ssGross * 0.85, tier1 + tier2)
}

function computeTaxes({ pretaxWithdrawals = 0, rothWithdrawals = 0, taxableWithdrawals = 0, cashWithdrawals = 0, socialSecurity = 0, otherIncomeOrdinary = 0, earnedIncome = 0, spouseEnabled = false, stateTaxRate = 0 }) {
  const filingMFJ = !!spouseEnabled
  const stdDeduction = filingMFJ ? STANDARD_DEDUCTION_MFJ_2026 : STANDARD_DEDUCTION_SINGLE_2026
  const fedOrdinaryBrackets = filingMFJ ? FEDERAL_BRACKETS_MFJ_2026 : FEDERAL_BRACKETS_SINGLE_2026
  const fedLTCGBrackets = filingMFJ ? LTCG_BRACKETS_MFJ_2026 : LTCG_BRACKETS_SINGLE_2026

  const otherOrdinary = pretaxWithdrawals + otherIncomeOrdinary + earnedIncome
  const taxableSS = taxableSocialSecurity(socialSecurity, otherOrdinary, filingMFJ)
  const totalOrdinary = otherOrdinary + taxableSS
  const ordinaryAfterDeduction = Math.max(0, totalOrdinary - stdDeduction)
  const federalOrdinary = taxOnBrackets(ordinaryAfterDeduction, fedOrdinaryBrackets)

  const ltcgStart = ordinaryAfterDeduction
  const ltcgEnd = ltcgStart + Math.max(0, taxableWithdrawals)
  const federalLTCG = Math.max(0, taxOnBrackets(ltcgEnd, fedLTCGBrackets) - taxOnBrackets(ltcgStart, fedLTCGBrackets))

  const stateTaxableIncome = otherOrdinary + Math.max(0, taxableWithdrawals) + socialSecurity
  const stateTax = stateTaxableIncome * (stateTaxRate || 0)

  const federalTotal = federalOrdinary + federalLTCG
  const total = federalTotal + stateTax
  const grossIncome = otherOrdinary + Math.max(0, taxableWithdrawals) + socialSecurity + rothWithdrawals + cashWithdrawals
  const effectiveRate = grossIncome > 0 ? total / grossIncome : 0

  return { federalOrdinary, federalLTCG, federal: federalTotal, state: stateTax, total, taxableSocialSecurity: taxableSS, effectiveRate }
}

function runProjection(i, opts = {}) {
  const currentAge = ageFromBirthDate(i.birthDate)
  const spouseCurrentAge = ageFromBirthDate(i.spouseBirthDate)
  const { lifeExpectancy, retirementAge, retirementIncomeNeeded, increaseSavings,
    socialSecurityAmount, socialSecurityAge, spouseEnabled, spouseSSAmount, spouseSSAge,
    spouseRetirementAge,
    userAnnualIncome, userMonthlySavings, spouseAnnualIncome, spouseMonthlySavings,
    expectLumpSum, lumpSumAmount, lumpSumAge, incomeSources, majorExpenses, accounts } = i
  const preRet = (i.preRetirementReturn || 0) / 100, postRet = (i.postRetirementReturn || 0) / 100
  const infl = (i.inflationRate || 0) / 100, ssInc = (i.savingsIncreaseRate || 0) / 100
  const stochastic = opts.stochastic || false, sigma = opts.sigma || 0.12
  const uInc = userAnnualIncome || 0
  const sInc = spouseEnabled ? (spouseAnnualIncome || 0) : 0
  const uSav = userMonthlySavings || 0
  const sSav = spouseEnabled ? (spouseMonthlySavings || 0) : 0

  let buckets = aggregateBuckets(accounts)
  const preData = [], ytr = retirementAge - currentAge
  preData.push({ age: currentAge, contributions: 0, growth: 0, majorExpense: 0, balance: sumInvestable(buckets) + buckets.real_estate, investable: sumInvestable(buckets), earnedIncome: uInc + sInc, earnedIncomeByPerson: { self: uInc, spouse: sInc }, bucketBalances: { pretax: buckets.pretax, roth: buckets.roth, brokerage: buckets.brokerage, cash: buckets.cash } })

  for (let y = 1; y <= ytr; y++) {
    const age = currentAge + y
    const spAge = spouseEnabled ? spouseCurrentAge + y : 0
    const userStillEarning = age < retirementAge
    const spouseStillEarning = spouseEnabled && spAge < (spouseRetirementAge || retirementAge)
    let c = 0
    if (userStillEarning) c += uSav * 12
    if (spouseStillEarning) c += sSav * 12
    if (increaseSavings) c *= Math.pow(1 + ssInc, y - 1)
    const r = stochastic ? preRet + sigma * randNormal() : preRet
    const before = sumInvestable(buckets); growAccumulation(buckets, r, c)
    const after = sumInvestable(buckets), growth = after - before - c
    let me = majorExpAt(age, majorExpenses, currentAge, infl)
    if (me > 0) { let rem = me; for (const b of ['cash', 'brokerage', 'pretax', 'roth']) { if (rem <= 0) break; const t = Math.min(buckets[b], rem); buckets[b] -= t; rem -= t } }
    if (expectLumpSum && age === lumpSumAge && lumpSumAge <= retirementAge) buckets.brokerage += lumpSumAmount
    const inflFactor = Math.pow(1 + infl, y)
    const eiSelf = userStillEarning ? uInc * inflFactor : 0
    const eiSpouse = spouseStillEarning ? sInc * inflFactor : 0
    preData.push({ age, contributions: c, growth, majorExpense: me, balance: sumInvestable(buckets) + buckets.real_estate, investable: sumInvestable(buckets), earnedIncome: eiSelf + eiSpouse, earnedIncomeByPerson: { self: eiSelf, spouse: eiSpouse }, bucketBalances: { pretax: buckets.pretax, roth: buckets.roth, brokerage: buckets.brokerage, cash: buckets.cash } })
  }

  const postData = []
  const ssFSelf = socialSecurityAmount * 12 * Math.pow(1 + infl, ytr)
  const ssFSpouse = spouseEnabled ? spouseSSAmount * 12 * Math.pow(1 + infl, ytr) : 0
  let runOutAge = null

  const taxGrossUp = opts.taxGrossUp || 0
  const stateTaxRate = (i.stateTaxRate || 0) / 100

  for (let y = 1; y <= lifeExpectancy - retirementAge; y++) {
    const age = retirementAge + y, yfr = y, yft = ytr + y
    const needBase = retirementIncomeNeeded * Math.pow(1 + infl, yft)
    const need = stochastic && taxGrossUp > 0 ? needBase * (1 + taxGrossUp) : needBase
    const ssSelf = age >= socialSecurityAge ? ssFSelf * Math.pow(1 + infl, yfr) : 0
    const spAge = spouseEnabled ? spouseCurrentAge + (age - currentAge) : 0
    const ssSp = spouseEnabled && spAge >= spouseSSAge ? ssFSpouse * Math.pow(1 + infl, yfr) : 0
    const ss = ssSelf + ssSp
    const otherBd = additionalIncomeBreakdown(age, incomeSources, currentAge, infl)
    const other = otherBd.total
    if (expectLumpSum && age === lumpSumAge && lumpSumAge > retirementAge) buckets.brokerage += lumpSumAmount
    const me = majorExpAt(age, majorExpenses, currentAge, infl)
    const r = stochastic ? postRet + sigma * randNormal() : postRet
    const gf = 1 + r; buckets.cash *= gf; buckets.brokerage *= gf; buckets.pretax *= gf; buckets.roth *= gf
    const start = sumInvestable(buckets)
    const netNeed = Math.max(0, need - ss - other + me)
    const withinRMD = age >= 73 || (spouseEnabled && spAge >= 73)
    const w = withdrawFromBuckets(buckets, netNeed, need, withinRMD)
    const end = sumInvestable(buckets)

    let taxResult = { federalOrdinary: 0, federalLTCG: 0, federal: 0, state: 0, total: 0, effectiveRate: 0, taxableSocialSecurity: 0 }
    if (!stochastic) {
      const pretaxW = w.seq.filter((s) => s.from === 'pretax').reduce((sum, s) => sum + s.amount, 0)
      const rothW = w.seq.filter((s) => s.from === 'roth').reduce((sum, s) => sum + s.amount, 0)
      const taxableW = w.seq.filter((s) => s.from === 'brokerage').reduce((sum, s) => sum + s.amount, 0)
      const cashW = w.seq.filter((s) => s.from === 'cash').reduce((sum, s) => sum + s.amount, 0)
      taxResult = computeTaxes({
        pretaxWithdrawals: pretaxW,
        rothWithdrawals: rothW,
        taxableWithdrawals: taxableW,
        cashWithdrawals: cashW,
        socialSecurity: ss,
        otherIncomeOrdinary: other,
        earnedIncome: 0,
        spouseEnabled,
        stateTaxRate,
      })
    }

    if (end <= 0 && runOutAge === null && y < lifeExpectancy - retirementAge) runOutAge = age
    postData.push({
      age,
      withdrawal: netNeed,
      withdrawalGross: need,
      grossWithdrawal: netNeed,
      ssIncome: ss,
      ssIncomeSelf: ssSelf,
      ssIncomeSpouse: ssSp,
      otherIncome: other,
      otherIncomeBreakdown: otherBd.items,
      majorExpense: me,
      growth: start - (end + (netNeed - w.shortfall)),
      balance: end + buckets.real_estate,
      investable: end,
      seq: w.seq,
      shortfall: w.shortfall,
      withinRMD,
      earnedIncome: 0,
      taxes: taxResult.total,
      federalTax: taxResult.federal,
      stateTax: taxResult.state,
      effectiveTaxRate: taxResult.effectiveRate,
      netSpending: Math.max(0, need - taxResult.total),
      bucketBalances: { pretax: buckets.pretax, roth: buckets.roth, brokerage: buckets.brokerage, cash: buckets.cash },
    })
  }

  return { preData, postData, runOutAge, finalBalance: postData.length > 0 ? postData[postData.length - 1].investable : sumInvestable(buckets), retirementBalance: preData[preData.length - 1]?.investable || 0 }
}

function runMonteCarlo(inputs, runs = 1000) {
  const res = []; let ok = 0
  const deterministic = runProjection(inputs)
  const target = (deterministic.retirementBalance || 0) * (inputs.retirementBalanceGoal / 100)
  const post = deterministic.postData || []
  const avgEffRate = post.length > 0 ? post.reduce((a, r) => a + (r.effectiveTaxRate || 0), 0) / post.length : 0
  const taxGrossUp = avgEffRate > 0 ? avgEffRate / Math.max(0.0001, 1 - avgEffRate) : 0
  for (let i = 0; i < runs; i++) {
    const r = runProjection(inputs, { stochastic: true, sigma: 0.12, taxGrossUp })
    res.push(r.finalBalance)
    if (r.runOutAge === null && r.finalBalance >= target) ok++
  }
  res.sort((a, b) => a - b)
  const pick = (p) => res[Math.max(0, Math.min(res.length - 1, Math.floor(p * res.length)))]
  return { probability: ok / runs, p25: pick(0.25), p50: pick(0.5), p75: pick(0.75), runs }
}

function fmtSigned(v) {
  if (v == null || !isFinite(v) || Math.round(v) === 0) return '$0'
  if (v < 0) return '(' + fmt(Math.abs(v)) + ')'
  return fmt(v)
}

function buildCashFlowRows(results, inputs) {
  const currentAge = ageFromBirthDate(inputs.birthDate)
  const spouseCurrentAge = ageFromBirthDate(inputs.spouseBirthDate)
  const baseYear = new Date().getFullYear()
  const rows = []

  for (const r of results.preData) {
    const age = r.age
    const isRetirementYear = age === inputs.retirementAge
    rows.push({
      year: baseYear + (age - currentAge),
      age,
      spouseAge: inputs.spouseEnabled ? spouseCurrentAge + (age - currentAge) : null,
      incomeFlows: 0,
      plannedDistributions: 0,
      totalInflows: 0,
      totalExpenses: r.majorExpense,
      totalOutflows: r.majorExpense,
      netCashFlow: r.contributions,
      portfolioAssets: r.investable,
      phase: 'accumulation',
      isRetirementYear,
      withinRMD: false,
      shortfall: 0,
      earnedIncome: r.earnedIncome || 0,
      earnedIncomeSelf: r.earnedIncomeByPerson?.self || 0,
      earnedIncomeSpouse: r.earnedIncomeByPerson?.spouse || 0,
      ssIncomeSelf: 0,
      ssIncomeSpouse: 0,
      otherIncomeBreakdown: [],
      taxes: 0,
      federalTax: 0,
      stateTax: 0,
      effectiveTaxRate: 0,
      grossWithdrawal: 0,
      netSpending: 0,
      annualWithdrawal: 0,
      bucketBalances: r.bucketBalances || { pretax: 0, roth: 0, brokerage: 0, cash: 0 },
      withdrawalsByType: { brokerage: 0, cash: 0, pretax: 0, rmd: 0, roth: 0 },
    })
  }

  for (const r of results.postData) {
    const age = r.age
    const incomeFlows = r.ssIncome + r.otherIncome
    const plannedDistributions = r.seq
      .filter((s) => s.note === 'RMD')
      .reduce((sum, s) => sum + s.amount, 0)
    const totalInflows = incomeFlows + plannedDistributions
    const totalExpenses = r.withdrawalGross + r.majorExpense
    const totalOutflows = totalExpenses
    const netCashFlow = totalInflows - totalOutflows

    const withdrawalsByType = { brokerage: 0, cash: 0, pretax: 0, rmd: 0, roth: 0 }
    for (const s of r.seq || []) {
      if (s.from === 'brokerage') withdrawalsByType.brokerage += s.amount
      else if (s.from === 'cash') withdrawalsByType.cash += s.amount
      else if (s.from === 'pretax') {
        if (s.note === 'RMD') withdrawalsByType.rmd += s.amount
        else withdrawalsByType.pretax += s.amount
      } else if (s.from === 'roth') withdrawalsByType.roth += s.amount
    }

    rows.push({
      year: baseYear + (age - currentAge),
      age,
      spouseAge: inputs.spouseEnabled ? spouseCurrentAge + (age - currentAge) : null,
      incomeFlows,
      plannedDistributions,
      totalInflows,
      totalExpenses,
      totalOutflows,
      netCashFlow,
      portfolioAssets: r.investable,
      phase: 'retirement',
      isRetirementYear: false,
      withinRMD: r.withinRMD,
      shortfall: r.shortfall,
      earnedIncome: 0,
      earnedIncomeSelf: 0,
      earnedIncomeSpouse: 0,
      ssIncomeSelf: r.ssIncomeSelf || 0,
      ssIncomeSpouse: r.ssIncomeSpouse || 0,
      otherIncomeBreakdown: r.otherIncomeBreakdown || [],
      taxes: r.taxes || 0,
      federalTax: r.federalTax || 0,
      stateTax: r.stateTax || 0,
      effectiveTaxRate: r.effectiveTaxRate || 0,
      grossWithdrawal: r.grossWithdrawal || 0,
      netSpending: r.netSpending || 0,
      annualWithdrawal: r.withdrawalGross || 0,
      bucketBalances: r.bucketBalances || { pretax: 0, roth: 0, brokerage: 0, cash: 0 },
      withdrawalsByType,
    })
  }

  return rows
}

// ─── COMPONENT ────────────────────────────────────────────────

export default function CalculatorClient({ userEmail, existingAccounts = [], scenarios: initialScenarios }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const demoParam = searchParams?.get('demo') === 'true'
  const [scenarios, setScenarios] = useState(initialScenarios)
  const [activeId, setActiveId] = useState(() => scenarios[0]?.id || null)
  const activeScenario = scenarios.find((s) => s.id === activeId) || null
  const hasSaved = scenarios.length > 0

  const [inputs, setInputs] = useState(() => {
    if (activeScenario?.inputs) return migrateInputs({ ...DEFAULT_INPUTS, ...activeScenario.inputs })
    return DEFAULT_INPUTS
  })
  const [editing, setEditing] = useState(!hasSaved)
  const [saveState, setSaveState] = useState('idle')
  const [newScenarioName, setNewScenarioName] = useState('')
  const [showNewForm, setShowNewForm] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [newNameError, setNewNameError] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [pendingSwitchId, setPendingSwitchId] = useState(null)
  const [demoActive, setDemoActive] = useState(false)
  const demoLoadedRef = useRef(false)
  const [nudgeVisible, setNudgeVisible] = useState(false)
  const aboutRef = useRef(null)
  const newFormRef = useRef(null)
  const renameInputRef = useRef(null)
  const [showBreakdown, setShowBreakdown] = useState(true)
  const [showPreRetirement, setShowPreRetirement] = useState(false)
  const [showComparison, setShowComparison] = useState(false)
  const pdfRef = useRef(false)

  useEffect(() => {
    if (activeScenario?.inputs) {
      setInputs(migrateInputs({ ...DEFAULT_INPUTS, ...activeScenario.inputs }))
      setEditing(false)
    }
  }, [activeId])

  useEffect(() => {
    if (!activeScenario) {
      setIsDirty(JSON.stringify(inputs) !== JSON.stringify(DEFAULT_INPUTS))
      return
    }
    const saved = migrateInputs({ ...DEFAULT_INPUTS, ...(activeScenario.inputs || {}) })
    setIsDirty(JSON.stringify(saved) !== JSON.stringify(inputs))
  }, [inputs, activeScenario])

  useEffect(() => {
    if (!isDirty) return
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  useEffect(() => {
    if (!renaming) return
    const el = renameInputRef.current
    if (el) { el.focus(); el.select() }
  }, [renaming])

  useEffect(() => {
    const handler = (e) => {
      if (showAbout && aboutRef.current && !aboutRef.current.contains(e.target)) setShowAbout(false)
      if (showNewForm && newFormRef.current && !newFormRef.current.contains(e.target)) { setShowNewForm(false); setNewNameError(false) }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showAbout, showNewForm])

  useEffect(() => {
    if (!demoParam) return
    if (demoLoadedRef.current) return
    if (initialScenarios && initialScenarios.length > 0) return
    demoLoadedRef.current = true
    setInputs(makeDemoInputs())
    setDemoActive(true)
    setEditing(false)
  }, [demoParam, initialScenarios])

  useEffect(() => {
    if (!demoActive) return
    if (JSON.stringify(inputs) !== JSON.stringify(makeDemoInputs())) setDemoActive(false)
  }, [inputs, demoActive])

  useEffect(() => {
    const key = `glide_onboarding_nudge_dismissed_${activeId || 'new'}`
    try {
      const dismissed = typeof window !== 'undefined' && window.localStorage.getItem(key) === 'dismissed'
      setNudgeVisible(!dismissed)
    } catch {
      setNudgeVisible(false)
    }
  }, [activeId])

  const dismissNudge = () => {
    const key = `glide_onboarding_nudge_dismissed_${activeId || 'new'}`
    try { window.localStorage.setItem(key, 'dismissed') } catch {}
    setNudgeVisible(false)
  }

  const setInput = (k, v) => setInputs((p) => ({ ...p, [k]: v }))
  const derivedAge = ageFromBirthDate(inputs.birthDate)
  const derivedSpouseAge = ageFromBirthDate(inputs.spouseBirthDate)

  const [syncStatus, setSyncStatus] = useState(null)

  const buildLinkedFromExisting = (e) => ({
    id: crypto.randomUUID(),
    name: `${e.institution || ''} ${e.name}${e.mask ? ` ··${e.mask}` : ''}`.trim(),
    type: e.type,
    owner: e.owner || 'self',
    balance: e.balance,
    linkedAccount: {
      source: e.source,
      sourceId: e.sourceId,
      sourceUpdatedAt: e.updatedAt || new Date().toISOString(),
    },
  })

  // Wholesale import (used by onboarding's "Use existing accounts").
  const importExistingAccounts = (selected = existingAccounts) => {
    const accts = selected.map(buildLinkedFromExisting)
    setInputs((p) => ({ ...p, accounts: accts }))
  }

  // Additive sync (used by sidebar button). Matches by sourceId; updates balance + sourceUpdatedAt
  // for matched accounts; appends unmatched as new linked accounts; leaves freeform accounts alone.
  const syncExistingAccounts = () => {
    const byKey = new Map(existingAccounts.map((e) => [`${e.source}:${e.sourceId}`, e]))
    const linkedKeys = new Set(
      inputs.accounts
        .filter((a) => a.linkedAccount)
        .map((a) => `${a.linkedAccount.source}:${a.linkedAccount.sourceId}`)
    )
    let updated = 0
    const next = inputs.accounts.map((a) => {
      if (!a.linkedAccount) return a
      const key = `${a.linkedAccount.source}:${a.linkedAccount.sourceId}`
      const e = byKey.get(key)
      if (!e) return a
      updated += 1
      return {
        ...a,
        balance: e.balance,
        linkedAccount: { ...a.linkedAccount, sourceUpdatedAt: e.updatedAt || new Date().toISOString() },
      }
    })
    const toAdd = existingAccounts
      .filter((e) => !linkedKeys.has(`${e.source}:${e.sourceId}`))
      .map(buildLinkedFromExisting)
    setInputs((p) => ({ ...p, accounts: [...next, ...toAdd] }))
    setSyncStatus({ updated, added: toAdd.length })
    setTimeout(() => setSyncStatus(null), 4000)
  }

  const addAccount = () => setInputs((p) => ({ ...p, accounts: [...p.accounts, { id: crypto.randomUUID(), name: '', type: '401k', owner: 'self', balance: 0, linkedAccount: null, mirrorOnSave: true }] }))
  const updateAccount = (id, patch) => setInputs((p) => ({ ...p, accounts: p.accounts.map((a) => a.id === id ? { ...a, ...patch } : a) }))
  const removeAccount = (id) => setInputs((p) => ({ ...p, accounts: p.accounts.filter((a) => a.id !== id) }))

  const [linkingAccountId, setLinkingAccountId] = useState(null)
  const linkAccountTo = (accountId, existing) => {
    const acct = inputs.accounts.find((a) => a.id === accountId)
    if (!acct || !existing) return
    const currentBal = Number(acct.balance) || 0
    const newBal = Number(existing.balance) || 0
    let useNewBalance = true
    if (currentBal > 0 && Math.abs(currentBal - newBal) > Math.max(1000, currentBal * 0.05)) {
      useNewBalance = window.confirm(`Linking will update the balance from ${fmt(currentBal)} to ${fmt(newBal)}. Continue?`)
      if (useNewBalance === false) return
    }
    setInputs((p) => ({
      ...p,
      accounts: p.accounts.map((a) => a.id === accountId ? {
        ...a,
        balance: useNewBalance ? newBal : currentBal,
        type: a.type === '401k' && existing.type ? existing.type : (a.type || existing.type),
        linkedAccount: { source: existing.source, sourceId: existing.sourceId, sourceUpdatedAt: existing.updatedAt || new Date().toISOString() },
        mirrorOnSave: false,
      } : a),
    }))
    setLinkingAccountId(null)
  }
  const unlinkAccount = (accountId) => {
    if (!window.confirm('Unlink this account? The current balance will stay; future syncs will skip it.')) return
    setInputs((p) => ({ ...p, accounts: p.accounts.map((a) => a.id === accountId ? { ...a, linkedAccount: null } : a) }))
  }

  const addIncomeSource = () => setInputs((p) => ({ ...p, incomeSources: [...p.incomeSources, { id: crypto.randomUUID(), description: 'Income', amount: 0, startAge: p.retirementAge, endAge: p.lifeExpectancy, dollarType: 'today', inflationAdjust: true }] }))
  const updateIncomeSource = (id, patch) => setInputs((p) => ({ ...p, incomeSources: p.incomeSources.map((s) => s.id === id ? { ...s, ...patch } : s) }))
  const removeIncomeSource = (id) => setInputs((p) => ({ ...p, incomeSources: p.incomeSources.filter((s) => s.id !== id) }))

  const addMajorExpense = () => setInputs((p) => ({ ...p, majorExpenses: [...p.majorExpenses, { id: crypto.randomUUID(), description: 'Expense', amount: 0, age: ageFromBirthDate(p.birthDate) || 40, dollarType: 'today' }] }))
  const updateMajorExpense = (id, patch) => setInputs((p) => ({ ...p, majorExpenses: p.majorExpenses.map((e) => e.id === id ? { ...e, ...patch } : e) }))
  const removeMajorExpense = (id) => setInputs((p) => ({ ...p, majorExpenses: p.majorExpenses.filter((e) => e.id !== id) }))

  const valid = useMemo(() => inputs.birthDate && derivedAge >= 10 && derivedAge <= 110 && inputs.retirementAge > derivedAge && inputs.lifeExpectancy > inputs.retirementAge && inputs.accounts.length > 0, [inputs, derivedAge])
  const results = useMemo(() => valid ? runProjection(inputs) : null, [inputs, valid])

  const [monte, setMonte] = useState(null)
  useEffect(() => {
    if (!valid) { setMonte(null); return }
    setMonte(runMonteCarlo(inputs, 1000))
  }, [inputs, valid])

  const totals = useMemo(() => {
    const b = aggregateBuckets(inputs.accounts), inv = sumInvestable(b)
    return { byBucket: b, investable: inv, netWorth: inv + b.real_estate, pretaxShare: inv > 0 ? b.pretax / inv : 0 }
  }, [inputs.accounts])

  const existingByLinkKey = useMemo(() => {
    const m = new Map()
    for (const e of existingAccounts) m.set(`${e.source}:${e.sourceId}`, e)
    return m
  }, [existingAccounts])

  const linkedAccountStatus = useMemo(() => {
    const status = {}
    for (const acct of inputs.accounts || []) {
      if (!acct.linkedAccount?.sourceId) continue
      const key = `${acct.linkedAccount.source}:${acct.linkedAccount.sourceId}`
      const found = existingByLinkKey.get(key)
      if (!found) {
        status[acct.id] = { state: 'orphaned' }
      } else {
        const stale = found.updatedAt && acct.linkedAccount.sourceUpdatedAt && new Date(found.updatedAt).getTime() > new Date(acct.linkedAccount.sourceUpdatedAt).getTime()
        status[acct.id] = { state: 'live', stale, source: found }
      }
    }
    return status
  }, [inputs.accounts, existingByLinkKey])

  const linkedSourceKeysInUse = useMemo(() => {
    const s = new Set()
    for (const a of inputs.accounts || []) {
      if (a.linkedAccount?.sourceId) s.add(`${a.linkedAccount.source}:${a.linkedAccount.sourceId}`)
    }
    return s
  }, [inputs.accounts])

  const taxSummary = useMemo(() => {
    if (!results || !results.postData || results.postData.length === 0) {
      return { totalLifetimeTaxes: 0, avgEffectiveRate: 0, firstYearTaxes: 0, firstYearNetSpending: 0, firstYearNetSpendingMonthly: 0 }
    }
    const infl = (inputs.inflationRate || 0) / 100
    let totalToday = 0, rateSum = 0, n = 0
    for (const r of results.postData) {
      const ytd = r.age - derivedAge
      const deflator = Math.pow(1 + infl, ytd)
      totalToday += (r.taxes || 0) / deflator
      rateSum += (r.effectiveTaxRate || 0)
      n += 1
    }
    const first = results.postData[0]
    const firstYtd = first.age - derivedAge
    const firstDeflator = Math.pow(1 + infl, firstYtd)
    const grossToday = (inputs.retirementIncomeNeeded || 0)
    let netAnnual = (first.netSpending || 0) / firstDeflator
    if (netAnnual > grossToday && grossToday > 0) {
      if (typeof console !== 'undefined') console.warn('Net spending exceeded gross; capping at gross.')
      netAnnual = grossToday
    }
    return {
      totalLifetimeTaxes: totalToday,
      avgEffectiveRate: n > 0 ? rateSum / n : 0,
      firstYearTaxes: (first.taxes || 0) / firstDeflator,
      firstYearNetSpending: netAnnual,
      firstYearNetSpendingMonthly: netAnnual / 12,
    }
  }, [results, inputs.inflationRate, derivedAge, inputs.retirementIncomeNeeded])

  const advisorPrompts = useMemo(() => {
    const p = []
    if (inputs.preRetirementReturn > 8) p.push({ id: 'agg', title: 'Aggressive return assumption', message: 'Your plan assumes aggressive returns — want to stress test this with an advisor?' })
    const sy = 73 - derivedAge, spy = inputs.spouseEnabled ? 73 - derivedSpouseAge : 999
    if ((sy > 0 && sy <= 5) || (spy > 0 && spy <= 5)) p.push({ id: 'rmd', title: 'Approaching RMDs', message: "You're approaching Required Minimum Distributions — have you planned for the tax impact?" })
    if (totals.pretaxShare > 0.8 && totals.investable > 0) p.push({ id: 'roth', title: 'Roth conversion opportunity', message: `Most of your savings are pre-tax, and your plan pays ${fmt(taxSummary.totalLifetimeTaxes)} in taxes over retirement. A Roth conversion strategy during your gap years (retirement to age 73) could meaningfully reduce this.` })
    if (taxSummary.avgEffectiveRate > 0.22) p.push({ id: 'hightax', title: 'High retirement tax rate', message: `Your plan projects an average effective tax rate of ${Math.round(taxSummary.avgEffectiveRate * 100)}% in retirement. This is on the higher end — strategies to reduce it could include location planning, Roth conversions, Qualified Charitable Distributions, or tax-loss harvesting in taxable accounts.` })
    if (monte && monte.probability < 0.8) p.push({ id: 'low', title: 'Success probability below 80%', message: 'Your plan has meaningful risk of running short. An advisor can help close the gap.' })
    if (results && results.retirementBalance > 0 && inputs.retirementIncomeNeeded / results.retirementBalance > 0.05) p.push({ id: 'wr', title: 'Withdrawal rate above 5%', message: 'Your withdrawal rate is above the historically safe threshold — this is worth a conversation.' })
    if (inputs.socialSecurityAge < 67 && totals.investable > 500000) p.push({ id: 'ss', title: 'Consider delaying Social Security', message: 'Delaying Social Security could significantly increase your lifetime benefit.' })
    if (inputs.spouseEnabled) p.push({ id: 'sp', title: 'Coordinate spousal strategy', message: 'Have you coordinated your Social Security claiming strategy as a couple? Timing can make a major difference.' })
    return p
  }, [inputs, results, monte, totals, taxSummary])

  const chartData = useMemo(() => {
    if (!results) return []
    const infl = inputs.inflationRate / 100
    return [...results.preData, ...results.postData].map((r) => {
      const ytd = r.age - derivedAge
      return { age: r.age, balance: inputs.showFutureDollars ? (r.investable || 0) : (r.investable || 0) / Math.pow(1 + infl, ytd) }
    })
  }, [results, inputs.showFutureDollars, inputs.inflationRate, derivedAge])

  const compositionChart = useMemo(() => {
    if (!results) return []
    const infl = inputs.inflationRate / 100
    const d = (v, age) => inputs.showFutureDollars ? v : v / Math.pow(1 + infl, age - derivedAge)
    return [...results.preData, ...results.postData].map((r) => {
      const bb = r.bucketBalances || { pretax: 0, roth: 0, brokerage: 0, cash: 0 }
      return {
        age: r.age,
        pretax: d(bb.pretax || 0, r.age),
        roth: d(bb.roth || 0, r.age),
        brokerage: d(bb.brokerage || 0, r.age),
        cash: d(bb.cash || 0, r.age),
      }
    })
  }, [results, inputs.showFutureDollars, inputs.inflationRate, derivedAge])

  const cashFlowChart = useMemo(() => {
    if (!results) return []
    const infl = inputs.inflationRate / 100
    const d = (v, age) => inputs.showFutureDollars ? v : v / Math.pow(1 + infl, age - derivedAge)
    return results.postData.map((r) => {
      const incomeFlows = (r.ssIncome || 0) + (r.otherIncome || 0)
      const plannedDistributions = (r.seq || []).filter((s) => s.note === 'RMD').reduce((sum, s) => sum + s.amount, 0)
      const totalInflows = incomeFlows + plannedDistributions
      const totalOutflows = (r.withdrawalGross || 0) + (r.majorExpense || 0)
      return {
        age: r.age,
        totalInflows: d(totalInflows, r.age),
        totalOutflows: d(totalOutflows, r.age),
      }
    })
  }, [results, inputs.showFutureDollars, inputs.inflationRate, derivedAge])

  const incomeChart = useMemo(() => {
    if (!results) return { data: [], series: [] }
    const allRows = buildCashFlowRows(results, inputs)
    const rows = showPreRetirement ? allRows : allRows.filter((r) => r.phase === 'retirement')
    const infl = inputs.inflationRate / 100
    const d = (v, age) => inputs.showFutureDollars ? v : v / Math.pow(1 + infl, age - derivedAge)

    const otherPalette = ['#f59e0b', '#ec4899', '#eab308', '#f97316', '#06b6d4']
    const allOtherIds = new Set()
    const otherMeta = {}
    for (const r of rows) {
      for (const s of r.otherIncomeBreakdown || []) {
        if (!allOtherIds.has(s.id)) {
          otherMeta[s.id] = s.description || 'Income'
          allOtherIds.add(s.id)
        }
      }
    }
    const otherIds = [...allOtherIds]
    const otherColors = {}
    otherIds.forEach((id, i) => { otherColors[id] = otherPalette[i % otherPalette.length] })

    const data = rows.map((r) => {
      const wbt = r.withdrawalsByType || { brokerage: 0, cash: 0, pretax: 0, rmd: 0, roth: 0 }
      const obj = {
        age: r.age,
        earnedSelf: d(r.earnedIncomeSelf || 0, r.age),
        earnedSpouse: d(r.earnedIncomeSpouse || 0, r.age),
        ssSelf: d(r.ssIncomeSelf || 0, r.age),
        ssSpouse: d(r.ssIncomeSpouse || 0, r.age),
        withdrawalCash: d(wbt.cash || 0, r.age),
        withdrawalBrokerage: d(wbt.brokerage || 0, r.age),
        withdrawalPretax: d(wbt.pretax || 0, r.age),
        withdrawalRMD: d(wbt.rmd || 0, r.age),
        withdrawalRoth: d(wbt.roth || 0, r.age),
        totalExpenses: r.phase === 'retirement' ? d(r.totalExpenses, r.age) : null,
      }
      for (const id of otherIds) obj[`other_${id}`] = 0
      for (const s of r.otherIncomeBreakdown || []) {
        obj[`other_${s.id}`] = d(s.amount, r.age)
      }
      return obj
    })

    const totalsBy = {}
    const keys = [
      'earnedSelf', 'earnedSpouse', 'ssSelf', 'ssSpouse',
      ...otherIds.map((id) => `other_${id}`),
      'withdrawalCash', 'withdrawalBrokerage', 'withdrawalPretax', 'withdrawalRMD', 'withdrawalRoth',
    ]
    for (const k of keys) totalsBy[k] = 0
    for (const row of data) { for (const k of keys) totalsBy[k] += row[k] || 0 }

    const series = []
    if (totalsBy.earnedSelf > 0) series.push({ key: 'earnedSelf', label: 'Earned income (you)', color: '#3b82f6', group: 'guaranteed' })
    if (totalsBy.earnedSpouse > 0) series.push({ key: 'earnedSpouse', label: 'Earned income (spouse)', color: '#60a5fa', group: 'guaranteed' })
    if (totalsBy.ssSelf > 0) series.push({ key: 'ssSelf', label: 'Social Security (you)', color: '#10b981', group: 'guaranteed' })
    if (totalsBy.ssSpouse > 0) series.push({ key: 'ssSpouse', label: 'Social Security (spouse)', color: '#34d399', group: 'guaranteed' })
    for (const id of otherIds) {
      if (totalsBy[`other_${id}`] > 0) series.push({ key: `other_${id}`, label: otherMeta[id], color: otherColors[id], group: 'guaranteed' })
    }
    if (totalsBy.withdrawalBrokerage > 0) series.push({ key: 'withdrawalBrokerage', label: 'Investment withdrawal', color: '#c4b5fd', group: 'withdrawal' })
    if (totalsBy.withdrawalCash > 0) series.push({ key: 'withdrawalCash', label: 'Cash withdrawal', color: '#a78bfa', group: 'withdrawal' })
    if (totalsBy.withdrawalRoth > 0) series.push({ key: 'withdrawalRoth', label: 'Roth withdrawal', color: '#8b5cf6', group: 'withdrawal' })
    if (totalsBy.withdrawalPretax > 0) series.push({ key: 'withdrawalPretax', label: 'Pre-tax withdrawal', color: '#7c3aed', group: 'withdrawal' })
    if (totalsBy.withdrawalRMD > 0) series.push({ key: 'withdrawalRMD', label: 'Required distribution (RMD)', color: '#5b21b6', group: 'withdrawal' })

    return { data, series }
  }, [results, inputs, showPreRetirement])

  const comparisonData = useMemo(() => {
    if (!showComparison || scenarios.length < 2) return []
    return scenarios.map((sc) => {
      const inp = migrateInputs({ ...DEFAULT_INPUTS, ...sc.inputs })
      const age = ageFromBirthDate(inp.birthDate)
      const ok = inp.birthDate && age >= 10 && inp.retirementAge > age && inp.lifeExpectancy > inp.retirementAge && inp.accounts.length > 0
      if (!ok) return { scenario: sc, inputs: inp, valid: false, derivedAge: age }
      const res = runProjection(inp)
      const mc = runMonteCarlo(inp, 500)
      const fourPct = res.retirementBalance * 0.04
      const wr = res.retirementBalance > 0 ? (inp.retirementIncomeNeeded / res.retirementBalance * 100) : 0
      return { scenario: sc, inputs: inp, results: res, monte: mc, valid: true, fourPct, wr, derivedAge: age }
    })
  }, [showComparison, scenarios])

  const saveScenario = useCallback(async () => {
    setSaveState('saving')
    try {
      // Mirror any pending accounts to manual_accounts before persisting the scenario,
      // so the saved scenario already carries the linkedAccount references.
      let workingInputs = inputs
      const pending = inputs.accounts.filter((a) => a.mirrorOnSave && !a.linkedAccount && (a.balance || 0) > 0 && a.name?.trim())
      if (pending.length > 0) {
        const mirrors = await Promise.all(pending.map(async (a) => {
          const meta = calcTypeToManualMeta(a.type)
          const res = await fetch('/api/accounts', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: a.name, account_type: meta.account_type, balance: a.balance, institution_name: null }),
          })
          if (!res.ok) return { id: a.id, ok: false }
          const { id, updated_at } = await res.json()
          return { id: a.id, ok: true, sourceId: id, sourceUpdatedAt: updated_at || new Date().toISOString() }
        }))
        workingInputs = {
          ...inputs,
          accounts: inputs.accounts.map((a) => {
            const m = mirrors.find((x) => x.id === a.id)
            if (!m || !m.ok) return a
            return {
              ...a,
              mirrorOnSave: false,
              linkedAccount: { source: 'manual', sourceId: m.sourceId, sourceUpdatedAt: m.sourceUpdatedAt },
            }
          }),
        }
        setInputs(workingInputs)
      }

      if (activeId) {
        const res = await fetch('/api/scenarios', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: activeId, inputs: workingInputs, results: results ? { retirementBalance: results.retirementBalance, finalBalance: results.finalBalance, runOutAge: results.runOutAge, monte } : null }),
        })
        if (!res.ok) throw new Error()
        setScenarios((prev) => prev.map((s) => s.id === activeId ? { ...s, inputs: workingInputs, updated_at: new Date().toISOString() } : s))
      } else {
        const res = await fetch('/api/scenarios', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Base plan', inputs: workingInputs, is_base: true }),
        })
        if (!res.ok) throw new Error()
        const { scenario } = await res.json()
        setScenarios((prev) => [...prev, scenario])
        setActiveId(scenario.id)
      }
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 2000)
    } catch { setSaveState('error') }
  }, [activeId, inputs, results, monte])

  const createScenario = useCallback(async () => {
    const name = newScenarioName.trim()
    if (!name) { setNewNameError(true); return }
    setNewNameError(false)
    try {
      const res = await fetch('/api/scenarios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, inputs }),
      })
      if (!res.ok) throw new Error()
      const { scenario } = await res.json()
      setScenarios((prev) => [...prev, scenario])
      setActiveId(scenario.id)
      setShowNewForm(false)
      setNewScenarioName('')
    } catch { alert('Failed to create scenario') }
  }, [inputs, newScenarioName])

  const startRename = useCallback(() => {
    if (!activeScenario) return
    setRenameValue(activeScenario.name || '')
    setRenameError(false)
    setRenaming(true)
  }, [activeScenario])

  const cancelRename = useCallback(() => {
    setRenaming(false)
    setRenameError(false)
    setRenameValue('')
  }, [])

  const saveRename = useCallback(async () => {
    if (!activeId) return
    const name = renameValue.trim()
    if (!name) { setRenameError(true); return }
    try {
      const res = await fetch('/api/scenarios', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: activeId, name }),
      })
      if (!res.ok) throw new Error()
      setScenarios((prev) => prev.map((s) => s.id === activeId ? { ...s, name } : s))
      setRenaming(false)
      setRenameError(false)
      setRenameValue('')
    } catch { alert('Failed to rename scenario') }
  }, [activeId, renameValue])

  const requestSwitchScenario = useCallback((id) => {
    if (id === activeId) return
    if (isDirty) { setPendingSwitchId(id); return }
    setActiveId(id)
  }, [activeId, isDirty])

  const confirmSwitchSave = useCallback(async () => {
    await saveScenario()
    if (pendingSwitchId) { setActiveId(pendingSwitchId); setPendingSwitchId(null) }
  }, [saveScenario, pendingSwitchId])

  const confirmSwitchDiscard = useCallback(() => {
    if (pendingSwitchId) setActiveId(pendingSwitchId)
    setPendingSwitchId(null)
  }, [pendingSwitchId])

  const confirmSwitchCancel = useCallback(() => { setPendingSwitchId(null) }, [])

  const deleteScenario = useCallback(async (id) => {
    try {
      const res = await fetch(`/api/scenarios?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setScenarios((prev) => prev.filter((s) => s.id !== id))
      if (activeId === id) {
        const remaining = scenarios.filter((s) => s.id !== id)
        setActiveId(remaining[0]?.id || null)
      }
    } catch { alert('Failed to delete scenario') }
  }, [activeId, scenarios])

  const [pdfState, setPdfState] = useState('idle')
  const downloadPdf = useCallback(async () => {
    if (!results || !valid) return
    if (!window.jspdf?.jsPDF) { setPdfState('error'); setTimeout(() => setPdfState('idle'), 2000); return }
    setPdfState('generating')
    try {
      const { generatePdf } = await import('./pdfGenerator')
      await generatePdf({
        userEmail,
        scenarioName: activeScenario?.name || 'Base plan',
        inputs,
        results,
        monte,
        taxSummary,
        advisorPrompts,
        derivedAge,
        derivedSpouseAge,
        totals,
        netSpending: {
          firstYearNetSpending: taxSummary.firstYearNetSpending,
          firstYearNetSpendingMonthly: taxSummary.firstYearNetSpendingMonthly,
          firstYearTaxes: taxSummary.firstYearTaxes,
        },
        cashFlowRows: buildCashFlowRows(results, inputs),
      })
      setPdfState('done')
      setTimeout(() => setPdfState('idle'), 2500)
    } catch (e) {
      console.error('PDF export failed', e)
      setPdfState('error')
      setTimeout(() => setPdfState('idle'), 3000)
    }
  }, [userEmail, activeScenario, inputs, results, monte, taxSummary, advisorPrompts, derivedAge, derivedSpouseAge, totals, valid])

  const pdfLabel =
    pdfState === 'generating' ? 'Preparing your plan…' :
    pdfState === 'done' ? 'PDF downloaded' :
    pdfState === 'error' ? 'Download failed — try again' :
    'Download PDF'
  const pdfDisabled = pdfState === 'generating' || !valid || !results

  const handleSignOut = useCallback(async () => {
    const { createClient } = await import('../../lib/supabase')
    const s = createClient(); await s.auth.signOut()
    window.location.href = '/signin'
  }, [])

  const infl = inputs.inflationRate / 100
  const ytr = inputs.retirementAge - derivedAge
  const scenarioLabel = activeScenario?.name || 'Base plan'
  const truncLabel = scenarioLabel.length > 20 ? scenarioLabel.slice(0, 20) + '…' : scenarioLabel
  const saveLabel =
    saveState === 'saving' ? 'Saving...' :
    saveState === 'saved' ? 'Saved ✓' :
    saveState === 'error' ? 'Save failed' :
    `Save ${truncLabel}`
  const saveBtnClass =
    saveState === 'saving' ? 'bg-blue-300 text-white border border-transparent cursor-wait' :
    saveState === 'saved' ? 'bg-emerald-500 text-white border border-transparent' :
    saveState === 'error' ? 'bg-red-500 text-white border border-transparent' :
    isDirty ? 'bg-blue-500 hover:bg-blue-600 text-white border border-transparent' :
    'bg-white hover:bg-slate-50 text-slate-500 border border-slate-200'
  const probPct = monte ? Math.round(monte.probability * 100) : null
  const probColor = probPct === null ? 'text-slate-400' : probPct >= 85 ? 'text-emerald-600' : probPct >= 70 ? 'text-amber-500' : 'text-red-600'
  const wrRate = results && results.retirementBalance > 0 ? (inputs.retirementIncomeNeeded / results.retirementBalance * 100).toFixed(1) : '—'
  const fourPct = results ? results.retirementBalance * 0.04 : 0
  const dispBal = (v, ytd) => inputs.showFutureDollars ? v : v / Math.pow(1 + infl, ytd)

  const needsOnboarding =
    !showComparison &&
    scenarios.length === 0 &&
    !demoActive &&
    (!inputs.birthDate || inputs.accounts.length === 0)

  const startCustomPlan = () => {
    setInputs(DEFAULT_INPUTS)
    setDemoActive(false)
    setEditing(true)
    router.replace('/calculator')
  }

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <Script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js" strategy="afterInteractive" />
      <Script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.23/jspdf.plugin.autotable.min.js" strategy="afterInteractive" />

      {/* Nav */}
      <nav className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center sticky top-0 z-20">
        <div className="flex items-baseline gap-2">
          <span className="text-slate-900 text-xl font-bold tracking-tight">Glide</span>
          <span className="text-blue-500 text-xs font-medium">by Clark.com</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-slate-500 text-sm hidden sm:inline">{userEmail}</span>
          <button onClick={handleSignOut} className="text-slate-500 hover:text-slate-700 text-sm border border-slate-200 rounded-lg px-3 py-1.5">Sign out</button>
        </div>
      </nav>

      {/* Tabs */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-[1400px] mx-auto px-6 flex gap-6">
          <Link href="/dashboard" className="px-1 py-3 text-sm font-medium text-slate-500 hover:text-slate-700 border-b-2 border-transparent">Net Worth Dashboard</Link>
          <button className="px-1 py-3 text-sm font-medium text-blue-600 border-b-2 border-blue-500">Retirement Plan</button>
        </div>
      </div>

      {/* Scenario header + tabs */}
      {scenarios.length > 0 && (
        <div className="bg-white border-b border-slate-200 sticky top-14 z-10">
          <div className="max-w-[1400px] mx-auto px-6 py-2.5">
            <div className="flex items-center mb-2 gap-3">
              <div className="min-w-0 flex items-center gap-3 flex-1">
                {renaming ? (
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-slate-700 flex-shrink-0">Viewing:</span>
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => { setRenameValue(e.target.value); setRenameError(false) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') cancelRename() }}
                      className={`text-sm font-semibold text-slate-900 border rounded px-1.5 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 min-w-0 ${renameError ? 'border-red-400' : 'border-slate-300'}`}
                    />
                    <button onClick={saveRename} aria-label="Save name" className="text-emerald-600 hover:text-emerald-700 flex-shrink-0">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    </button>
                    <button onClick={cancelRename} aria-label="Cancel rename" className="text-slate-400 hover:text-slate-600 flex-shrink-0">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                    {renameError && <span className="text-xs text-red-500 flex-shrink-0">Name required</span>}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="text-sm text-slate-700 truncate">
                      Viewing: <span className="font-semibold text-slate-900">{activeScenario?.name || 'Base plan'}</span>
                    </p>
                    {activeScenario && (
                      <button onClick={startRename} aria-label="Rename scenario" className="text-slate-400 hover:text-blue-600 flex-shrink-0">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      </button>
                    )}
                  </div>
                )}
                <button onClick={saveScenario} disabled={saveState === 'saving'} className={`text-xs font-medium rounded-md px-3 py-1.5 flex items-center gap-1.5 transition-colors flex-shrink-0 ${saveBtnClass}`}>
                  {isDirty && saveState === 'idle' && <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400" />}
                  {saveLabel}
                </button>
                <button
                  onClick={downloadPdf}
                  disabled={pdfDisabled}
                  title={pdfLabel}
                  className={`text-xs font-medium rounded-md px-3 py-1.5 transition-colors flex-shrink-0 border ${pdfDisabled && pdfState !== 'generating' ? 'text-slate-300 border-slate-200 bg-white cursor-not-allowed' : pdfState === 'generating' ? 'text-slate-500 border-slate-200 bg-slate-100 cursor-wait' : pdfState === 'done' ? 'text-emerald-700 border-emerald-200 bg-emerald-50' : pdfState === 'error' ? 'text-red-700 border-red-200 bg-red-50' : 'text-slate-600 border-slate-200 bg-white hover:bg-slate-50'}`}
                >
                  {pdfState === 'generating' ? 'Preparing…' : pdfState === 'done' ? 'Downloaded ✓' : pdfState === 'error' ? 'Failed' : 'PDF'}
                </button>
              </div>
            </div>
            {scenarios.length <= 1 && !renaming && (
              <p className="text-xs text-slate-400 -mt-1 mb-2">Save alternative versions to compare retiring earlier, saving more, or other what-ifs.</p>
            )}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0">
                {scenarios.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => requestSwitchScenario(s.id)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-all ${
                      activeId === s.id ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'text-slate-500 hover:bg-slate-50 border border-transparent'
                    }`}
                  >
                    {s.name}
                    {!s.is_base && activeId === s.id && (
                      <span onClick={(e) => { e.stopPropagation(); deleteScenario(s.id) }} className="ml-1.5 text-slate-400 hover:text-red-500">×</span>
                    )}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0 pl-2 border-l border-slate-200">
                {scenarios.length >= 2 && (
                  <button onClick={() => setShowComparison(true)} className="px-2 py-1.5 text-xs font-medium text-blue-500 hover:bg-blue-50 rounded-md whitespace-nowrap flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
                    Compare all
                  </button>
                )}
                <div className="relative" ref={newFormRef}>
                  <button onClick={() => { setShowNewForm(true); setNewNameError(false) }} className="px-2 py-1.5 text-xs font-medium text-blue-500 hover:bg-blue-50 rounded-md whitespace-nowrap">+ New scenario</button>
                  {showNewForm && (
                    <div className="absolute right-0 top-full mt-1.5 w-72 bg-white border border-slate-200 rounded-xl shadow-lg p-4 z-20">
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="text-sm font-semibold text-slate-900">New scenario</h4>
                        <button onClick={() => { setShowNewForm(false); setNewNameError(false) }} className="text-slate-400 hover:text-slate-600 text-sm leading-none">×</button>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed mb-3">Creates a copy of your current inputs as a new scenario. You can then adjust anything independently of your other scenarios.</p>
                      <label className="block text-xs text-slate-600 mb-1">Name</label>
                      <input
                        type="text"
                        placeholder="e.g., Retire at 62, Higher savings, Market downturn"
                        value={newScenarioName}
                        onChange={(e) => { setNewScenarioName(e.target.value); setNewNameError(false) }}
                        className={`w-full border rounded-lg px-2.5 py-1.5 text-sm text-slate-900 mb-1 focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${newNameError ? 'border-red-300' : 'border-slate-200'}`}
                        autoFocus
                      />
                      {newNameError && <p className="text-xs text-red-500 mb-2">Please enter a name</p>}
                      <div className="flex items-center gap-3 mt-2">
                        <button onClick={createScenario} className="text-xs font-medium bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg">Create scenario</button>
                        <button onClick={() => { setShowNewForm(false); setNewNameError(false) }} className="text-xs text-slate-500 hover:text-slate-700">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="relative" ref={aboutRef}>
                  <button onClick={() => setShowAbout(!showAbout)} className="px-2 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 whitespace-nowrap">About scenarios</button>
                  {showAbout && (
                    <div className="absolute right-0 top-full mt-1.5 w-72 bg-white border border-slate-200 rounded-xl shadow-lg p-4 z-20">
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="text-sm font-semibold text-slate-900">Scenarios</h4>
                        <button onClick={() => setShowAbout(false)} className="text-slate-400 hover:text-slate-600 text-sm leading-none">×</button>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Scenarios let you save and compare different retirement plans. Your Base plan is your primary forecast. Create additional scenarios to explore alternatives — like retiring earlier, saving more, or stress-testing a market downturn. Each scenario saves independently.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {demoActive && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5">
          <div className="max-w-[1400px] mx-auto flex items-center justify-between gap-3">
            <p className="text-xs text-amber-800">
              <span className="font-semibold">Viewing a sample plan.</span>
              <span className="hidden sm:inline"> Explore the features, then create your own plan to save and customize.</span>
            </p>
            <button onClick={startCustomPlan} className="text-xs font-medium text-amber-900 underline hover:text-amber-700 whitespace-nowrap">
              Create your own plan →
            </button>
          </div>
        </div>
      )}

      {needsOnboarding ? (
        <OnboardingFlow
          inputs={inputs}
          setInputs={setInputs}
          setInput={setInput}
          existingAccounts={existingAccounts}
          importExistingAccounts={importExistingAccounts}
          derivedAge={derivedAge}
          derivedSpouseAge={derivedSpouseAge}
          onLoadDemo={() => { router.push('/calculator?demo=true') }}
          taxSummary={taxSummary}
          planValid={valid}
        />
      ) : showComparison && scenarios.length >= 2 ? (
        <ComparisonView
          comparisonData={comparisonData}
          scenarios={scenarios}
          activeScenario={activeScenario}
          onOpenScenario={(id) => { requestSwitchScenario(id); setShowComparison(false) }}
          onBack={() => setShowComparison(false)}
          onNewScenario={() => { setShowNewForm(true); setNewNameError(false) }}
        />
      ) : (
      <>
      <div className="flex flex-col lg:flex-row gap-6 px-4 sm:px-6 py-6 max-w-[1400px] mx-auto">
        {/* LEFT — Assumptions */}
        <aside className={`w-full flex-shrink-0 order-2 lg:order-1 ${editing ? 'lg:w-[360px]' : 'lg:w-[280px]'}`}>
          {!editing && hasSaved ? (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-900">Your assumptions</h2>
                <button onClick={() => setEditing(true)} className="text-xs font-medium text-blue-600 hover:text-blue-700">Edit assumptions</button>
              </div>
              <div className="space-y-1.5 text-sm">
                <SummaryRow label="Planning for" value={inputs.spouseEnabled ? 'You + spouse' : 'Just you'} />
                <SummaryRow label="Age" value={`${derivedAge} → retire at ${inputs.retirementAge}`} />
                {inputs.spouseEnabled && <SummaryRow label="Spouse" value={`Age ${derivedSpouseAge}, retire ${inputs.spouseRetirementAge}`} />}
                <SummaryRow label="Life expectancy" value={inputs.lifeExpectancy} />
                <SummaryRow label="Income needed" value={fmt(inputs.retirementIncomeNeeded)} />
                {inputs.spouseEnabled ? <>
                  <SummaryRow label="Your income" value={fmt(inputs.userAnnualIncome)} />
                  <SummaryRow label="Your monthly savings" value={fmt(inputs.userMonthlySavings)} />
                  <SummaryRow label="Spouse income" value={fmt(inputs.spouseAnnualIncome)} />
                  <SummaryRow label="Spouse monthly savings" value={fmt(inputs.spouseMonthlySavings)} />
                </> : <>
                  <SummaryRow label="Annual income" value={fmt(inputs.userAnnualIncome)} />
                  <SummaryRow label="Monthly savings" value={fmt(inputs.userMonthlySavings)} />
                </>}
                <SummaryRow label="Social Security" value={`${fmt(inputs.socialSecurityAmount)}/mo at ${inputs.socialSecurityAge}`} />
                <SummaryRow label="Pre-ret. return" value={`${inputs.preRetirementReturn}%`} />
                <SummaryRow label="Post-ret. return" value={`${inputs.postRetirementReturn}%`} />
                <SummaryRow label="Inflation" value={`${inputs.inflationRate}%`} />
                <SummaryRow label="Accounts" value={`${inputs.accounts.length} (${fmt(totals.investable)})`} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={downloadPdf} disabled={pdfDisabled} className={`text-xs font-medium rounded-md px-2.5 py-1.5 transition-colors ${pdfDisabled && pdfState !== 'generating' ? 'text-slate-300 bg-slate-50 cursor-not-allowed' : pdfState === 'generating' ? 'text-slate-500 bg-slate-100 cursor-wait' : pdfState === 'done' ? 'text-emerald-700 bg-emerald-50' : pdfState === 'error' ? 'text-red-700 bg-red-50' : 'text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100'}`}>{pdfLabel}</button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {hasSaved && (
                <button onClick={() => setEditing(false)} className="text-xs font-medium text-blue-600 hover:text-blue-700 mb-2">← Back to results</button>
              )}

              {existingAccounts.length > 0 && (() => {
                const hasLinked = inputs.accounts.some((a) => a.linkedAccount)
                const empty = inputs.accounts.length === 0
                return (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                    <p className="text-sm text-blue-800 font-medium mb-1">{empty ? 'Use your existing accounts?' : (hasLinked ? 'Sync linked accounts' : 'Pre-fill from existing accounts')}</p>
                    <p className="text-xs text-blue-700/80 mb-2">
                      {empty
                        ? `${existingAccounts.length} account${existingAccounts.length === 1 ? '' : 's'} from your dashboard ready to import.`
                        : hasLinked
                        ? 'Update linked balances and add any new accounts from your dashboard.'
                        : 'Link your dashboard accounts to this plan.'}
                    </p>
                    <button onClick={empty ? () => importExistingAccounts() : syncExistingAccounts} className="text-xs font-medium bg-blue-500 text-white px-3 py-1.5 rounded-lg hover:bg-blue-600">
                      {empty ? 'Import accounts' : (hasLinked ? 'Sync linked accounts' : 'Pre-fill from existing')}
                    </button>
                    {syncStatus && (
                      <p className="text-xs text-emerald-700 mt-2">
                        Updated {syncStatus.updated} linked account{syncStatus.updated === 1 ? '' : 's'}
                        {syncStatus.added > 0 ? `. Added ${syncStatus.added} new account${syncStatus.added === 1 ? '' : 's'}.` : '.'}
                      </p>
                    )}
                  </div>
                )
              })()}

              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
                <h2 className="text-sm font-semibold text-slate-900 mb-3">Who are you planning for?</h2>
                <div className="flex gap-2">
                  <button onClick={() => setInput('spouseEnabled', false)} className={`flex-1 rounded-lg border p-3 text-sm font-medium transition-colors ${!inputs.spouseEnabled ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>Just me</button>
                  <button onClick={() => setInput('spouseEnabled', true)} className={`flex-1 rounded-lg border p-3 text-sm font-medium transition-colors ${inputs.spouseEnabled ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>Me and my spouse</button>
                </div>
              </div>

              <Section title="Basic information">
                <label className="block text-xs text-slate-600">
                  <span className="block mb-0.5">Your birth date</span>
                  <input type="date" value={inputs.birthDate} onChange={(e) => setInput('birthDate', e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400" />
                  {inputs.birthDate && <span className="text-[10px] text-slate-500 mt-0.5 block">Age {derivedAge}</span>}
                </label>
                {inputs.spouseEnabled && (
                  <label className="block text-xs text-slate-600">
                    <span className="block mb-0.5">Spouse birth date</span>
                    <input type="date" value={inputs.spouseBirthDate || ''} onChange={(e) => setInput('spouseBirthDate', e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400" />
                    {inputs.spouseBirthDate && <span className="text-[10px] text-slate-500 mt-0.5 block">Age {derivedSpouseAge}</span>}
                  </label>
                )}
                <NF label="Your retirement age" value={inputs.retirementAge} min={40} max={90} onChange={(v) => setInput('retirementAge', v)} tooltip={FIELD_TOOLTIPS.retirementAge} />
                {inputs.spouseEnabled && <NF label="Spouse retirement age" value={inputs.spouseRetirementAge} min={40} max={90} onChange={(v) => setInput('spouseRetirementAge', v)} tooltip={FIELD_TOOLTIPS.spouseRetirementAge} />}
                <NF label={inputs.spouseEnabled ? 'Life expectancy (longest-lived)' : 'Life expectancy'} value={inputs.lifeExpectancy} min={50} max={120} onChange={(v) => setInput('lifeExpectancy', v)} tooltip={FIELD_TOOLTIPS.lifeExpectancy} />
                <div>
                  <MF label={inputs.spouseEnabled ? 'Combined annual income needed' : 'Annual income needed'} value={inputs.retirementIncomeNeeded} onChange={(v) => setInput('retirementIncomeNeeded', v)} />
                  <HelperText>{FIELD_HELP.retirementIncomeNeeded}</HelperText>
                  {valid && taxSummary.firstYearNetSpending > 0 && (
                    <p className="text-xs text-slate-600 leading-relaxed mt-1">
                      Your take-home spending: ~<span className="font-medium text-slate-800">{fmt(taxSummary.firstYearNetSpendingMonthly)}/month</span> (<span className="font-medium text-slate-800">{fmt(taxSummary.firstYearNetSpending)}/year</span>) in today&apos;s dollars
                    </p>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-2">All amounts in today&apos;s dollars.</p>
                {inputs.spouseEnabled ? <>
                  <MF label="Your annual income" value={inputs.userAnnualIncome} onChange={(v) => setInput('userAnnualIncome', v)} tooltip={FIELD_TOOLTIPS.userAnnualIncome} />
                  <div>
                    <MF label="Your monthly savings" value={inputs.userMonthlySavings} onChange={(v) => setInput('userMonthlySavings', v)} />
                    <HelperText>{FIELD_HELP.userMonthlySavings}</HelperText>
                  </div>
                  <MF label="Spouse annual income" value={inputs.spouseAnnualIncome} onChange={(v) => setInput('spouseAnnualIncome', v)} tooltip={FIELD_TOOLTIPS.spouseAnnualIncome} />
                  <div>
                    <MF label="Spouse monthly savings" value={inputs.spouseMonthlySavings} onChange={(v) => setInput('spouseMonthlySavings', v)} />
                    <HelperText>{FIELD_HELP.spouseMonthlySavings}</HelperText>
                  </div>
                </> : <>
                  <MF label="Annual income" value={inputs.userAnnualIncome} onChange={(v) => setInput('userAnnualIncome', v)} tooltip={FIELD_TOOLTIPS.userAnnualIncome} />
                  <div>
                    <MF label="Monthly savings" value={inputs.userMonthlySavings} onChange={(v) => setInput('userMonthlySavings', v)} />
                    <HelperText>{FIELD_HELP.userMonthlySavings}</HelperText>
                  </div>
                </>}
                <Tog label="Increase savings yearly" checked={inputs.increaseSavings} onChange={(v) => setInput('increaseSavings', v)} tooltip={FIELD_TOOLTIPS.increaseSavings} />
                {inputs.increaseSavings && <NF label="Annual increase (%)" value={inputs.savingsIncreaseRate} min={0} max={20} step={0.5} onChange={(v) => setInput('savingsIncreaseRate', v)} />}
              </Section>

              <Section title="Accounts" right={<button onClick={addAccount} className="text-xs font-medium text-blue-600 hover:text-blue-700">+ Add</button>}>
                <p className="text-xs text-slate-500 leading-relaxed">Add the accounts that will fund your retirement. You can enter each account individually or combine like types (e.g. &quot;All 401(k) balances: $500k&quot;). What matters is the total balance and the tax treatment.</p>
                <p className="text-xs text-slate-500 leading-relaxed mt-2">Precious metals, crypto, and other alternative investments go under &quot;Other investments&quot; — we model them using the same return assumptions as a diversified brokerage account.</p>
                <p className="text-xs text-slate-500 leading-relaxed mt-2">Your home and rental properties aren&apos;t tracked here. If you plan to downsize, add the expected proceeds as a Lump Sum below. If you have rental income, add it as an Income Source.</p>
                {inputs.accounts.length === 0 && <p className="text-slate-400 text-xs">Enter your birth date and add at least one account to see your plan.</p>}
                {inputs.accounts.map((a) => (
                  a.type === 'real_estate' ? (
                    <div key={a.id} className="border border-slate-200 bg-slate-50 rounded-lg p-2 space-y-1 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-700 font-medium">{a.name || 'Real estate'}</span>
                        <button onClick={() => removeAccount(a.id)} className="text-slate-400 hover:text-red-500 px-1 text-sm">×</button>
                      </div>
                      <div className="flex items-center justify-between text-slate-500">
                        <span>Real estate — {fmt(a.balance || 0)}</span>
                        <span className="text-[10px] text-slate-400">Tracked in net worth only</span>
                      </div>
                    </div>
                  ) : (() => {
                    const status = linkedAccountStatus[a.id]
                    const orphaned = status?.state === 'orphaned'
                    const stale = status?.stale
                    const eligibleExisting = existingAccounts.filter((e) => !linkedSourceKeysInUse.has(`${e.source}:${e.sourceId}`))
                    return (
                    <div key={a.id} className="border border-slate-200 rounded-lg p-2 space-y-1.5 text-xs">
                      <div className="flex gap-1.5 items-center">
                        <input type="text" placeholder="Account name" value={a.name} onChange={(e) => updateAccount(a.id, { name: e.target.value })} className="flex-1 border border-slate-200 rounded px-2 py-1.5 text-slate-900" />
                        {a.linkedAccount && !orphaned && (
                          <span title={`Linked to your ${a.linkedAccount.source === 'plaid' ? 'Plaid' : 'net worth dashboard'} account. Updates here propagate.`} className="flex items-center gap-0.5 text-emerald-600 text-[10px] font-medium flex-shrink-0">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                            Linked
                          </span>
                        )}
                        {orphaned && (
                          <span title="The source account no longer exists." className="flex items-center gap-0.5 text-red-600 text-[10px] font-medium flex-shrink-0">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-3l-6.93-12a2 2 0 00-3.48 0l-6.93 12a2 2 0 001.74 3z" /></svg>
                            Source removed
                          </span>
                        )}
                        <button onClick={() => removeAccount(a.id)} className="text-slate-400 hover:text-red-500 px-1 text-sm flex-shrink-0">×</button>
                      </div>
                      <div className="grid gap-1.5" style={{ gridTemplateColumns: '1.2fr 70px 90px' }}>
                        <select value={a.type} onChange={(e) => updateAccount(a.id, { type: e.target.value })} className="border border-slate-200 rounded px-1.5 py-1.5 text-slate-900 bg-white min-w-0">
                          {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                        <select value={a.owner} onChange={(e) => updateAccount(a.id, { owner: e.target.value })} className="border border-slate-200 rounded px-1.5 py-1.5 text-slate-900 bg-white">
                          {OWNERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <input type="text" inputMode="numeric" placeholder="$0" value={a.balance ? fmt(a.balance) : ''} onChange={(e) => updateAccount(a.id, { balance: parseMoney(e.target.value) })} className="border border-slate-200 rounded px-2 py-1.5 text-slate-900 text-right" />
                      </div>

                      {a.linkedAccount && !orphaned && (
                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                          <span>
                            Last synced: {timeAgo(a.linkedAccount.sourceUpdatedAt)}
                            {stale && <span className="text-amber-600"> · Updated since</span>}
                          </span>
                          <button onClick={() => unlinkAccount(a.id)} className="text-slate-500 hover:text-slate-700 underline">Unlink</button>
                        </div>
                      )}

                      {orphaned && (
                        <div className="flex items-center gap-2 text-[10px] text-red-600">
                          <span>Original source removed — using last known balance.</span>
                          {eligibleExisting.length > 0 && (
                            <button onClick={() => setLinkingAccountId(linkingAccountId === a.id ? null : a.id)} className="text-blue-600 hover:text-blue-700 underline">Re-link</button>
                          )}
                          <button onClick={() => updateAccount(a.id, { linkedAccount: null })} className="text-slate-600 hover:text-slate-700 underline">Convert to freeform</button>
                        </div>
                      )}

                      {!a.linkedAccount && (
                        <div className="flex items-center justify-between gap-2">
                          <label className="flex items-center gap-2 text-[11px] text-slate-500 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={!!a.mirrorOnSave}
                              onChange={(e) => updateAccount(a.id, { mirrorOnSave: e.target.checked })}
                              className="rounded border-slate-300"
                            />
                            Also add to my net worth dashboard on save
                          </label>
                          {eligibleExisting.length > 0 && (
                            <button onClick={() => setLinkingAccountId(linkingAccountId === a.id ? null : a.id)} className="text-[11px] text-blue-600 hover:text-blue-700 underline whitespace-nowrap">
                              Link to existing
                            </button>
                          )}
                        </div>
                      )}

                      {linkingAccountId === a.id && eligibleExisting.length > 0 && (
                        <div className="bg-slate-50 border border-slate-200 rounded p-2 space-y-1.5">
                          <p className="text-[11px] text-slate-700">Link &ldquo;{a.name || 'this account'}&rdquo; to which existing account?</p>
                          {eligibleExisting.map((e) => (
                            <button
                              key={`${e.source}:${e.sourceId}`}
                              onClick={() => linkAccountTo(a.id, e)}
                              className="w-full text-left flex items-center justify-between gap-2 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded px-2 py-1.5 text-[11px] transition-colors"
                            >
                              <span className="truncate">
                                <span className="text-slate-900 font-medium">{e.name}</span>
                                {e.institution && <span className="text-slate-500"> · {e.institution}</span>}
                                <span className="text-slate-400"> · {e.source === 'plaid' ? 'Plaid' : 'Manual'}</span>
                              </span>
                              <span className="text-slate-700 tabular-nums whitespace-nowrap">{fmt(e.balance)}</span>
                            </button>
                          ))}
                          <button onClick={() => setLinkingAccountId(null)} className="text-[10px] text-slate-500 hover:text-slate-700">Cancel</button>
                        </div>
                      )}
                    </div>
                    )
                  })()
                ))}
              </Section>

              <Section title="Retirement Income Sources">
                <p className="text-xs text-slate-500 leading-relaxed">Pensions, annuities, rental income, and part-time work go here alongside Social Security. These are income streams that pay you monthly — not assets you draw from.</p>
                <p className="text-xs text-slate-500 leading-relaxed mt-2">Social Security information below feeds into your plan automatically. Other income sources can be added and customized as needed.</p>

                <h3 className="text-xs font-semibold text-slate-700 mt-4">Social Security</h3>
                <div>
                  <MF label="Your projected monthly Social Security" value={inputs.socialSecurityAmount} onChange={(v) => setInput('socialSecurityAmount', v)} />
                  <SSHelper annualIncome={inputs.userAnnualIncome} currentAge={derivedAge} />
                </div>
                <NF label="Your SS start age" value={inputs.socialSecurityAge} min={62} max={70} onChange={(v) => setInput('socialSecurityAge', v)} tooltip={FIELD_TOOLTIPS.socialSecurityAge} />
                {inputs.spouseEnabled && <>
                  <div>
                    <MF label="Spouse's projected monthly Social Security" value={inputs.spouseSSAmount} onChange={(v) => setInput('spouseSSAmount', v)} />
                    <SSHelper annualIncome={inputs.spouseAnnualIncome} currentAge={derivedSpouseAge} isSpouse />
                  </div>
                  <NF label="Spouse SS start age" value={inputs.spouseSSAge} min={62} max={70} onChange={(v) => setInput('spouseSSAge', v)} tooltip={FIELD_TOOLTIPS.spouseSSAge} />
                </>}

                <div className="border-t border-slate-100 my-3" />
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-700">Other income sources</h3>
                  <button onClick={addIncomeSource} className="text-xs font-medium text-emerald-600">+ Add</button>
                </div>
                {inputs.incomeSources.map((s) => (
                  <div key={s.id} className="border border-slate-200 rounded-lg p-2 space-y-2 text-xs">
                    <label className="block">
                      <span className="flex items-center text-xs text-slate-600 mb-1">
                        Description<InfoTip>{FIELD_TOOLTIPS.incomeSourceDescription}</InfoTip>
                        <button onClick={() => removeIncomeSource(s.id)} className="ml-auto text-slate-400 hover:text-red-500 text-sm leading-none">×</button>
                      </span>
                      <input type="text" value={s.description} onChange={(e) => updateIncomeSource(s.id, { description: e.target.value })} placeholder="Description" className="w-full border border-slate-200 rounded px-2 py-1.5 text-slate-900" />
                    </label>
                    <label className="block">
                      <span className="block text-xs text-slate-600 mb-1">Monthly amount<InfoTip>{FIELD_TOOLTIPS.incomeSourceAmount}</InfoTip></span>
                      <input type="text" inputMode="numeric" placeholder="$/mo" value={s.amount ? fmt(s.amount) : ''} onChange={(e) => updateIncomeSource(s.id, { amount: parseMoney(e.target.value) })} className="w-full border border-slate-200 rounded px-2 py-1.5 text-slate-900" />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="block text-xs text-slate-600 mb-1">Start age<InfoTip>{FIELD_TOOLTIPS.incomeSourceStartAge}</InfoTip></span>
                        <input type="number" value={s.startAge} onChange={(e) => updateIncomeSource(s.id, { startAge: parseInt(e.target.value) || 0 })} className="w-full border border-slate-200 rounded px-2 py-1.5 text-slate-900" />
                      </label>
                      <label className="block">
                        <span className="block text-xs text-slate-600 mb-1">End age<InfoTip>{FIELD_TOOLTIPS.incomeSourceEndAge}</InfoTip></span>
                        <input type="number" value={s.endAge} onChange={(e) => updateIncomeSource(s.id, { endAge: parseInt(e.target.value) || 0 })} className="w-full border border-slate-200 rounded px-2 py-1.5 text-slate-900" />
                      </label>
                    </div>
                    <label className="block">
                      <span className="block text-xs text-slate-600 mb-1">Dollar type<InfoTip>{FIELD_TOOLTIPS.incomeSourceDollarType}</InfoTip></span>
                      <select value={s.dollarType} onChange={(e) => updateIncomeSource(s.id, { dollarType: e.target.value })} className="w-full border border-slate-200 rounded px-2 py-1.5 text-slate-900 bg-white">
                        <option value="today">Today&apos;s dollars</option>
                        <option value="future">Start-age dollars</option>
                      </select>
                    </label>
                    <Tog label="Inflation-adjusted (COLA)" checked={s.inflationAdjust} onChange={(v) => updateIncomeSource(s.id, { inflationAdjust: v })} tooltip={FIELD_TOOLTIPS.incomeSourceInflationAdjust} />
                  </div>
                ))}
              </Section>

              <Section title="Major expenses" right={<button onClick={addMajorExpense} className="text-xs font-medium text-red-600">+ Add</button>}>
                <p className="text-xs text-slate-500 leading-relaxed">One-time expenses during retirement: a new roof, car replacement, wedding, college tuition for a grandchild, or a bucket-list trip. These are separate from your regular annual spending.</p>
                {inputs.majorExpenses.map((e) => (
                  <div key={e.id} className="border border-slate-200 rounded-lg p-2 space-y-1.5 text-xs">
                    <div className="flex gap-1.5">
                      <input type="text" value={e.description} onChange={(ev) => updateMajorExpense(e.id, { description: ev.target.value })} placeholder="Description" className="flex-1 border border-slate-200 rounded px-2 py-1.5 text-slate-900" />
                      <button onClick={() => removeMajorExpense(e.id)} className="text-slate-400 hover:text-red-500 px-1">×</button>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <input type="text" inputMode="numeric" placeholder="Amount" value={e.amount ? fmt(e.amount) : ''} onChange={(ev) => updateMajorExpense(e.id, { amount: parseMoney(ev.target.value) })} className="border border-slate-200 rounded px-1.5 py-1.5 text-slate-900" />
                      <input type="number" placeholder="Age" value={e.age} onChange={(ev) => updateMajorExpense(e.id, { age: parseInt(ev.target.value) || 0 })} className="border border-slate-200 rounded px-1.5 py-1.5 text-slate-900" />
                      <select value={e.dollarType} onChange={(ev) => updateMajorExpense(e.id, { dollarType: ev.target.value })} className="border border-slate-200 rounded px-1.5 py-1.5 text-slate-900 bg-white">
                        <option value="today">Today&apos;s $</option>
                        <option value="future">Future $</option>
                      </select>
                    </div>
                  </div>
                ))}
              </Section>

              <Section title="Lump sum">
                <p className="text-xs text-slate-500 leading-relaxed">Money you expect to receive at a specific age — an inheritance, business sale, home downsize, or insurance payout. It&apos;s added to your brokerage account when received.</p>
                <Tog label="Expecting lump sum" checked={inputs.expectLumpSum} onChange={(v) => setInput('expectLumpSum', v)} />
                {inputs.expectLumpSum && <div className="grid grid-cols-2 gap-2"><MF label="Amount (future $)" value={inputs.lumpSumAmount} onChange={(v) => setInput('lumpSumAmount', v)} /><NF label="Age received" value={inputs.lumpSumAge} min={derivedAge} max={inputs.lifeExpectancy} onChange={(v) => setInput('lumpSumAge', v)} /></div>}
              </Section>

              <Section title="Growth assumptions">
                <NF label="Pre-retirement return (%)" value={inputs.preRetirementReturn} min={0} max={15} step={0.25} onChange={(v) => setInput('preRetirementReturn', v)} tooltip={FIELD_TOOLTIPS.preRetirementReturn} />
                <NF label="Post-retirement return (%)" value={inputs.postRetirementReturn} min={0} max={15} step={0.25} onChange={(v) => setInput('postRetirementReturn', v)} tooltip={FIELD_TOOLTIPS.postRetirementReturn} />
                <NF label="Inflation (%)" value={inputs.inflationRate} min={0} max={10} step={0.25} onChange={(v) => setInput('inflationRate', v)} tooltip={FIELD_TOOLTIPS.inflationRate} />
                <NF label="Final balance target (%)" value={inputs.retirementBalanceGoal} min={0} max={200} step={5} onChange={(v) => setInput('retirementBalanceGoal', v)} tooltip={FIELD_TOOLTIPS.retirementBalanceGoal} />
              </Section>

              <Section title="Tax assumptions">
                <p className="text-xs text-slate-500 leading-relaxed">Federal taxes are modeled using 2026 brackets and the standard deduction. Enter your effective state income tax rate below.</p>
                <NF label="State income tax rate (%)" value={inputs.stateTaxRate} min={0} max={15} step={0.25} onChange={(v) => setInput('stateTaxRate', v)} tooltip={FIELD_TOOLTIPS.stateTaxRate} />
              </Section>

              {!hasSaved && (
                <div className="flex gap-2">
                  <button onClick={saveScenario} disabled={saveState === 'saving'} className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-medium px-4 py-2 rounded-lg">
                    {saveLabel}
                  </button>
                </div>
              )}
            </div>
          )}
        </aside>

        {/* CENTER — Results */}
        <main className="flex-1 min-w-0 order-1 lg:order-2 space-y-5">
          {!valid ? (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8 text-center">
              <p className="text-slate-500">Enter your birth date and add at least one account to see your plan.</p>
            </div>
          ) : (
            <>
              {nudgeVisible && !demoActive && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-start justify-between gap-3">
                  <p className="text-sm text-slate-700">
                    <span className="font-semibold">Your plan is live.</span> Review your assumptions in the sidebar — you can adjust growth rates, add major expenses, model lump sums, and more.
                  </p>
                  <button onClick={dismissNudge} aria-label="Dismiss" className="text-slate-400 hover:text-slate-600 text-lg leading-none flex-shrink-0">×</button>
                </div>
              )}
              {/* Monte Carlo hero */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-slate-500 mb-1">Probability of success</p>
                    <p className={`text-6xl font-bold tracking-tight ${probColor}`}>
                      {probPct !== null ? `${probPct}%` : '—'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">Based on 1,000 Monte Carlo simulations</p>
                  </div>
                  <div className={`px-3 py-1 rounded-full text-xs font-medium ${results.runOutAge === null ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                    {results.runOutAge === null ? 'On track' : `Runs out at ${results.runOutAge}`}
                  </div>
                </div>

                {monte && (
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    {[{ l: '25th percentile', v: monte.p25, c: 'text-red-600' }, { l: 'Median', v: monte.p50, c: 'text-slate-800' }, { l: '75th percentile', v: monte.p75, c: 'text-emerald-600' }].map((b) => (
                      <div key={b.l} className="text-center">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider">{b.l}</p>
                        <p className={`text-sm font-bold ${b.c}`}>{fmtCompact(inputs.showFutureDollars ? b.v : b.v / Math.pow(1 + infl, inputs.lifeExpectancy - derivedAge))}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Plan summary */}
              <PlanSummary
                inputs={inputs}
                monte={monte}
                currentBalance={totals.investable}
                retirementBalance={dispBal(results.retirementBalance, ytr)}
                finalBalance={dispBal(results.finalBalance, inputs.lifeExpectancy - derivedAge)}
                sustainableIncome={dispBal(fourPct, ytr)}
                withdrawalRate={wrRate}
                probPct={probPct}
                firstYearNetSpending={taxSummary.firstYearNetSpending}
                firstYearNetSpendingMonthly={taxSummary.firstYearNetSpendingMonthly}
                firstYearTaxes={taxSummary.firstYearTaxes}
                totalLifetimeTaxes={taxSummary.totalLifetimeTaxes}
              />

              {/* Key stats */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <StatCard label="At retirement" value={fmt(dispBal(results.retirementBalance, ytr))} sub={`Age ${inputs.retirementAge}`} />
                <StatCard label="At life expectancy" value={fmt(dispBal(results.finalBalance, inputs.lifeExpectancy - derivedAge))} sub={`Age ${inputs.lifeExpectancy}`} />
                <StatCard label="Take-home spending" value={`${fmt(taxSummary.firstYearNetSpendingMonthly)}/mo`} sub={`Annual: ${fmt(taxSummary.firstYearNetSpending)} (today's $)`} />
                <StatCard label="Sustainable income" value={fmt(dispBal(fourPct, ytr))} sub="4% rule (gross)" />
                <StatCard label="Withdrawal rate" value={`${wrRate}%`} sub={Number(wrRate) > 5 ? 'Above safe threshold' : 'Within safe range'} warn={Number(wrRate) > 5} />
                <StatCard label="Lifetime taxes (retirement)" value={fmt(taxSummary.totalLifetimeTaxes)} sub="Federal + state" />
              </div>

              {/* Portfolio projection chart */}
              {chartData.length > 1 && (
                <div id="pdf-chart-projection" className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">Portfolio projection</h3>
                      <p className="text-xs text-slate-500">{inputs.showFutureDollars ? 'Future' : "Today's"} dollars</p>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
                      <input type="checkbox" checked={inputs.showFutureDollars} onChange={(e) => setInput('showFutureDollars', e.target.checked)} className="rounded border-slate-300" />
                      Future dollars
                    </label>
                  </div>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                        <defs>
                          <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.01} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="age" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={fmtCompact} width={55} />
                        <Tooltip content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload
                          return <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-lg text-sm"><p className="text-slate-500 text-xs">Age {d.age}</p><p className="text-slate-900 font-semibold">{fmt(d.balance)}</p></div>
                        }} />
                        <ReferenceLine x={inputs.retirementAge} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'Retire', fill: '#94a3b8', fontSize: 10, position: 'top' }} />
                        <Area type="monotone" dataKey="balance" stroke="#3b82f6" strokeWidth={2} fill="url(#projGrad)" dot={false} activeDot={{ r: 4, fill: '#3b82f6', stroke: '#fff', strokeWidth: 2 }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Portfolio composition chart */}
              {compositionChart.length > 1 && (
                <div id="pdf-chart-composition" className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">Portfolio composition</h3>
                      <p className="text-xs text-slate-500">How your accounts shift over time, {inputs.showFutureDollars ? 'future' : "today's"} dollars</p>
                    </div>
                  </div>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={compositionChart} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                        <CartesianGrid stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="age" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                        <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={fmtCompact} width={55} />
                        <Tooltip content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload
                          const rows = [
                            { label: 'Pretax', value: d.pretax, color: '#60a5fa' },
                            { label: 'Roth', value: d.roth, color: '#10b981' },
                            { label: 'Brokerage', value: d.brokerage, color: '#f59e0b' },
                            { label: 'Cash', value: d.cash, color: '#6b7280' },
                          ].filter((r) => Math.round(r.value) > 0)
                          const total = rows.reduce((a, r) => a + r.value, 0)
                          return (
                            <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-lg text-sm min-w-[200px]">
                              <p className="text-slate-500 text-xs mb-1">Age {d.age}</p>
                              {rows.map((r) => (
                                <div key={r.label} className="flex justify-between gap-4 items-center">
                                  <span className="flex items-center gap-1.5 text-slate-500 text-xs">
                                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: r.color }} />
                                    {r.label}
                                  </span>
                                  <span className="text-slate-900">{fmt(r.value)}</span>
                                </div>
                              ))}
                              <div className="flex justify-between gap-4 border-t border-slate-100 mt-1 pt-1">
                                <span className="text-slate-500 text-xs">Total</span>
                                <span className="text-slate-900 font-semibold">{fmt(total)}</span>
                              </div>
                            </div>
                          )
                        }} />
                        <Legend content={({ payload }) => (
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
                            {(payload || []).map((entry) => (
                              <span key={entry.value} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
                                {entry.value}
                              </span>
                            ))}
                          </div>
                        )} />
                        <ReferenceLine x={inputs.retirementAge} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'Retire', fill: '#94a3b8', fontSize: 10, position: 'top' }} />
                        <Area type="monotone" dataKey="pretax" name="Pretax" stackId="1" stroke="#3b82f6" strokeWidth={1} fill="#60a5fa" />
                        <Area type="monotone" dataKey="roth" name="Roth" stackId="1" stroke="#059669" strokeWidth={1} fill="#10b981" />
                        <Area type="monotone" dataKey="brokerage" name="Brokerage" stackId="1" stroke="#d97706" strokeWidth={1} fill="#f59e0b" />
                        <Area type="monotone" dataKey="cash" name="Cash" stackId="1" stroke="#4b5563" strokeWidth={1} fill="#6b7280" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Retirement cash flow stacked bar chart */}
              {incomeChart.data.length > 1 && incomeChart.series.length > 0 && (
                <div id="pdf-chart-cashflow" className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">Retirement cash flow</h3>
                      <p className="text-xs text-slate-500">How each year&apos;s spending is funded, {inputs.showFutureDollars ? 'future' : "today's"} dollars</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
                        <input type="checkbox" checked={showPreRetirement} onChange={(e) => setShowPreRetirement(e.target.checked)} className="rounded border-slate-300" />
                        Show pre-retirement
                      </label>
                    </div>
                  </div>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={incomeChart.data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                        <CartesianGrid stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="age" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                        <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={fmtCompact} width={55} />
                        <Tooltip content={<IncomeTooltip series={incomeChart.series} />} />
                        <Legend
                          content={({ payload }) => (
                            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
                              {(payload || []).map((entry) => (
                                <span key={entry.value} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                                  {entry.type === 'line' ? (
                                    <span className="inline-block w-4 h-0.5" style={{ backgroundColor: entry.color }} />
                                  ) : (
                                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
                                  )}
                                  {entry.value}
                                </span>
                              ))}
                            </div>
                          )}
                        />
                        {showPreRetirement && (
                          <ReferenceLine x={inputs.retirementAge} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'Retire', fill: '#94a3b8', fontSize: 10, position: 'top' }} />
                        )}
                        {incomeChart.series.map((s) => (
                          <Bar key={s.key} dataKey={s.key} stackId="income" fill={s.color} name={s.label} />
                        ))}
                        <Line type="monotone" dataKey="totalExpenses" stroke="#1e293b" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#1e293b', stroke: '#fff', strokeWidth: 2 }} name="Total expenses" connectNulls={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Inflows vs Outflows chart */}
              {cashFlowChart.length > 1 && (
                <div id="pdf-chart-inflows" className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">Inflows vs Outflows</h3>
                      <p className="text-xs text-slate-500">Retirement years, {inputs.showFutureDollars ? 'future' : "today's"} dollars</p>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
                      <input type="checkbox" checked={inputs.showFutureDollars} onChange={(e) => setInput('showFutureDollars', e.target.checked)} className="rounded border-slate-300" />
                      Future dollars
                    </label>
                  </div>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={cashFlowChart} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                        <CartesianGrid stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="age" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                        <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={fmtCompact} width={55} />
                        <Tooltip content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload
                          const gap = (d.totalOutflows || 0) - (d.totalInflows || 0)
                          return (
                            <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-lg text-sm min-w-[200px]">
                              <p className="text-slate-500 text-xs mb-1">Age {d.age}</p>
                              <div className="flex justify-between gap-4 items-center">
                                <span className="flex items-center gap-1.5 text-slate-500 text-xs"><span className="inline-block w-3 h-0.5" style={{ backgroundColor: '#10b981' }} />Total inflows</span>
                                <span className="text-slate-900">{fmt(d.totalInflows)}</span>
                              </div>
                              <div className="flex justify-between gap-4 items-center">
                                <span className="flex items-center gap-1.5 text-slate-500 text-xs"><span className="inline-block w-3 h-0.5" style={{ backgroundColor: '#ef4444' }} />Total outflows</span>
                                <span className="text-slate-900">{fmt(d.totalOutflows)}</span>
                              </div>
                              <div className="flex justify-between gap-4 border-t border-slate-100 mt-1 pt-1">
                                <span className="text-slate-500 text-xs">Gap</span>
                                <span className={`font-semibold ${gap > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{gap > 0 ? '+' : ''}{fmt(gap)}</span>
                              </div>
                            </div>
                          )
                        }} />
                        <Legend content={({ payload }) => (
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
                            {(payload || []).map((entry) => (
                              <span key={entry.value} className="flex items-center gap-1.5 text-[11px] text-slate-600">
                                <span className="inline-block w-4 h-0.5" style={{ backgroundColor: entry.color }} />
                                {entry.value}
                              </span>
                            ))}
                          </div>
                        )} />
                        <Line type="monotone" dataKey="totalInflows" name="Total Inflows" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#10b981', stroke: '#fff', strokeWidth: 2 }} />
                        <Line type="monotone" dataKey="totalOutflows" name="Total Outflows" stroke="#ef4444" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#ef4444', stroke: '#fff', strokeWidth: 2 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

            </>
          )}
        </main>

        {/* RIGHT — Advisor */}
        <aside className="w-full lg:w-[260px] flex-shrink-0 order-3">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-900">Insights</h2>
            </div>
            {advisorPrompts.length > 0 ? (
              <div className="divide-y divide-slate-100">
                {advisorPrompts.map((p) => (
                  <div key={p.id} className="px-4 py-3">
                    <h3 className="text-xs font-semibold text-slate-800 mb-1">{p.title}</h3>
                    <p className="text-[11px] text-slate-500 leading-relaxed mb-2">{p.message}</p>
                    <button className="text-[11px] font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md px-2 py-1">Talk to an advisor</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-slate-400">No insights yet — complete your plan to see personalized recommendations.</p>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Year-by-year detail — full width below the 3-column layout */}
      {valid && results && (
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pb-6">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <button onClick={() => setShowBreakdown(!showBreakdown)} className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <span>{showBreakdown ? 'Hide year-by-year detail' : 'Show year-by-year detail'}</span>
              <svg className={`w-4 h-4 text-slate-400 transition-transform ${showBreakdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
            </button>
            {showBreakdown && (
              <CashFlowTable results={results} inputs={inputs} dispBal={dispBal} />
            )}
          </div>
        </div>
      )}
      </>
      )}

      {pendingSwitchId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-2">Unsaved changes</h3>
            <p className="text-sm text-slate-600 mb-4">You have unsaved changes to <span className="font-medium text-slate-900">{activeScenario?.name || 'this scenario'}</span>. Save them first?</p>
            <div className="flex flex-col gap-2">
              <button onClick={confirmSwitchSave} className="bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-3 py-2 rounded-lg">Save and switch</button>
              <button onClick={confirmSwitchDiscard} className="border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium px-3 py-2 rounded-lg">Discard and switch</button>
              <button onClick={confirmSwitchCancel} className="text-slate-500 hover:text-slate-700 text-sm font-medium px-3 py-2">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ProgressIndicator({ step, total }) {
  return (
    <div className="flex items-center gap-3 mb-4 justify-center">
      <span className="text-xs text-slate-400 uppercase tracking-wider">Step {step} of {total}</span>
      <div className="flex gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={`w-1.5 h-1.5 rounded-full ${i < step ? 'bg-blue-500' : 'bg-slate-200'}`} />
        ))}
      </div>
    </div>
  )
}

function OnboardingFlow({ inputs, setInputs, setInput, existingAccounts, importExistingAccounts, derivedAge, derivedSpouseAge, onLoadDemo, taxSummary, planValid }) {
  const [step, setStep] = useState(1)
  const [stepError, setStepError] = useState(null)

  const step1Valid =
    inputs.birthDate &&
    derivedAge >= 10 && derivedAge <= 110 &&
    inputs.retirementAge > derivedAge &&
    inputs.lifeExpectancy > inputs.retirementAge &&
    (!inputs.spouseEnabled || (inputs.spouseBirthDate && derivedSpouseAge >= 10 && inputs.spouseRetirementAge > derivedSpouseAge))

  const advanceFromStep1 = () => {
    if (!step1Valid) {
      if (!inputs.birthDate) setStepError('Enter your birth date to continue.')
      else if (derivedAge < 10 || derivedAge > 110) setStepError('Birth date looks off — double check.')
      else if (inputs.retirementAge <= derivedAge) setStepError('Retirement age must be after your current age.')
      else if (inputs.lifeExpectancy <= inputs.retirementAge) setStepError('Life expectancy must be greater than retirement age.')
      else if (inputs.spouseEnabled && !inputs.spouseBirthDate) setStepError("Enter your spouse's birth date.")
      else if (inputs.spouseEnabled && inputs.spouseRetirementAge <= derivedSpouseAge) setStepError("Spouse's retirement age must be after their current age.")
      return
    }
    setStepError(null)
    setStep(2)
  }

  const zeroIncomeAndSavings =
    (inputs.userAnnualIncome || 0) === 0 &&
    (inputs.userMonthlySavings || 0) === 0 &&
    (!inputs.spouseEnabled || ((inputs.spouseAnnualIncome || 0) === 0 && (inputs.spouseMonthlySavings || 0) === 0))

  const [showIncomeForm, setShowIncomeForm] = useState(false)
  const blankIncomeForm = () => ({
    description: '',
    amount: 0,
    startAge: inputs.retirementAge,
    endAge: inputs.lifeExpectancy,
    dollarType: 'today',
    inflationAdjust: true,
  })
  const [incomeForm, setIncomeForm] = useState(blankIncomeForm)

  const commitIncomeSource = () => {
    if (!incomeForm.description.trim() || incomeForm.amount <= 0) return
    setInputs((p) => ({
      ...p,
      incomeSources: [...(p.incomeSources || []), { id: crypto.randomUUID(), ...incomeForm }],
    }))
    setIncomeForm(blankIncomeForm())
    setShowIncomeForm(false)
  }
  const removeIncomeSource = (id) => setInputs((p) => ({ ...p, incomeSources: (p.incomeSources || []).filter((s) => s.id !== id) }))

  const initialStep4View = existingAccounts.length > 0 ? 'existing' : 'decide'
  const [step4View, setStep4View] = useState(initialStep4View)
  const [chosen, setChosen] = useState(() => new Set(existingAccounts.map((e) => `${e.source}:${e.sourceId}`)))
  const blankRow = () => ({ id: crypto.randomUUID(), name: '', type: '401k', owner: 'self', balance: 0 })
  const [manualRows, setManualRows] = useState(() => [blankRow(), blankRow(), blankRow()])
  const updateRow = (id, patch) => setManualRows((p) => p.map((r) => r.id === id ? { ...r, ...patch } : r))
  const removeRow = (id) => setManualRows((p) => p.filter((r) => r.id !== id))
  const addRow = () => setManualRows((p) => [...p, blankRow()])
  const anyRowBalance = manualRows.some((r) => r.balance > 0)
  const commitManualRows = () => {
    const kept = manualRows.filter((r) => r.balance > 0)
    if (kept.length === 0) return
    const typeCounts = {}
    const toAdd = kept.map((r) => {
      const label = TYPE_META[r.type]?.label || 'Account'
      if (r.name.trim()) return { id: crypto.randomUUID(), name: r.name.trim(), type: r.type, owner: r.owner, balance: r.balance }
      typeCounts[r.type] = (typeCounts[r.type] || 0) + 1
      const name = typeCounts[r.type] === 1 ? label : `${label} #${typeCounts[r.type]}`
      return { id: crypto.randomUUID(), name, type: r.type, owner: r.owner, balance: r.balance }
    })
    setInputs((p) => ({ ...p, accounts: [...p.accounts, ...toAdd] }))
  }

  const headings = {
    1: { title: 'Tell us about you', sub: 'We need a few pieces of information to build your plan.', caption: 'About you' },
    2: { title: 'Your income and savings', sub: 'What you earn today and what you set aside each month.', caption: 'Your money today' },
    3: { title: 'Your retirement income', sub: 'What income do you expect in retirement? Include Social Security and any pensions, annuities, or part-time work.', caption: 'Retirement income' },
    4: { title: 'Your accounts', sub: 'Tell us about the accounts that will fund your retirement.', caption: 'Your accounts' },
  }
  const head = headings[step]

  return (
    <div className="max-w-[700px] mx-auto px-4 py-10 sm:py-14">
      <div className="text-center">
        <ProgressIndicator step={step} total={4} />
        <h1 className="text-2xl font-bold text-slate-900">{head.title}</h1>
        <p className="text-base text-slate-500 mt-2 mb-6">{head.sub}</p>
      </div>

      {step === 1 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-5">
          <div>
            <p className="text-xs text-slate-600 mb-2">Planning for</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setInput('spouseEnabled', false)} className={`flex-1 rounded-lg border p-3 text-sm font-medium transition-colors ${!inputs.spouseEnabled ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>Just me</button>
              <button type="button" onClick={() => setInput('spouseEnabled', true)} className={`flex-1 rounded-lg border p-3 text-sm font-medium transition-colors ${inputs.spouseEnabled ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>Me and my spouse</button>
            </div>
          </div>

          <label className="block text-xs text-slate-600">
            <span className="block mb-1">Your birth date</span>
            <input type="date" value={inputs.birthDate} onChange={(e) => setInput('birthDate', e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400" />
            {inputs.birthDate && <span className="text-[10px] text-slate-500 mt-1 block">Age {derivedAge}</span>}
          </label>

          <NF label="When do you want to retire?" value={inputs.retirementAge} min={40} max={90} onChange={(v) => setInput('retirementAge', v)} tooltip={FIELD_TOOLTIPS.retirementAge} />

          {inputs.spouseEnabled && (
            <>
              <label className="block text-xs text-slate-600">
                <span className="block mb-1">Spouse birth date</span>
                <input type="date" value={inputs.spouseBirthDate || ''} onChange={(e) => setInput('spouseBirthDate', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400" />
                {inputs.spouseBirthDate && <span className="text-[10px] text-slate-500 mt-1 block">Age {derivedSpouseAge}</span>}
              </label>
              <NF label="Spouse retirement age" value={inputs.spouseRetirementAge} min={40} max={90} onChange={(v) => setInput('spouseRetirementAge', v)} tooltip={FIELD_TOOLTIPS.spouseRetirementAge} />
            </>
          )}

          <NF label="Life expectancy" value={inputs.lifeExpectancy} min={50} max={120} onChange={(v) => setInput('lifeExpectancy', v)} tooltip={FIELD_TOOLTIPS.lifeExpectancy} />

          {stepError && <p className="text-xs text-red-500">{stepError}</p>}

          <div className="flex justify-end pt-2">
            <button type="button" onClick={advanceFromStep1} className="bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">
              Continue →
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-5">
          <p className="text-xs text-slate-500">All amounts in today&apos;s dollars.</p>
          <div>
            <MF label={inputs.spouseEnabled ? 'Your annual income' : 'Your annual income'} value={inputs.userAnnualIncome} onChange={(v) => setInput('userAnnualIncome', v)} tooltip={FIELD_TOOLTIPS.userAnnualIncome} />
          </div>
          <div>
            <MF label="Your monthly savings" value={inputs.userMonthlySavings} onChange={(v) => setInput('userMonthlySavings', v)} />
            <HelperText>{FIELD_HELP.userMonthlySavings}</HelperText>
          </div>
          {inputs.spouseEnabled && <>
            <div>
              <MF label="Spouse annual income" value={inputs.spouseAnnualIncome} onChange={(v) => setInput('spouseAnnualIncome', v)} tooltip={FIELD_TOOLTIPS.spouseAnnualIncome} />
            </div>
            <div>
              <MF label="Spouse monthly savings" value={inputs.spouseMonthlySavings} onChange={(v) => setInput('spouseMonthlySavings', v)} />
              <HelperText>{FIELD_HELP.spouseMonthlySavings}</HelperText>
            </div>
          </>}
          <Tog label="Increase savings yearly" checked={inputs.increaseSavings} onChange={(v) => setInput('increaseSavings', v)} tooltip={FIELD_TOOLTIPS.increaseSavings} />
          {inputs.increaseSavings && <NF label="Annual increase (%)" value={inputs.savingsIncreaseRate} min={0} max={20} step={0.5} onChange={(v) => setInput('savingsIncreaseRate', v)} />}

          {zeroIncomeAndSavings && (
            <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">
              You can proceed with zeros, but your plan will assume no future income or savings.
            </p>
          )}

          <div className="flex justify-between items-center pt-2">
            <button type="button" onClick={() => { setStepError(null); setStep(1) }} className="text-xs text-slate-500 hover:text-slate-700">← Back</button>
            <button type="button" onClick={() => setStep(3)} className="bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">Continue →</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-5">
          <div>
            <MF label={inputs.spouseEnabled ? 'Combined annual income needed' : 'Annual income needed'} value={inputs.retirementIncomeNeeded} onChange={(v) => setInput('retirementIncomeNeeded', v)} />
            <HelperText>{FIELD_HELP.retirementIncomeNeeded}</HelperText>
            {planValid && taxSummary && taxSummary.firstYearNetSpending > 0 && (
              <p className="text-xs text-slate-600 leading-relaxed mt-1">
                Your take-home spending: ~<span className="font-medium text-slate-800">{fmt(taxSummary.firstYearNetSpendingMonthly)}/month</span> (<span className="font-medium text-slate-800">{fmt(taxSummary.firstYearNetSpending)}/year</span>) in today&apos;s dollars
              </p>
            )}
          </div>

          <div>
            <MF label="Your projected monthly Social Security" value={inputs.socialSecurityAmount} onChange={(v) => setInput('socialSecurityAmount', v)} />
            <SSHelper annualIncome={inputs.userAnnualIncome} currentAge={derivedAge} />
          </div>
          <NF label="Your SS start age" value={inputs.socialSecurityAge} min={62} max={70} onChange={(v) => setInput('socialSecurityAge', v)} tooltip={FIELD_TOOLTIPS.socialSecurityAge} />

          {inputs.spouseEnabled && <>
            <div>
              <MF label="Spouse's projected monthly Social Security" value={inputs.spouseSSAmount} onChange={(v) => setInput('spouseSSAmount', v)} />
              <SSHelper annualIncome={inputs.spouseAnnualIncome} currentAge={derivedSpouseAge} isSpouse />
            </div>
            <NF label="Spouse SS start age" value={inputs.spouseSSAge} min={62} max={70} onChange={(v) => setInput('spouseSSAge', v)} tooltip={FIELD_TOOLTIPS.spouseSSAge} />
          </>}

          <div className="border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-600 mb-1">Other retirement income</p>
            <p className="text-xs text-slate-500 leading-relaxed mb-3">Pensions, annuities, rental income, and part-time work go here. These are income streams that pay you monthly — not assets you draw from.</p>

            {(inputs.incomeSources || []).length > 0 && (
              <div className="space-y-1.5 mb-3">
                {inputs.incomeSources.map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-xs bg-slate-50 rounded-lg px-3 py-2">
                    <span className="text-slate-700">
                      <span className="font-medium">{s.description || 'Income'}</span> — {fmt(s.amount)}/mo, ages {s.startAge}–{s.endAge}
                    </span>
                    <button type="button" onClick={() => removeIncomeSource(s.id)} className="text-slate-400 hover:text-red-500 text-sm leading-none ml-2">×</button>
                  </div>
                ))}
              </div>
            )}

            {!showIncomeForm ? (
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowIncomeForm(true)} className="text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md px-3 py-1.5">
                  {(inputs.incomeSources || []).length > 0 ? '+ Add another' : 'Yes, add one'}
                </button>
                {(inputs.incomeSources || []).length === 0 && (
                  <span className="text-xs text-slate-400 self-center">or skip for now</span>
                )}
              </div>
            ) : (
              <div className="border border-slate-200 rounded-lg p-3 space-y-3 text-xs">
                <label className="block">
                  <span className="block text-xs text-slate-600 mb-1">Description<InfoTip>{FIELD_TOOLTIPS.incomeSourceDescription}</InfoTip></span>
                  <input type="text" placeholder="e.g., Teacher's pension" value={incomeForm.description} onChange={(e) => setIncomeForm((p) => ({ ...p, description: e.target.value }))} className="w-full border border-slate-200 rounded px-2 py-1.5 text-slate-900" />
                </label>
                <label className="block">
                  <span className="block text-xs text-slate-600 mb-1">Monthly amount<InfoTip>{FIELD_TOOLTIPS.incomeSourceAmount}</InfoTip></span>
                  <input type="text" inputMode="numeric" placeholder="$0" value={incomeForm.amount ? fmt(incomeForm.amount) : ''} onChange={(e) => setIncomeForm((p) => ({ ...p, amount: parseMoney(e.target.value) }))} className="w-full border border-slate-200 rounded px-2 py-1.5 text-slate-900" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="block text-xs text-slate-600 mb-1">Start age<InfoTip>{FIELD_TOOLTIPS.incomeSourceStartAge}</InfoTip></span>
                    <input type="number" value={incomeForm.startAge} onChange={(e) => setIncomeForm((p) => ({ ...p, startAge: parseInt(e.target.value) || 0 }))} className="w-full border border-slate-200 rounded px-2 py-1.5 text-slate-900" />
                  </label>
                  <label className="block">
                    <span className="block text-xs text-slate-600 mb-1">End age<InfoTip>{FIELD_TOOLTIPS.incomeSourceEndAge}</InfoTip></span>
                    <input type="number" value={incomeForm.endAge} onChange={(e) => setIncomeForm((p) => ({ ...p, endAge: parseInt(e.target.value) || 0 }))} className="w-full border border-slate-200 rounded px-2 py-1.5 text-slate-900" />
                  </label>
                </div>
                <label className="block">
                  <span className="block text-xs text-slate-600 mb-1">Dollar type<InfoTip>{FIELD_TOOLTIPS.incomeSourceDollarType}</InfoTip></span>
                  <select value={incomeForm.dollarType} onChange={(e) => setIncomeForm((p) => ({ ...p, dollarType: e.target.value }))} className="w-full border border-slate-200 rounded px-2 py-1.5 text-slate-900 bg-white">
                    <option value="today">Today&apos;s dollars</option>
                    <option value="future">Start-age dollars</option>
                  </select>
                </label>
                <Tog label="Inflation-adjusted (COLA)" checked={incomeForm.inflationAdjust} onChange={(v) => setIncomeForm((p) => ({ ...p, inflationAdjust: v }))} tooltip={FIELD_TOOLTIPS.incomeSourceInflationAdjust} />
                <div className="flex items-center gap-2 pt-1">
                  <button type="button" onClick={commitIncomeSource} disabled={!incomeForm.description.trim() || incomeForm.amount <= 0} className="bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 text-white text-xs font-medium px-3 py-1.5 rounded-md">Add</button>
                  <button type="button" onClick={() => { setIncomeForm(blankIncomeForm()); setShowIncomeForm(false) }} className="text-xs text-slate-500 hover:text-slate-700">Cancel</button>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-between items-center pt-2">
            <button type="button" onClick={() => { setStepError(null); setStep(2) }} className="text-xs text-slate-500 hover:text-slate-700">← Back</button>
            <button type="button" onClick={() => setStep(4)} className="bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">Continue →</button>
          </div>
        </div>
      )}

      {step === 4 && step4View === 'existing' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 leading-relaxed text-center -mt-2 mb-2">
            You already have <span className="font-semibold text-slate-900">{existingAccounts.length}</span> account{existingAccounts.length === 1 ? '' : 's'} on your net worth dashboard. Use them for your retirement plan?
          </p>

          <div className="bg-white border-2 border-blue-200 rounded-xl shadow-sm p-6">
            <p className="text-sm font-semibold text-slate-900 mb-1">Use existing accounts</p>
            <p className="text-xs text-slate-500 mb-4">Imports all {existingAccounts.length} account{existingAccounts.length === 1 ? '' : 's'} into your plan with live linking. Balances stay in sync with the dashboard.</p>
            <button type="button" onClick={() => importExistingAccounts()} className="bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              Use existing accounts →
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <p className="text-sm font-semibold text-slate-900 mb-1">Choose which to include</p>
            <p className="text-xs text-slate-500 mb-4">Pick a subset of your dashboard accounts to import.</p>
            <button type="button" onClick={() => setStep4View('choose')} className="border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              Choose which to include →
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <p className="text-sm font-semibold text-slate-900 mb-1">Add new accounts instead</p>
            <p className="text-xs text-slate-500 mb-4">Skip the import and enter accounts fresh in this plan.</p>
            <button type="button" onClick={() => setStep4View('decide')} className="border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              Add new accounts instead →
            </button>
          </div>

          <div className="flex justify-between items-center pt-2">
            <button type="button" onClick={() => setStep(3)} className="text-xs text-slate-500 hover:text-slate-700">← Back</button>
          </div>
        </div>
      )}

      {step === 4 && step4View === 'choose' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 mb-1">Choose accounts to include</h2>
            <p className="text-xs text-slate-500 leading-relaxed">Uncheck any account you don&apos;t want in this retirement plan. Selected accounts will be linked to their dashboard source.</p>
          </div>

          <div className="space-y-1.5">
            {existingAccounts.map((e) => {
              const key = `${e.source}:${e.sourceId}`
              const checked = chosen.has(key)
              return (
                <label key={key} className="flex items-center gap-3 border border-slate-200 rounded-lg px-3 py-2 cursor-pointer hover:bg-slate-50 text-sm">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(ev) => {
                      const next = new Set(chosen)
                      if (ev.target.checked) next.add(key); else next.delete(key)
                      setChosen(next)
                    }}
                    className="rounded border-slate-300"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="text-slate-900 font-medium">{e.name}</span>
                    {e.institution && <span className="text-slate-500 text-xs"> · {e.institution}</span>}
                  </span>
                  <span className="text-slate-700 tabular-nums">{fmt(e.balance)}</span>
                </label>
              )
            })}
          </div>

          <div className="flex justify-between items-center pt-2">
            <button type="button" onClick={() => setStep4View('existing')} className="text-xs text-slate-500 hover:text-slate-700">← Back</button>
            <button
              type="button"
              onClick={() => importExistingAccounts(existingAccounts.filter((e) => chosen.has(`${e.source}:${e.sourceId}`)))}
              disabled={chosen.size === 0}
              className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              Import {chosen.size} account{chosen.size === 1 ? '' : 's'} →
            </button>
          </div>
        </div>
      )}

      {step === 4 && step4View === 'decide' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 leading-relaxed text-center -mt-2 mb-2">
            The fastest way to get started is to enter your account balances manually. If you want automatic updates later, you can connect via Plaid from your dashboard.
          </p>

          <div className="bg-white border-2 border-blue-200 rounded-xl shadow-sm p-6">
            <p className="text-sm font-semibold text-slate-900 mb-1">Enter accounts manually</p>
            <p className="text-xs text-slate-500 mb-4">Takes about 2 minutes. Enter balances for each account you have — retirement, brokerage, and cash. You can refine later.</p>
            <button type="button" onClick={() => setStep4View('manual')} className="bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              Enter accounts →
            </button>
          </div>

          {(() => {
            const plaidExisting = existingAccounts.filter((e) => e.source === 'plaid')
            return plaidExisting.length > 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
              <p className="text-sm font-semibold text-slate-900 mb-1">Use your connected accounts</p>
              <p className="text-xs text-slate-500 mb-4">You have {plaidExisting.length} account{plaidExisting.length === 1 ? '' : 's'} already linked via Plaid. We&apos;ll import the current balances into your plan.</p>
              <button type="button" onClick={() => importExistingAccounts(plaidExisting)} className="border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                Import Plaid accounts →
              </button>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
              <p className="text-sm font-semibold text-slate-900 mb-1">Connect via Plaid instead</p>
              <p className="text-xs text-slate-500 mb-4">Securely syncs balances from your bank, brokerage, and retirement accounts automatically. Setup takes longer (5–10 minutes per institution), but your plan stays up to date without manual work.</p>
              <Link href="/accounts/add" className="inline-block border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                Connect accounts with Plaid →
              </Link>
            </div>
          )
          })()}

          <div className="flex justify-between items-center pt-2">
            <button type="button" onClick={() => existingAccounts.length > 0 ? setStep4View('existing') : setStep(3)} className="text-xs text-slate-500 hover:text-slate-700">← Back</button>
          </div>
        </div>
      )}

      {step === 4 && step4View === 'manual' && (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 mb-1">Your accounts</h2>
            <p className="text-xs text-slate-500 leading-relaxed">Add each account you have, or combine similar accounts if you want to keep it simple. You can always refine later.</p>
            <p className="text-xs text-slate-500 leading-relaxed mt-1">For example: &quot;Fidelity 401(k) — $425,000&quot;, or combine as &quot;All retirement accounts — $680,000&quot;. What matters is the total balance and the tax treatment.</p>
          </div>

          <div className="space-y-2">
            {manualRows.map((r, idx) => (
              <div key={r.id} className="border border-slate-200 rounded-lg p-2 space-y-1.5 text-xs">
                <div className="flex gap-1.5">
                  <input type="text" placeholder={idx === 0 ? 'e.g., Fidelity 401(k)' : 'Account name'} value={r.name} onChange={(e) => updateRow(r.id, { name: e.target.value })} className="flex-1 border border-slate-200 rounded px-2 py-1.5 text-slate-900" />
                  <button type="button" onClick={() => removeRow(r.id)} className="text-slate-400 hover:text-red-500 px-1 text-sm">×</button>
                </div>
                <div className="grid gap-1.5" style={{ gridTemplateColumns: inputs.spouseEnabled ? '1.2fr 80px 100px' : '1.4fr 100px' }}>
                  <select value={r.type} onChange={(e) => updateRow(r.id, { type: e.target.value })} className="border border-slate-200 rounded px-1.5 py-1.5 text-slate-900 bg-white min-w-0">
                    {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  {inputs.spouseEnabled && (
                    <select value={r.owner} onChange={(e) => updateRow(r.id, { owner: e.target.value })} className="border border-slate-200 rounded px-1.5 py-1.5 text-slate-900 bg-white">
                      {OWNERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  )}
                  <input type="text" inputMode="numeric" placeholder="$0" value={r.balance ? fmt(r.balance) : ''} onChange={(e) => updateRow(r.id, { balance: parseMoney(e.target.value) })} className="border border-slate-200 rounded px-2 py-1.5 text-slate-900 text-right" />
                </div>
              </div>
            ))}
          </div>

          <button type="button" onClick={addRow} className="text-xs font-medium text-blue-600 hover:text-blue-700">
            + Add another account
          </button>

          {!anyRowBalance && (
            <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">
              Enter at least one account to continue. You can skip accounts Plaid doesn&apos;t cover and add them later in the full plan.
            </p>
          )}

          <div className="flex justify-between items-center pt-2">
            <button type="button" onClick={() => setStep4View('decide')} className="text-xs text-slate-500 hover:text-slate-700">← Back to account options</button>
            <button type="button" onClick={commitManualRows} disabled={!anyRowBalance} className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">
              Continue →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, right, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {right}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}
function InfoTip({ children }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  return (
    <span ref={ref} className="relative inline-block ml-1 align-middle">
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); setOpen(!open) }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="text-slate-400 hover:text-slate-600 cursor-help"
        aria-label="More info"
      >
        <svg className="w-3.5 h-3.5 inline" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <span className="absolute left-5 top-0 z-20 w-64 bg-slate-800 text-white text-xs font-normal leading-relaxed rounded-lg p-3 shadow-lg">
          {children}
        </span>
      )}
    </span>
  )
}

function NF({ label, value, min, max, step, onChange, tooltip }) {
  return (
    <label className="block text-xs text-slate-600">
      <span className="block mb-0.5">
        {label}
        {tooltip && <InfoTip>{tooltip}</InfoTip>}
      </span>
      <input type="number" value={value} min={min} max={max} step={step || 1} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400" />
    </label>
  )
}
function MF({ label, value, onChange, tooltip }) {
  return (
    <label className="block text-xs text-slate-600">
      <span className="block mb-0.5">
        {label}
        {tooltip && <InfoTip>{tooltip}</InfoTip>}
      </span>
      <input type="text" inputMode="numeric" value={value ? fmt(value) : ''} onChange={(e) => onChange(parseMoney(e.target.value))} placeholder="$0"
        className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400" />
    </label>
  )
}
function Tog({ label, checked, onChange, tooltip }) {
  return (
    <div className="flex items-center gap-2.5 text-xs text-slate-600">
      <label className="flex items-center gap-2.5 cursor-pointer">
        <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? 'bg-blue-500' : 'bg-slate-200'}`}>
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
        </span>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
        <span>{label}</span>
      </label>
      {tooltip && <InfoTip>{tooltip}</InfoTip>}
    </div>
  )
}
function SummaryRow({ label, value }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-800 font-medium">{value}</span>
    </div>
  )
}
function StatCard({ label, value, sub, warn }) {
  return (
    <div className={`bg-white border rounded-xl p-4 shadow-sm ${warn ? 'border-red-200' : 'border-slate-200'}`}>
      <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-lg font-bold ${warn ? 'text-red-600' : 'text-slate-900'}`}>{value}</p>
      {sub && <p className={`text-[10px] mt-0.5 ${warn ? 'text-red-500' : 'text-slate-400'}`}>{sub}</p>}
    </div>
  )
}

function PlanSummary({ inputs, monte, currentBalance, retirementBalance, finalBalance, sustainableIncome, withdrawalRate, probPct, firstYearNetSpending, firstYearNetSpendingMonthly, firstYearTaxes, totalLifetimeTaxes }) {
  const H = ({ children }) => <span className="font-semibold text-slate-900">{children}</span>
  const probColor =
    probPct == null ? 'text-slate-900' :
    probPct >= 85 ? 'text-emerald-700' :
    probPct >= 70 ? 'text-amber-600' :
    'text-red-600'
  const P = ({ children }) => <span className={`font-semibold ${probColor}`}>{children}</span>
  const Caption = ({ children }) => (
    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
      <span className="w-1 h-1 rounded-full bg-slate-400" />
      {children}
    </p>
  )
  const currentDateFormatted = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

  const currentAge = ageFromBirthDate(inputs.birthDate)
  const spouseAge = ageFromBirthDate(inputs.spouseBirthDate)
  const yearsToRetirement = inputs.retirementAge - currentAge
  const yearsToSpouseRetirement = inputs.spouseEnabled ? inputs.spouseRetirementAge - spouseAge : null
  const yearsToLifeExpectancy = inputs.lifeExpectancy - currentAge

  let timing
  if (!inputs.spouseEnabled) {
    timing = <>You plan to retire at <H>{inputs.retirementAge}</H> — <H>{yearsToRetirement}</H> years from now.</>
  } else if (inputs.retirementAge === inputs.spouseRetirementAge && yearsToRetirement === yearsToSpouseRetirement) {
    timing = <>You and your spouse plan to retire at <H>{inputs.retirementAge}</H> — <H>{yearsToRetirement}</H> years from now.</>
  } else {
    timing = <>You plan to retire at <H>{inputs.retirementAge}</H> (<H>{yearsToRetirement}</H> years from now) while your spouse retires at <H>{inputs.spouseRetirementAge}</H> (<H>{yearsToSpouseRetirement}</H> years from now).</>
  }

  let trajectoryVerb = 'change to'
  if (retirementBalance > 0) {
    const ratio = finalBalance / retirementBalance
    if (ratio > 1.1) trajectoryVerb = 'grow to'
    else if (ratio < 0.9) trajectoryVerb = 'draw down to'
    else trajectoryVerb = 'hold steady near'
  }

  const wrNum = Number(withdrawalRate)
  const wrCharacter = wrNum > 5 ? 'above the traditional safe threshold' : 'within safe range'

  const hasSS = (inputs.socialSecurityAmount || 0) > 0 || (inputs.spouseEnabled && (inputs.spouseSSAmount || 0) > 0)
  let ss = null
  if (hasSS) {
    if (!inputs.spouseEnabled) {
      ss = <>{' '}Social Security starts at <H>{inputs.socialSecurityAge}</H> and provides <H>{fmt(inputs.socialSecurityAmount * 12)}</H> per year.</>
    } else {
      ss = <>{' '}Your Social Security starts at <H>{inputs.socialSecurityAge}</H> (<H>{fmt(inputs.socialSecurityAmount * 12)}</H>/year); your spouse&apos;s starts at <H>{inputs.spouseSSAge}</H> (<H>{fmt((inputs.spouseSSAmount || 0) * 12)}</H>/year).</>
    }
  }

  const sources = (inputs.incomeSources || []).filter((s) => s && s.amount > 0)
  let otherSources = null
  if (sources.length > 0) {
    const describe = (s, i) => (
      <span key={s.id || i}>
        {i > 0 && (i === sources.length - 1 ? ', and ' : ', ')}
        <H>{s.description || 'Income'}</H> (<H>{fmt(s.amount)}</H>/month, {s.inflationAdjust ? 'COLA' : 'non-COLA'}) starting at age <H>{s.startAge}</H>
      </span>
    )
    otherSources = <>{' '}You&apos;ve also modeled {sources.map(describe)}.</>
  }

  let lumpSum = null
  if (inputs.expectLumpSum && inputs.lumpSumAmount > 0) {
    lumpSum = <>{' '}You&apos;re expecting a <H>{fmt(inputs.lumpSumAmount)}</H> lump sum at age <H>{inputs.lumpSumAge}</H>.</>
  }

  const expenses = (inputs.majorExpenses || []).filter((e) => e && e.amount > 0)
  let majorExpenses = null
  if (expenses.length > 0 && expenses.length <= 2) {
    const describe = (e, i) => (
      <span key={e.id || i}>
        {i > 0 && (i === expenses.length - 1 ? ', and ' : ', ')}
        <H>{e.description || 'Expense'}</H> of <H>{fmt(e.amount)}</H> at age <H>{e.age}</H>
      </span>
    )
    majorExpenses = <>{' '}You&apos;ve also planned for {expenses.map(describe)}.</>
  } else if (expenses.length >= 3) {
    const total = expenses.reduce((acc, e) => acc + (e.amount || 0), 0)
    majorExpenses = <>{' '}You&apos;ve planned for <H>{expenses.length}</H> major expenses totaling <H>{fmt(total)}</H> across your retirement years.</>
  }

  let spendAssessment = null
  const targetPercent = (inputs.retirementBalanceGoal || 0) / 100
  if (targetPercent === 0) {
    if (probPct != null && probPct >= 85 && retirementBalance > 0 && finalBalance > retirementBalance * 0.5) {
      spendAssessment = <>Your plan projects ending with <H>{fmt(finalBalance)}</H> at age <H>{inputs.lifeExpectancy}</H> — you may have room to spend more, travel more, or give more during retirement.</>
    } else if (probPct != null && probPct >= 70 && probPct < 85 && retirementBalance > 0 && finalBalance > retirementBalance) {
      spendAssessment = <>The median projection ends with <H>{fmt(finalBalance)}</H> — comfortable on average, though less-favorable markets could tighten things up.</>
    }
  } else {
    const targetFinalBalance = retirementBalance * targetPercent
    const surplus = finalBalance - targetFinalBalance
    if (targetFinalBalance > 0 && surplus < -targetFinalBalance * 0.25) {
      spendAssessment = <>Your plan projects ending with <H>{fmt(finalBalance)}</H>, short of your target of <H>{fmt(targetFinalBalance)}</H> — consider reducing planned spending, working longer, or saving more.</>
    } else if (targetFinalBalance > 0 && Math.abs(surplus) <= targetFinalBalance * 0.25) {
      spendAssessment = <>Your plan ends with <H>{fmt(finalBalance)}</H>, close to your target of <H>{fmt(targetFinalBalance)}</H>.</>
    } else if (targetFinalBalance > 0 && surplus > targetFinalBalance * 0.25) {
      if (probPct != null && probPct >= 85) {
        spendAssessment = <>You&apos;re on track to end with <H>{fmt(finalBalance)}</H>, well above your target of <H>{fmt(targetFinalBalance)}</H> — you could likely spend more or retire earlier if you&apos;d like.</>
      } else if (probPct != null && probPct >= 70) {
        spendAssessment = <>The median projection ends with <H>{fmt(finalBalance)}</H>, above your target of <H>{fmt(targetFinalBalance)}</H>, though market variability could narrow that margin.</>
      }
    }
  }

  let probability = null
  if (probPct != null) {
    if (probPct >= 85) {
      probability = <>Across 1,000 market simulations, your plan succeeded in <P>{probPct}%</P> of cases — a comfortable margin.</>
    } else if (probPct >= 80) {
      probability = <>Across 1,000 market simulations, your plan succeeded in <P>{probPct}%</P> of cases — a solid result with some exposure to downside markets.</>
    } else if (probPct >= 70) {
      probability = <>Across 1,000 market simulations, your plan succeeded in <P>{probPct}%</P> of cases — workable but with meaningful downside risk in weaker markets.</>
    } else {
      probability = <>Across 1,000 market simulations, your plan succeeded in <P>{probPct}%</P> of cases. This indicates real risk of running short — see the insights panel for potential adjustments.</>
    }
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-base font-semibold text-slate-900">Your plan at a glance</h3>
        <span className="text-xs text-slate-400">as of {currentDateFormatted}</span>
      </div>

      <Caption>Timing &amp; trajectory</Caption>
      <p className="text-base text-slate-700 leading-relaxed mb-4">
        {timing}{' '}
        Your portfolio is projected to {currentBalance > 0 ? <>grow from <H>{fmt(currentBalance)}</H> today to </> : <>reach </>}<H>{fmt(retirementBalance)}</H> at retirement, then {trajectoryVerb} <H>{fmt(finalBalance)}</H> by age <H>{inputs.lifeExpectancy}</H> (<H>{yearsToLifeExpectancy}</H> years from now).
      </p>

      <Caption>Income</Caption>
      <p className="text-base text-slate-700 leading-relaxed mb-4">
        In retirement you&apos;re planning to withdraw <H>{fmt(inputs.retirementIncomeNeeded)}</H> per year (gross, in today&apos;s dollars). After estimated federal and state taxes of about <H>{fmt(firstYearTaxes)}</H>, your take-home spending is approximately <H>{fmt(firstYearNetSpending)}</H> annually — roughly <H>{fmt(Math.round((firstYearNetSpendingMonthly || 0) / 100) * 100)}</H> per month. The 4% rule suggests your portfolio can sustainably provide <H>{fmt(sustainableIncome)}</H> annually (gross), a <H>{withdrawalRate}%</H> initial withdrawal rate — {wrCharacter}.
        {ss}
        {otherSources}
        {totalLifetimeTaxes > 100000 && <>{' '}Your plan pays an estimated <H>{fmt(totalLifetimeTaxes)}</H> in taxes over your retirement — worth discussing strategies like Roth conversions or tax-aware withdrawal sequencing with an advisor.</>}
        {lumpSum}
        {majorExpenses}
      </p>

      <Caption>Outlook</Caption>
      <p className="text-base text-slate-700 leading-relaxed">
        {spendAssessment}
        {spendAssessment && probability && ' '}
        {probability}
      </p>
    </div>
  )
}

function CashFlowTable({ results, inputs, dispBal }) {
  const [expandedAge, setExpandedAge] = useState(null)
  const rows = useMemo(() => buildCashFlowRows(results, inputs), [results, inputs])
  const retireIdx = rows.findIndex((r) => r.phase === 'retirement')
  const derivedAge = ageFromBirthDate(inputs.birthDate)

  const d = (v, age) => dispBal(v, age - derivedAge)
  const ncfClass = (v) => {
    const rounded = Math.round(v)
    if (rounded > 0) return 'text-emerald-600'
    if (rounded < 0) return 'text-red-600'
    return 'text-slate-700'
  }
  const fmtNcf = (v, age) => {
    const val = d(v, age)
    return fmtSigned(val)
  }
  const zeroClass = (phase) => phase === 'accumulation' ? 'text-slate-400' : 'text-slate-700'

  const preRows = retireIdx > 0 ? rows.slice(0, retireIdx) : rows.filter((r) => r.phase === 'accumulation')
  const postRows = retireIdx > 0 ? rows.slice(retireIdx) : rows.filter((r) => r.phase === 'retirement')

  return (
    <div className="border-t border-slate-200 overflow-x-auto">
      {/* Desktop table */}
      <table className="w-full text-xs hidden md:table">
        <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
          <tr>
            <th className="px-3 py-2 text-left whitespace-nowrap">Year</th>
            <th className="px-3 py-2 text-left whitespace-nowrap">Age</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Income Flows</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Planned Dist.</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Total Inflows</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Total Expenses</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Total Outflows</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Taxes</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Net Cash Flow</th>
            <th className="px-3 py-2 text-right whitespace-nowrap">Portfolio Assets</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {preRows.map((r) => (
            <tr key={`pre-${r.age}`} className={`text-slate-700 ${r.isRetirementYear ? 'bg-slate-50' : ''}`}>
              <td className="px-3 py-1.5">{r.year}</td>
              <td className="px-3 py-1.5">{r.spouseAge != null ? `${r.age} / ${r.spouseAge}` : r.age}</td>
              <td className={`px-3 py-1.5 text-right ${zeroClass(r.phase)}`}>{fmt(d(r.incomeFlows, r.age))}</td>
              <td className={`px-3 py-1.5 text-right ${zeroClass(r.phase)}`}>{fmt(d(r.plannedDistributions, r.age))}</td>
              <td className={`px-3 py-1.5 text-right ${zeroClass(r.phase)}`}>{fmt(d(r.totalInflows, r.age))}</td>
              <td className="px-3 py-1.5 text-right">{fmt(d(r.totalExpenses, r.age))}</td>
              <td className="px-3 py-1.5 text-right">{fmt(d(r.totalOutflows, r.age))}</td>
              <td className="px-3 py-1.5 text-right text-slate-400">$0</td>
              <td className={`px-3 py-1.5 text-right font-medium ${ncfClass(d(r.netCashFlow, r.age))}`}>{fmtNcf(r.netCashFlow, r.age)}</td>
              <td className="px-3 py-1.5 text-right font-medium">{fmt(d(r.portfolioAssets, r.age))}</td>
            </tr>
          ))}

          <tr className="bg-blue-50">
            <td colSpan={10} className="px-3 py-1.5 text-xs font-semibold text-blue-700">
              Retirement at age {inputs.retirementAge}
            </td>
          </tr>

          {postRows.map((r) => (
            <tr key={`post-${r.age}`} className="text-slate-700">
              <td className="px-3 py-1.5">{r.year}</td>
              <td className="px-3 py-1.5">{r.spouseAge != null ? `${r.age} / ${r.spouseAge}` : r.age}</td>
              <td className="px-3 py-1.5 text-right">{fmt(d(r.incomeFlows, r.age))}</td>
              <td className="px-3 py-1.5 text-right">
                {fmt(d(r.plannedDistributions, r.age))}
                {r.withinRMD && r.plannedDistributions > 0 && (
                  <span className="ml-1 text-[9px] bg-amber-100 text-amber-700 px-1 rounded">RMD</span>
                )}
              </td>
              <td className="px-3 py-1.5 text-right">{fmt(d(r.totalInflows, r.age))}</td>
              <td className="px-3 py-1.5 text-right">{fmt(d(r.totalExpenses, r.age))}</td>
              <td className="px-3 py-1.5 text-right">{fmt(d(r.totalOutflows, r.age))}</td>
              <td className={`px-3 py-1.5 text-right ${r.effectiveTaxRate > 0.25 ? 'text-amber-600' : ''}`}>{fmt(d(r.taxes, r.age))}</td>
              <td className={`px-3 py-1.5 text-right font-medium ${ncfClass(d(r.netCashFlow, r.age))}`}>{fmtNcf(r.netCashFlow, r.age)}</td>
              <td className="px-3 py-1.5 text-right font-medium">{fmt(d(r.portfolioAssets, r.age))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile table */}
      <table className="w-full text-xs md:hidden">
        <thead className="bg-slate-50 text-slate-500 uppercase text-[10px]">
          <tr>
            <th className="px-3 py-2 text-left">Year</th>
            <th className="px-3 py-2 text-left">Age</th>
            <th className="px-3 py-2 text-right">Net Cash Flow</th>
            <th className="px-3 py-2 text-right">Portfolio</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {preRows.map((r) => (
            <MobileRow key={`m-pre-${r.age}`} row={r} inputs={inputs} d={d} ncfClass={ncfClass} fmtNcf={fmtNcf} expanded={expandedAge === r.age} onToggle={() => setExpandedAge(expandedAge === r.age ? null : r.age)} />
          ))}
          <tr className="bg-blue-50">
            <td colSpan={4} className="px-3 py-1.5 text-xs font-semibold text-blue-700">
              Retirement at age {inputs.retirementAge}
            </td>
          </tr>
          {postRows.map((r) => (
            <MobileRow key={`m-post-${r.age}`} row={r} inputs={inputs} d={d} ncfClass={ncfClass} fmtNcf={fmtNcf} expanded={expandedAge === r.age} onToggle={() => setExpandedAge(expandedAge === r.age ? null : r.age)} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function IncomeTooltip({ active, payload, series }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  const guaranteed = []
  const withdrawals = []
  let guaranteedSub = 0, withdrawalSub = 0
  for (const s of series) {
    const v = d[s.key] || 0
    if (Math.round(v) === 0) continue
    if (s.group === 'withdrawal') { withdrawals.push({ label: s.label, color: s.color, value: v }); withdrawalSub += v }
    else { guaranteed.push({ label: s.label, color: s.color, value: v }); guaranteedSub += v }
  }
  const expenses = d.totalExpenses
  const hasExpenses = expenses != null && Math.round(expenses) !== 0
  const totalFunding = guaranteedSub + withdrawalSub
  const gap = hasExpenses ? expenses - totalFunding : 0
  if (guaranteed.length === 0 && withdrawals.length === 0 && !hasExpenses) return null

  const Row = ({ l }) => (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: l.color }} />
        <span className="text-slate-600">{l.label}</span>
      </span>
      <span className="text-slate-900 tabular-nums">{fmt(l.value)}</span>
    </div>
  )

  return (
    <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 shadow-lg text-sm min-w-[220px]">
      <p className="text-slate-500 text-xs mb-1">Age {d.age}</p>
      {guaranteed.length > 0 && (
        <>
          <p className="text-[10px] uppercase tracking-wider text-slate-400 mt-1">Guaranteed income</p>
          {guaranteed.map((l) => <Row key={l.label} l={l} />)}
          {guaranteed.length > 1 && (
            <div className="flex justify-between text-xs mt-0.5">
              <span className="text-slate-500">Subtotal</span>
              <span className="text-slate-700 font-medium tabular-nums">{fmt(guaranteedSub)}</span>
            </div>
          )}
        </>
      )}
      {withdrawals.length > 0 && (
        <>
          <p className="text-[10px] uppercase tracking-wider text-slate-400 mt-2">Portfolio withdrawals</p>
          {withdrawals.map((l) => <Row key={l.label} l={l} />)}
          {withdrawals.length > 1 && (
            <div className="flex justify-between text-xs mt-0.5">
              <span className="text-slate-500">Subtotal</span>
              <span className="text-slate-700 font-medium tabular-nums">{fmt(withdrawalSub)}</span>
            </div>
          )}
        </>
      )}
      {(guaranteed.length + withdrawals.length) > 0 && (
        <div className="flex justify-between text-xs border-t border-slate-100 mt-1 pt-1">
          <span className="text-slate-600 font-medium">Total funding</span>
          <span className="text-slate-900 font-semibold tabular-nums">{fmt(totalFunding)}</span>
        </div>
      )}
      {hasExpenses && (
        <div className="flex items-center justify-between gap-4 text-xs mt-0.5">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-0.5 rounded" style={{ backgroundColor: '#1e293b' }} />
            <span className="text-slate-600">Total expenses</span>
          </span>
          <span className="text-slate-900 tabular-nums">{fmt(expenses)}</span>
        </div>
      )}
      {hasExpenses && Math.round(gap) > 0 && (
        <div className="flex justify-between text-xs border-t border-slate-100 mt-1 pt-1">
          <span className="text-red-600 font-medium">Gap from portfolio</span>
          <span className="text-red-600 font-semibold tabular-nums">{fmt(gap)}</span>
        </div>
      )}
    </div>
  )
}

function MobileRow({ row: r, inputs, d, ncfClass, fmtNcf, expanded, onToggle }) {
  return (
    <>
      <tr onClick={onToggle} className="text-slate-700 cursor-pointer hover:bg-slate-50 active:bg-slate-100">
        <td className="px-3 py-2">{r.year}</td>
        <td className="px-3 py-2">{r.spouseAge != null ? `${r.age}/${r.spouseAge}` : r.age}</td>
        <td className={`px-3 py-2 text-right font-medium ${ncfClass(d(r.netCashFlow, r.age))}`}>{fmtNcf(r.netCashFlow, r.age)}</td>
        <td className="px-3 py-2 text-right font-medium">{fmt(d(r.portfolioAssets, r.age))}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={4} className="px-3 pb-3 pt-0">
            <div className="bg-slate-50 rounded-lg p-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
              <div className="flex justify-between"><span className="text-slate-500">Income Flows</span><span className="text-slate-800">{fmt(d(r.incomeFlows, r.age))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Planned Dist.</span><span className="text-slate-800">{fmt(d(r.plannedDistributions, r.age))}{r.withinRMD && r.plannedDistributions > 0 && <span className="ml-1 text-[9px] bg-amber-100 text-amber-700 px-0.5 rounded">RMD</span>}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Total Inflows</span><span className="text-slate-800">{fmt(d(r.totalInflows, r.age))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Total Expenses</span><span className="text-slate-800">{fmt(d(r.totalExpenses, r.age))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Total Outflows</span><span className="text-slate-800">{fmt(d(r.totalOutflows, r.age))}</span></div>
              <div className="flex justify-between col-span-2"><span className="text-slate-500">Taxes</span><span className={r.effectiveTaxRate > 0.25 ? 'text-amber-600' : 'text-slate-800'}>{fmt(d(r.taxes, r.age))}</span></div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function ComparisonView({ comparisonData, scenarios, activeScenario, onOpenScenario, onBack, onNewScenario }) {
  if (!comparisonData.length) return null
  const base = comparisonData.find((d) => d.scenario.is_base)
  const baseInp = base?.inputs || {}
  const validItems = comparisonData.filter((d) => d.valid)

  const best = (key) => {
    if (validItems.length < 2) return {}
    const vals = validItems.map((d) => ({ id: d.scenario.id, v: key(d) })).filter((x) => x.v != null)
    if (vals.length < 2) return {}
    vals.sort((a, b) => b.v - a.v)
    return { bestId: vals[0].id, worstId: vals[vals.length - 1].id }
  }

  const probBW = best((d) => d.monte.probability)
  const finalBW = best((d) => d.results.finalBalance)
  const fourBW = best((d) => d.fourPct)
  const runOutBW = (() => {
    if (validItems.length < 2) return {}
    const withAge = validItems.filter((d) => d.results.runOutAge != null)
    const noAge = validItems.filter((d) => d.results.runOutAge == null)
    if (withAge.length === 0) return {}
    withAge.sort((a, b) => a.results.runOutAge - b.results.runOutAge)
    return { worstId: withAge[0].scenario.id, bestId: noAge.length > 0 ? noAge[0].scenario.id : withAge[withAge.length - 1].scenario.id }
  })()

  const cellColor = (id, bw) => {
    if (!bw.bestId) return ''
    if (id === bw.bestId) return 'text-emerald-600 font-semibold'
    if (id === bw.worstId) return 'text-red-600 font-semibold'
    return ''
  }
  const diffBg = (val, baseVal) => val !== baseVal ? 'bg-amber-50' : ''

  const hasSpouse = comparisonData.some((d) => d.inputs.spouseEnabled)
  const hasLump = comparisonData.some((d) => d.inputs.expectLumpSum)
  const hasIncome = comparisonData.some((d) => (d.inputs.incomeSources || []).length > 0)
  const hasExpenses = comparisonData.some((d) => (d.inputs.majorExpenses || []).length > 0)
  const showExtras = hasSpouse || hasLump || hasIncome || hasExpenses

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
      <button onClick={onBack} className="text-xs font-medium text-blue-600 hover:text-blue-700 mb-4">
        ← Back to {activeScenario?.name || 'Base plan'}
      </button>
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Compare scenarios</h2>
            <p className="text-sm text-slate-500">{scenarios.length} scenarios. Click a column to view details.</p>
          </div>
          <button onClick={onNewScenario} className="text-xs font-medium text-blue-500 hover:bg-blue-50 px-2 py-1.5 rounded-md">+ New scenario</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: Math.max(600, comparisonData.length * 160 + 180) }}>
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-44">Metric</th>
                {comparisonData.map((d) => (
                  <th
                    key={d.scenario.id}
                    onClick={() => onOpenScenario(d.scenario.id)}
                    className={`px-4 py-3 text-left cursor-pointer hover:bg-slate-100 transition-colors ${d.scenario.is_base ? 'border-l-2 border-blue-500' : ''}`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-slate-900">{d.scenario.name}</span>
                      {d.scenario.is_base && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">Base</span>}
                    </div>
                    <span className="text-xs text-blue-500">→ Open</span>
                    {!d.valid && <p className="text-[10px] text-amber-600 mt-0.5">Plan incomplete</p>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-slate-50"><td colSpan={comparisonData.length + 1} className="px-4 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Outcomes</td></tr>

              <CmpRow label="Probability of success" data={comparisonData} render={(d) => d.valid ? <span className={cellColor(d.scenario.id, probBW)}>{Math.round(d.monte.probability * 100)}%</span> : '—'} />
              <CmpRow label="Portfolio at retirement" data={comparisonData} render={(d) => d.valid ? fmt(d.results.retirementBalance) : '—'} />
              <CmpRow label="Portfolio at life expectancy" data={comparisonData} render={(d) => d.valid ? <span className={cellColor(d.scenario.id, finalBW)}>{fmt(d.results.finalBalance)}</span> : '—'} />
              <CmpRow label="Sustainable income (4%)" data={comparisonData} render={(d) => d.valid ? <span className={cellColor(d.scenario.id, fourBW)}>{fmt(d.fourPct)}</span> : '—'} />
              <CmpRow label="Runs out at age" data={comparisonData} render={(d) => {
                if (!d.valid) return '—'
                if (d.results.runOutAge == null) return <span className={cellColor(d.scenario.id, runOutBW)}>—</span>
                return <span className={`text-red-600 font-semibold`}>Age {d.results.runOutAge}</span>
              }} />
              <CmpRow label="Initial withdrawal rate" data={comparisonData} render={(d) => d.valid ? `${d.wr.toFixed(1)}%` : '—'} />

              <tr className="bg-slate-50"><td colSpan={comparisonData.length + 1} className="px-4 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Key assumptions</td></tr>

              <CmpRow label="Current age" data={comparisonData} render={(d) => d.derivedAge} />
              <CmpRow label="Retirement age" data={comparisonData} cellClass={(d) => diffBg(d.inputs.retirementAge, baseInp.retirementAge)} render={(d) => d.inputs.retirementAge} />
              <CmpRow label="Life expectancy" data={comparisonData} cellClass={(d) => diffBg(d.inputs.lifeExpectancy, baseInp.lifeExpectancy)} render={(d) => d.inputs.lifeExpectancy} />
              <CmpRow label="Annual income needed" data={comparisonData} cellClass={(d) => diffBg(d.inputs.retirementIncomeNeeded, baseInp.retirementIncomeNeeded)} render={(d) => fmt(d.inputs.retirementIncomeNeeded)} />
              <CmpRow label="Monthly savings" data={comparisonData} cellClass={(d) => diffBg((d.inputs.userMonthlySavings || 0) + (d.inputs.spouseEnabled ? (d.inputs.spouseMonthlySavings || 0) : 0), (baseInp.userMonthlySavings || 0) + (baseInp.spouseEnabled ? (baseInp.spouseMonthlySavings || 0) : 0))} render={(d) => fmt((d.inputs.userMonthlySavings || 0) + (d.inputs.spouseEnabled ? (d.inputs.spouseMonthlySavings || 0) : 0))} />
              <CmpRow label="Pre-ret. return" data={comparisonData} cellClass={(d) => diffBg(d.inputs.preRetirementReturn, baseInp.preRetirementReturn)} render={(d) => `${d.inputs.preRetirementReturn}%`} />
              <CmpRow label="Post-ret. return" data={comparisonData} cellClass={(d) => diffBg(d.inputs.postRetirementReturn, baseInp.postRetirementReturn)} render={(d) => `${d.inputs.postRetirementReturn}%`} />
              <CmpRow label="Inflation rate" data={comparisonData} cellClass={(d) => diffBg(d.inputs.inflationRate, baseInp.inflationRate)} render={(d) => `${d.inputs.inflationRate}%`} />

              {showExtras && (
                <>
                  <tr className="bg-slate-50"><td colSpan={comparisonData.length + 1} className="px-4 py-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Additional</td></tr>
                  {hasSpouse && <CmpRow label="Spouse included" data={comparisonData} render={(d) => d.inputs.spouseEnabled ? 'Yes' : 'No'} />}
                  <CmpRow label="SS start age" data={comparisonData} cellClass={(d) => diffBg(d.inputs.socialSecurityAge, baseInp.socialSecurityAge)} render={(d) => d.inputs.socialSecurityAge} />
                  {hasLump && <CmpRow label="Lump sum" data={comparisonData} render={(d) => d.inputs.expectLumpSum ? `${fmt(d.inputs.lumpSumAmount)} at ${d.inputs.lumpSumAge}` : '—'} />}
                  {hasIncome && <CmpRow label="Income sources" data={comparisonData} render={(d) => (d.inputs.incomeSources || []).length || '—'} />}
                  {hasExpenses && <CmpRow label="Major expenses" data={comparisonData} render={(d) => (d.inputs.majorExpenses || []).length || '—'} />}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function CmpRow({ label, data, render, cellClass }) {
  return (
    <tr className="hover:bg-slate-50/50">
      <td className="px-4 py-2 text-xs text-slate-600 font-medium">{label}</td>
      {data.map((d) => (
        <td key={d.scenario.id} className={`px-4 py-2 text-sm text-slate-900 ${cellClass ? cellClass(d) : ''} ${d.scenario.is_base ? 'border-l-2 border-blue-500' : ''}`}>
          {render(d)}
        </td>
      ))}
    </tr>
  )
}
