// PDF export for Glide retirement plan.
// Builds a multi-page advisor-quality document from the live plan context.

const PAGE_WIDTH = 210
const PAGE_HEIGHT = 297
const MARGIN = 15
const USABLE_WIDTH = PAGE_WIDTH - 2 * MARGIN
const HEADER_HEIGHT = 15
const FOOTER_HEIGHT = 15
const CONTENT_TOP = MARGIN + HEADER_HEIGHT
const CONTENT_BOTTOM = PAGE_HEIGHT - MARGIN - FOOTER_HEIGHT

const COLORS = {
  primary: [30, 64, 175],
  heading: [15, 23, 42],
  body: [51, 65, 85],
  muted: [100, 116, 139],
  success: [5, 150, 105],
  warn: [217, 119, 6],
  negative: [220, 38, 38],
  box: [241, 245, 249],
  line: [226, 232, 240],
  white: [255, 255, 255],
}

function fmtMoney(v) {
  if (v == null || !isFinite(v)) return '$0'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.round(v))
}
function fmtPct(v) { return `${Math.round(v)}%` }
function slug(s) { return (s || 'plan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') }

function setText(doc, rgb) { doc.setTextColor(rgb[0], rgb[1], rgb[2]) }
function setFill(doc, rgb) { doc.setFillColor(rgb[0], rgb[1], rgb[2]) }
function setDraw(doc, rgb) { doc.setDrawColor(rgb[0], rgb[1], rgb[2]) }

function drawHeader(doc, title, dateStr) {
  setText(doc, COLORS.muted)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text('Glide · Retirement Plan', MARGIN, MARGIN)
  if (dateStr) {
    doc.text(dateStr, PAGE_WIDTH - MARGIN, MARGIN, { align: 'right' })
  }
  setDraw(doc, COLORS.line)
  doc.setLineWidth(0.2)
  doc.line(MARGIN, MARGIN + 3, PAGE_WIDTH - MARGIN, MARGIN + 3)
  if (title) {
    setText(doc, COLORS.heading)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.text(title, MARGIN, MARGIN + 12)
  }
}

function drawFooter(doc, pageNum, totalPages) {
  setText(doc, COLORS.muted)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('Prepared by Glide by Clark.com · Illustrative projection — not investment advice', MARGIN, PAGE_HEIGHT - MARGIN + 2)
  doc.text(`Page ${pageNum}${totalPages ? ` of ${totalPages}` : ''}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - MARGIN + 2, { align: 'right' })
}

function addParagraph(doc, text, x, y, maxWidth, { size = 10, lineHeight = 5, color = COLORS.body, weight = 'normal' } = {}) {
  doc.setFont('helvetica', weight)
  doc.setFontSize(size)
  setText(doc, color)
  const lines = doc.splitTextToSize(text, maxWidth)
  lines.forEach((line, i) => doc.text(line, x, y + i * lineHeight))
  return y + lines.length * lineHeight
}

function addSubheading(doc, text, x, y) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  setText(doc, COLORS.heading)
  doc.text(text, x, y)
  return y + 6
}

function addRichParagraph(doc, segments, x, y, maxWidth, lineHeight = 5) {
  doc.setFontSize(10)
  let cursorX = x
  let cursorY = y
  for (const seg of segments) {
    doc.setFont('helvetica', seg.bold ? 'bold' : 'normal')
    setText(doc, seg.bold ? COLORS.heading : COLORS.body)
    const words = seg.text.split(/(\s+)/).filter(Boolean)
    for (const word of words) {
      const w = doc.getTextWidth(word)
      if (cursorX + w - x > maxWidth && /\S/.test(word)) {
        cursorX = x
        cursorY += lineHeight
      }
      doc.text(word, cursorX, cursorY)
      cursorX += w
    }
  }
  return cursorY + lineHeight
}

async function captureChart(elementId) {
  if (typeof document === 'undefined') return null
  const el = document.getElementById(elementId)
  if (!el) return null
  try {
    await new Promise((resolve) => requestAnimationFrame(() => resolve()))
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready
    }
    const { default: domtoimage } = await import('dom-to-image-more')
    const w = el.offsetWidth
    const h = el.offsetHeight
    const dataUrl = await domtoimage.toPng(el, {
      bgcolor: '#ffffff',
      quality: 1.0,
      cacheBust: true,
      copyDefaultStyles: false,
      width: w * 2,
      height: h * 2,
      style: {
        transform: 'scale(2)',
        'transform-origin': 'top left',
        width: w + 'px',
        height: h + 'px',
      },
      filter: (node) => {
        if (node.tagName === 'INPUT') return false
        if (node.tagName === 'LABEL' && node.querySelector && node.querySelector('input[type="checkbox"]')) return false
        if (node.classList && node.classList.contains('pdf-hide')) return false
        return true
      },
    })
    return { dataUrl, width: w, height: h }
  } catch (err) {
    console.error('Chart capture failed for', elementId, ':', err)
    return null
  }
}

function buildPlanNarrative(ctx) {
  const { inputs, results, monte, derivedAge, taxSummary, netSpending } = ctx
  if (!results) return { timing: [], trajectory: [], income: [], outlook: [] }

  const infl = (inputs.inflationRate || 0) / 100
  const ytr = inputs.retirementAge - derivedAge
  const lifeYtd = inputs.lifeExpectancy - derivedAge
  const deflator = Math.pow(1 + infl, ytr)
  const lifeDeflator = Math.pow(1 + infl, lifeYtd)
  const retirementBalance = (results.retirementBalance || 0) / deflator
  const finalBalance = (results.finalBalance || 0) / lifeDeflator
  const currentBalance = ctx.totals?.investable || 0
  const yearsToRetirement = ytr
  const yearsToSpouseRetirement = inputs.spouseEnabled ? inputs.spouseRetirementAge - (ctx.derivedSpouseAge || 0) : null
  const yearsToLifeExpectancy = lifeYtd
  const fourPct = (results.retirementBalance || 0) * 0.04
  const sustainableIncome = fourPct / deflator
  const wrRate = results.retirementBalance > 0 ? (inputs.retirementIncomeNeeded / results.retirementBalance * 100).toFixed(1) : '—'
  const probPct = monte ? Math.round(monte.probability * 100) : null

  // Timing & trajectory
  const timing = []
  if (!inputs.spouseEnabled) {
    timing.push({ text: 'You plan to retire at ', bold: false })
    timing.push({ text: `${inputs.retirementAge}`, bold: true })
    timing.push({ text: ' — ', bold: false })
    timing.push({ text: `${yearsToRetirement}`, bold: true })
    timing.push({ text: ' years from now. ', bold: false })
  } else if (inputs.retirementAge === inputs.spouseRetirementAge && yearsToRetirement === yearsToSpouseRetirement) {
    timing.push({ text: 'You and your spouse plan to retire at ', bold: false })
    timing.push({ text: `${inputs.retirementAge}`, bold: true })
    timing.push({ text: ' — ', bold: false })
    timing.push({ text: `${yearsToRetirement}`, bold: true })
    timing.push({ text: ' years from now. ', bold: false })
  } else {
    timing.push({ text: 'You plan to retire at ', bold: false })
    timing.push({ text: `${inputs.retirementAge}`, bold: true })
    timing.push({ text: ' (', bold: false })
    timing.push({ text: `${yearsToRetirement}`, bold: true })
    timing.push({ text: ' years from now) while your spouse retires at ', bold: false })
    timing.push({ text: `${inputs.spouseRetirementAge}`, bold: true })
    timing.push({ text: ' (', bold: false })
    timing.push({ text: `${yearsToSpouseRetirement}`, bold: true })
    timing.push({ text: ' years from now). ', bold: false })
  }

  let verb = 'change to'
  if (retirementBalance > 0) {
    const ratio = finalBalance / retirementBalance
    if (ratio > 1.1) verb = 'grow to'
    else if (ratio < 0.9) verb = 'draw down to'
    else verb = 'hold steady near'
  }
  if (currentBalance > 0) {
    timing.push({ text: 'Your portfolio is projected to grow from ', bold: false })
    timing.push({ text: fmtMoney(currentBalance), bold: true })
    timing.push({ text: ' today to ', bold: false })
  } else {
    timing.push({ text: 'Your portfolio is projected to reach ', bold: false })
  }
  timing.push({ text: fmtMoney(retirementBalance), bold: true })
  timing.push({ text: ' at retirement, then ' + verb + ' ', bold: false })
  timing.push({ text: fmtMoney(finalBalance), bold: true })
  timing.push({ text: ' by age ', bold: false })
  timing.push({ text: `${inputs.lifeExpectancy}`, bold: true })
  timing.push({ text: ' (', bold: false })
  timing.push({ text: `${yearsToLifeExpectancy}`, bold: true })
  timing.push({ text: ' years from now).', bold: false })

  // Income
  const income = []
  income.push({ text: "In retirement you're planning to withdraw ", bold: false })
  income.push({ text: fmtMoney(inputs.retirementIncomeNeeded), bold: true })
  income.push({ text: ' per year (gross, in today\u2019s dollars). After estimated federal and state taxes of about ', bold: false })
  income.push({ text: fmtMoney(netSpending.firstYearTaxes), bold: true })
  income.push({ text: ', your take-home spending is approximately ', bold: false })
  income.push({ text: fmtMoney(netSpending.firstYearNetSpending), bold: true })
  income.push({ text: ' annually \u2014 roughly ', bold: false })
  const monthlyRounded = Math.round((netSpending.firstYearNetSpendingMonthly || 0) / 100) * 100
  income.push({ text: fmtMoney(monthlyRounded), bold: true })
  income.push({ text: ' per month. The 4% rule suggests your portfolio can sustainably provide ', bold: false })
  income.push({ text: fmtMoney(sustainableIncome), bold: true })
  income.push({ text: ' annually (gross), a ', bold: false })
  income.push({ text: `${wrRate}%`, bold: true })
  income.push({ text: ' initial withdrawal rate \u2014 ', bold: false })
  const wrChar = Number(wrRate) > 5 ? 'above the traditional safe threshold' : 'within safe range'
  income.push({ text: wrChar + '. ', bold: false })

  const hasSS = (inputs.socialSecurityAmount || 0) > 0 || (inputs.spouseEnabled && (inputs.spouseSSAmount || 0) > 0)
  if (hasSS) {
    if (!inputs.spouseEnabled) {
      income.push({ text: 'Social Security starts at ', bold: false })
      income.push({ text: `${inputs.socialSecurityAge}`, bold: true })
      income.push({ text: ' and provides ', bold: false })
      income.push({ text: fmtMoney(inputs.socialSecurityAmount * 12), bold: true })
      income.push({ text: ' per year.', bold: false })
    } else {
      income.push({ text: 'Your Social Security starts at ', bold: false })
      income.push({ text: `${inputs.socialSecurityAge}`, bold: true })
      income.push({ text: ' (', bold: false })
      income.push({ text: fmtMoney(inputs.socialSecurityAmount * 12), bold: true })
      income.push({ text: '/year); your spouse\u2019s starts at ', bold: false })
      income.push({ text: `${inputs.spouseSSAge}`, bold: true })
      income.push({ text: ' (', bold: false })
      income.push({ text: fmtMoney((inputs.spouseSSAmount || 0) * 12), bold: true })
      income.push({ text: '/year).', bold: false })
    }
  }

  const sources = (inputs.incomeSources || []).filter((s) => s && s.amount > 0)
  if (sources.length > 0) {
    income.push({ text: ' You\u2019ve also modeled ', bold: false })
    sources.forEach((s, i) => {
      if (i > 0) income.push({ text: i === sources.length - 1 ? ', and ' : ', ', bold: false })
      income.push({ text: s.description || 'Income', bold: true })
      income.push({ text: ' (', bold: false })
      income.push({ text: fmtMoney(s.amount) + '/month', bold: true })
      income.push({ text: `, ${s.inflationAdjust ? 'COLA' : 'non-COLA'}) starting at age `, bold: false })
      income.push({ text: `${s.startAge}`, bold: true })
    })
    income.push({ text: '.', bold: false })
  }

  // Outlook
  const outlook = []
  const target = ((inputs.retirementBalanceGoal || 0) / 100) * retirementBalance
  if (target === 0) {
    if (probPct != null && probPct >= 85 && retirementBalance > 0 && finalBalance > retirementBalance * 0.5) {
      outlook.push({ text: 'Your plan projects ending with ', bold: false })
      outlook.push({ text: fmtMoney(finalBalance), bold: true })
      outlook.push({ text: ` at age ${inputs.lifeExpectancy} \u2014 you may have room to spend more, travel more, or give more during retirement. `, bold: false })
    } else if (probPct != null && probPct >= 70 && probPct < 85 && retirementBalance > 0 && finalBalance > retirementBalance) {
      outlook.push({ text: 'The median projection ends with ', bold: false })
      outlook.push({ text: fmtMoney(finalBalance), bold: true })
      outlook.push({ text: ' \u2014 comfortable on average, though less-favorable markets could tighten things up. ', bold: false })
    }
  } else {
    const surplus = finalBalance - target
    if (surplus < -target * 0.25) {
      outlook.push({ text: 'Your plan projects ending with ', bold: false })
      outlook.push({ text: fmtMoney(finalBalance), bold: true })
      outlook.push({ text: ', short of your target of ', bold: false })
      outlook.push({ text: fmtMoney(target), bold: true })
      outlook.push({ text: ' \u2014 consider reducing planned spending, working longer, or saving more. ', bold: false })
    } else if (Math.abs(surplus) <= target * 0.25) {
      outlook.push({ text: 'Your plan ends with ', bold: false })
      outlook.push({ text: fmtMoney(finalBalance), bold: true })
      outlook.push({ text: ', close to your target of ', bold: false })
      outlook.push({ text: fmtMoney(target), bold: true })
      outlook.push({ text: '. ', bold: false })
    } else if (surplus > target * 0.25) {
      if (probPct != null && probPct >= 85) {
        outlook.push({ text: 'You\u2019re on track to end with ', bold: false })
        outlook.push({ text: fmtMoney(finalBalance), bold: true })
        outlook.push({ text: ', well above your target of ', bold: false })
        outlook.push({ text: fmtMoney(target), bold: true })
        outlook.push({ text: ' \u2014 you could likely spend more or retire earlier if you\u2019d like. ', bold: false })
      } else if (probPct != null && probPct >= 70) {
        outlook.push({ text: 'The median projection ends with ', bold: false })
        outlook.push({ text: fmtMoney(finalBalance), bold: true })
        outlook.push({ text: ', above your target of ', bold: false })
        outlook.push({ text: fmtMoney(target), bold: true })
        outlook.push({ text: ', though market variability could narrow that margin. ', bold: false })
      }
    }
  }

  if (probPct != null) {
    if (probPct >= 85) {
      outlook.push({ text: 'Across 1,000 market simulations, your plan succeeded in ', bold: false })
      outlook.push({ text: `${probPct}%`, bold: true })
      outlook.push({ text: ' of cases \u2014 a comfortable margin.', bold: false })
    } else if (probPct >= 80) {
      outlook.push({ text: 'Across 1,000 market simulations, your plan succeeded in ', bold: false })
      outlook.push({ text: `${probPct}%`, bold: true })
      outlook.push({ text: ' of cases \u2014 a solid result with some exposure to downside markets.', bold: false })
    } else if (probPct >= 70) {
      outlook.push({ text: 'Across 1,000 market simulations, your plan succeeded in ', bold: false })
      outlook.push({ text: `${probPct}%`, bold: true })
      outlook.push({ text: ' of cases \u2014 workable but with meaningful downside risk in weaker markets.', bold: false })
    } else {
      outlook.push({ text: 'Across 1,000 market simulations, your plan succeeded in ', bold: false })
      outlook.push({ text: `${probPct}%`, bold: true })
      outlook.push({ text: ' of cases. This indicates real risk of running short \u2014 see the insights page for potential adjustments.', bold: false })
    }
  }

  return { timing, income, outlook, probPct }
}

function buildAccountRows(inputs) {
  const groups = {}
  for (const a of inputs.accounts || []) {
    const key = a.type || 'other'
    if (!groups[key]) groups[key] = { type: key, accounts: [], total: 0 }
    groups[key].accounts.push(a)
    groups[key].total += Number(a.balance) || 0
  }
  return groups
}

// ─── Page builders ───────────────────────────────────────────────

function pageCover(doc, ctx) {
  setFill(doc, COLORS.primary)
  doc.rect(0, 0, PAGE_WIDTH, 60, 'F')

  setText(doc, COLORS.white)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(32)
  doc.text('Retirement Plan', MARGIN, 40)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text('Glide · by Clark.com', MARGIN, 50)

  const cx = MARGIN
  let cy = 90
  setText(doc, COLORS.muted)
  doc.setFontSize(10)
  doc.text('Prepared for', cx, cy); cy += 6
  setText(doc, COLORS.heading)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(ctx.userEmail || 'Client', cx, cy); cy += 12

  setText(doc, COLORS.muted)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('Plan', cx, cy); cy += 6
  setText(doc, COLORS.heading)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(ctx.scenarioName || 'Base plan', cx, cy); cy += 12

  setText(doc, COLORS.muted)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('As of', cx, cy); cy += 6
  setText(doc, COLORS.heading)
  doc.setFontSize(14)
  doc.text(ctx.dateStr, cx, cy)

  setText(doc, COLORS.muted)
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(9)
  const footerText = 'This plan is an illustrative retirement projection prepared for informational purposes. See disclosures on the final page.'
  const lines = doc.splitTextToSize(footerText, USABLE_WIDTH)
  doc.text(lines, MARGIN, PAGE_HEIGHT - MARGIN - 10)
}

function pageTOC(doc, ctx, tocEntries) {
  drawHeader(doc, 'Table of Contents', ctx.dateStr)
  let y = CONTENT_TOP + 10
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  for (const { title, page } of tocEntries) {
    setText(doc, COLORS.heading)
    doc.text(title, MARGIN, y)
    setText(doc, COLORS.muted)
    doc.text(String(page), PAGE_WIDTH - MARGIN, y, { align: 'right' })
    setDraw(doc, COLORS.line)
    doc.setLineWidth(0.1)
    doc.line(MARGIN + doc.getTextWidth(title) + 3, y - 1, PAGE_WIDTH - MARGIN - doc.getTextWidth(String(page)) - 3, y - 1)
    y += 8
  }
}

function pagePlanSummary(doc, ctx) {
  drawHeader(doc, 'Plan Summary', ctx.dateStr)
  const narrative = buildPlanNarrative(ctx)
  let y = CONTENT_TOP + 12
  y = addSubheading(doc, 'Timing & trajectory', MARGIN, y) + 2
  y = addRichParagraph(doc, narrative.timing, MARGIN, y, USABLE_WIDTH, 5.2)
  y += 6
  y = addSubheading(doc, 'Income', MARGIN, y) + 2
  y = addRichParagraph(doc, narrative.income, MARGIN, y, USABLE_WIDTH, 5.2)
  y += 6
  y = addSubheading(doc, 'Outlook', MARGIN, y) + 2
  if (narrative.outlook.length === 0) {
    narrative.outlook.push({ text: 'Monte Carlo analysis is still running.', bold: false })
  }
  y = addRichParagraph(doc, narrative.outlook, MARGIN, y, USABLE_WIDTH, 5.2)
}

function pageNetWorth(doc, ctx) {
  drawHeader(doc, `Net Worth Statement — ${ctx.dateStr}`, ctx.dateStr)
  const groups = buildAccountRows(ctx.inputs)
  const typeLabels = {
    '401k': '401(k) / 403(b)',
    'traditional_ira': 'Traditional IRA',
    'roth_ira': 'Roth IRA',
    'brokerage': 'Brokerage',
    'cash': 'Cash / Savings',
    'other_investment': 'Other investments',
    'real_estate': 'Real estate',
  }
  const ownerLabels = { self: 'You', spouse: 'Spouse', joint: 'Joint' }
  const spouseEnabled = !!ctx.inputs.spouseEnabled
  const head = spouseEnabled
    ? [['Account', 'Type', 'Owner', 'Balance']]
    : [['Account', 'Type', 'Balance']]
  const body = []
  let assetsTotal = 0
  const groupKeys = Object.keys(groups).sort()
  for (const key of groupKeys) {
    const g = groups[key]
    for (const a of g.accounts) {
      assetsTotal += Number(a.balance) || 0
      const row = spouseEnabled
        ? [a.name || typeLabels[key] || 'Account', typeLabels[key] || key, ownerLabels[a.owner] || a.owner || 'You', fmtMoney(a.balance)]
        : [a.name || typeLabels[key] || 'Account', typeLabels[key] || key, fmtMoney(a.balance)]
      body.push(row)
    }
    body.push(spouseEnabled
      ? [{ content: `${typeLabels[key] || key} subtotal`, colSpan: 3, styles: { fontStyle: 'bold', halign: 'right' } }, { content: fmtMoney(g.total), styles: { fontStyle: 'bold' } }]
      : [{ content: `${typeLabels[key] || key} subtotal`, colSpan: 2, styles: { fontStyle: 'bold', halign: 'right' } }, { content: fmtMoney(g.total), styles: { fontStyle: 'bold' } }])
  }

  doc.autoTable({
    head,
    body,
    startY: CONTENT_TOP + 12,
    theme: 'grid',
    styles: { fontSize: 9, textColor: COLORS.body, lineColor: COLORS.line, cellPadding: 2 },
    headStyles: { fillColor: COLORS.primary, textColor: COLORS.white, fontStyle: 'bold' },
    tableWidth: 'auto',
    columnStyles: spouseEnabled
      ? { 3: { halign: 'right' } }
      : { 2: { halign: 'right' } },
    margin: { left: MARGIN, right: MARGIN },
  })
  let y = doc.lastAutoTable.finalY + 8

  setText(doc, COLORS.heading)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Total Assets', MARGIN, y)
  doc.text(fmtMoney(assetsTotal), PAGE_WIDTH - MARGIN, y, { align: 'right' })
  y += 6

  setText(doc, COLORS.muted)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('Liabilities', MARGIN, y)
  doc.text('No liabilities tracked', PAGE_WIDTH - MARGIN, y, { align: 'right' })
  y += 8

  setDraw(doc, COLORS.line)
  doc.line(MARGIN, y - 3, PAGE_WIDTH - MARGIN, y - 3)

  setText(doc, COLORS.primary)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('Total Net Worth', MARGIN, y + 2)
  doc.text(fmtMoney(assetsTotal), PAGE_WIDTH - MARGIN, y + 2, { align: 'right' })
}

function pageMonteCarlo(doc, ctx) {
  drawHeader(doc, 'Monte Carlo Analysis', ctx.dateStr)
  const monte = ctx.monte
  const pct = monte ? Math.round(monte.probability * 100) : null
  const color = pct == null ? COLORS.muted : pct >= 85 ? COLORS.success : pct >= 70 ? COLORS.warn : COLORS.negative

  setText(doc, COLORS.muted)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('Probability of success', MARGIN, CONTENT_TOP + 16)

  setText(doc, color)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(60)
  doc.text(pct != null ? `${pct}%` : '—', MARGIN, CONTENT_TOP + 46)

  let y = CONTENT_TOP + 60
  setText(doc, COLORS.body)
  doc.setFont('helvetica', 'normal')
  const explainer = `Monte Carlo simulation models your plan against 1,000 randomized market scenarios. A success rate of ${pct != null ? pct + '%' : 'N/A'} means your plan avoided running short in that share of trials. Plans in the 80–95% range are generally considered robust; below 70% indicates meaningful risk. This is a probabilistic tool, not a guarantee.`
  y = addParagraph(doc, explainer, MARGIN, y, USABLE_WIDTH, { size: 10, lineHeight: 5, color: COLORS.body })
  y += 6

  if (monte) {
    doc.autoTable({
      head: [['Percentile', 'Final balance']],
      body: [
        ['25th (weak markets)', fmtMoney(monte.p25)],
        ['50th (median)', fmtMoney(monte.p50)],
        ['75th (strong markets)', fmtMoney(monte.p75)],
      ],
      startY: y,
      theme: 'grid',
      styles: { fontSize: 10, textColor: COLORS.body, lineColor: COLORS.line, cellPadding: 2.5 },
      headStyles: { fillColor: COLORS.primary, textColor: COLORS.white, fontStyle: 'bold' },
      tableWidth: 'auto',
      columnStyles: { 1: { halign: 'right' } },
      margin: { left: MARGIN, right: MARGIN },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  setText(doc, COLORS.muted)
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8.5)
  const disclaimer = 'Monte Carlo results are hypothetical and based on the assumptions you\u2019ve entered. Actual outcomes will vary with market performance, inflation, spending patterns, and life events. This analysis should not be interpreted as a guarantee of future results.'
  addParagraph(doc, disclaimer, MARGIN, y, USABLE_WIDTH, { size: 8.5, lineHeight: 4.2, color: COLORS.muted })
}

function pageKeyMetrics(doc, ctx) {
  drawHeader(doc, 'Key Plan Metrics', ctx.dateStr)
  const { inputs, results, netSpending, taxSummary, totals, derivedAge } = ctx
  const ytr = inputs.retirementAge - derivedAge
  const lifeYtd = inputs.lifeExpectancy - derivedAge
  const infl = (inputs.inflationRate || 0) / 100
  const retToday = (results.retirementBalance || 0) / Math.pow(1 + infl, ytr)
  const finalToday = (results.finalBalance || 0) / Math.pow(1 + infl, lifeYtd)
  const fourPctToday = (results.retirementBalance || 0) * 0.04 / Math.pow(1 + infl, ytr)
  const wrRate = results.retirementBalance > 0 ? (inputs.retirementIncomeNeeded / results.retirementBalance * 100).toFixed(1) : '—'

  const metrics = [
    { label: 'Current portfolio', value: fmtMoney(totals?.investable || 0), sub: 'Total investable today' },
    { label: 'At retirement', value: fmtMoney(retToday), sub: `Age ${inputs.retirementAge} (today's $)` },
    { label: 'At life expectancy', value: fmtMoney(finalToday), sub: `Age ${inputs.lifeExpectancy} (today's $)` },
    { label: 'Sustainable income', value: fmtMoney(fourPctToday), sub: '4% rule, gross annual' },
    { label: 'Initial withdrawal rate', value: `${wrRate}%`, sub: Number(wrRate) > 5 ? 'Above safe threshold' : 'Within safe range' },
    { label: 'Take-home spending', value: `${fmtMoney(netSpending.firstYearNetSpendingMonthly)}/mo`, sub: `${fmtMoney(netSpending.firstYearNetSpending)} annual (today's $)` },
    { label: 'Lifetime taxes', value: fmtMoney(taxSummary.totalLifetimeTaxes), sub: 'Federal + state, retirement years' },
    { label: 'Avg. effective tax rate', value: `${Math.round(taxSummary.avgEffectiveRate * 100)}%`, sub: 'Across retirement years' },
  ]

  const cols = 2
  const gap = 4
  const cardW = (USABLE_WIDTH - gap * (cols - 1)) / cols
  const cardH = 32
  const startY = CONTENT_TOP + 12
  metrics.forEach((m, i) => {
    const row = Math.floor(i / cols)
    const col = i % cols
    const x = MARGIN + col * (cardW + gap)
    const y = startY + row * (cardH + gap)
    setFill(doc, COLORS.box)
    setDraw(doc, COLORS.line)
    doc.setLineWidth(0.2)
    doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD')

    setText(doc, COLORS.muted)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(m.label.toUpperCase(), x + 4, y + 7)

    setText(doc, COLORS.heading)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(18)
    doc.text(m.value, x + 4, y + 20)

    setText(doc, COLORS.muted)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(m.sub, x + 4, y + 27)
  })
}

function pageChart(doc, ctx, { title, image, caption }) {
  drawHeader(doc, title, ctx.dateStr)
  let y = CONTENT_TOP + 12
  if (image && image.dataUrl) {
    const imgWidth = USABLE_WIDTH
    const imgHeight = imgWidth * (image.height / image.width)
    doc.addImage(image.dataUrl, 'PNG', MARGIN, y, imgWidth, imgHeight)
    y += imgHeight + 8
  } else {
    const placeholderH = 90
    setFill(doc, [245, 245, 245])
    setDraw(doc, [200, 200, 200])
    doc.setLineWidth(0.3)
    doc.rect(MARGIN, y, USABLE_WIDTH, placeholderH, 'FD')
    setText(doc, [120, 120, 120])
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(`Chart preview unavailable: ${title}`, PAGE_WIDTH / 2, y + placeholderH / 2 - 3, { align: 'center' })
    doc.setFontSize(8.5)
    doc.text('View the live chart in the calculator for this section.', PAGE_WIDTH / 2, y + placeholderH / 2 + 4, { align: 'center' })
    y += placeholderH + 8
  }
  if (caption) {
    y = addParagraph(doc, caption, MARGIN, y, USABLE_WIDTH, { size: 10, lineHeight: 5, color: COLORS.body })
  }
}

function pageYearByYear(doc, ctx) {
  drawHeader(doc, 'Year-by-Year Cash Flow', ctx.dateStr)
  const rows = ctx.cashFlowRows || []
  const retireIdx = rows.findIndex((r) => r.phase === 'retirement')

  const head = [['Year', 'Age', 'Income', 'Planned Dist', 'Inflows', 'Expenses', 'Outflows', 'Taxes', 'Net CF', 'Portfolio']]
  const body = []
  rows.forEach((r, i) => {
    if (i === retireIdx && retireIdx > 0) {
      body.push([{ content: `Retirement begins — age ${ctx.inputs.retirementAge}`, colSpan: 10, styles: { fillColor: [219, 234, 254], textColor: COLORS.primary, fontStyle: 'bold', halign: 'center' } }])
    }
    const ageLabel = r.spouseAge != null ? `${r.age}/${r.spouseAge}` : `${r.age}`
    const ncfColor = Math.round(r.netCashFlow) < 0 ? COLORS.negative : Math.round(r.netCashFlow) > 0 ? COLORS.success : COLORS.body
    const row = [
      String(r.year),
      ageLabel,
      fmtMoney(r.incomeFlows),
      fmtMoney(r.plannedDistributions),
      fmtMoney(r.totalInflows),
      fmtMoney(r.totalExpenses),
      fmtMoney(r.totalOutflows),
      fmtMoney(r.taxes),
      { content: fmtMoney(r.netCashFlow), styles: { textColor: ncfColor, fontStyle: 'bold' } },
      fmtMoney(r.portfolioAssets),
    ]
    body.push(row)
  })

  doc.autoTable({
    head,
    body,
    startY: CONTENT_TOP + 12,
    theme: 'grid',
    styles: {
      fontSize: 7,
      textColor: COLORS.body,
      lineColor: COLORS.line,
      cellPadding: 1.2,
      halign: 'right',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: COLORS.primary,
      textColor: COLORS.white,
      fontStyle: 'bold',
      fontSize: 7,
      halign: 'center',
    },
    columnStyles: {
      0: { halign: 'center' },
      1: { halign: 'center' },
    },
    tableWidth: 'auto',
    didDrawPage: () => {
      drawHeader(doc, 'Year-by-Year Cash Flow', ctx.dateStr)
    },
    margin: { top: CONTENT_TOP + 12, bottom: MARGIN + FOOTER_HEIGHT, left: MARGIN, right: MARGIN },
  })
}

function pageInsights(doc, ctx) {
  drawHeader(doc, 'Insights & Recommendations', ctx.dateStr)
  let y = CONTENT_TOP + 12
  const prompts = ctx.advisorPrompts || []
  if (prompts.length === 0) {
    setText(doc, COLORS.body)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    addParagraph(doc, 'Your plan looks solid. Consider a periodic review with an advisor to stress-test assumptions.', MARGIN, y, USABLE_WIDTH, { size: 11, lineHeight: 6 })
    return
  }
  for (const p of prompts) {
    if (y > CONTENT_BOTTOM - 30) { doc.addPage(); drawHeader(doc, 'Insights & Recommendations (cont.)', ctx.dateStr); y = CONTENT_TOP + 12 }
    setFill(doc, COLORS.box)
    setDraw(doc, COLORS.line)
    doc.setLineWidth(0.2)
    const lines = doc.splitTextToSize(p.message, USABLE_WIDTH - 6)
    const boxH = 14 + lines.length * 5
    doc.roundedRect(MARGIN, y, USABLE_WIDTH, boxH, 2, 2, 'FD')

    setText(doc, COLORS.heading)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.text(p.title, MARGIN + 3, y + 7)

    setText(doc, COLORS.body)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    lines.forEach((line, i) => doc.text(line, MARGIN + 3, y + 13 + i * 5))

    setText(doc, COLORS.primary)
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8.5)
    doc.text('Talk to a Capital Investment Advisor', MARGIN + 3, y + boxH - 2)

    y += boxH + 5
  }
}

function pageDisclosures(doc, ctx) {
  drawHeader(doc, 'Important Information and Disclosures', ctx.dateStr)
  let y = CONTENT_TOP + 12
  const sections = [
    {
      title: 'Information Provided by You',
      body: 'This plan is based on information you provided about your age, income, savings, accounts, and retirement goals. The accuracy of the projections depends on the accuracy of this information. Any errors or omissions may materially affect the results.',
    },
    {
      title: 'Inherent Limitations in Financial Model Results',
      body: 'Financial projections are hypothetical illustrations based on mathematical models using assumptions about future market performance, inflation, tax rates, and other variables. Actual results will differ, often significantly. This plan should not be relied upon as a precise forecast of your financial future.',
    },
    {
      title: 'Monte Carlo Simulations',
      body: 'Monte Carlo simulations use randomized variations in investment returns to model the uncertainty of future outcomes. The probability of success reflects the percentage of simulated scenarios in which the plan met its goals. It is not a guarantee and does not reflect all real-world risks such as sequence of returns risk, health events, or unexpected large expenses.',
    },
    {
      title: 'Tax Calculations',
      body: 'Tax estimates use 2026 federal brackets and the standard deduction, and a simplified flat-rate state tax based on your entered rate. They do not reflect all nuances of the tax code, including the Net Investment Income Tax, IRMAA Medicare surcharges, the Alternative Minimum Tax, or state-specific treatment of retirement income. Consult a tax professional for precise planning.',
    },
    {
      title: 'Not Investment Advice',
      body: 'This document is provided for informational purposes only and does not constitute investment, tax, or legal advice. Before making any decisions, consult qualified professionals who understand your full financial situation.',
    },
  ]
  for (const s of sections) {
    if (y > CONTENT_BOTTOM - 25) { doc.addPage(); drawHeader(doc, 'Important Information and Disclosures (cont.)', ctx.dateStr); y = CONTENT_TOP + 12 }
    y = addSubheading(doc, s.title, MARGIN, y)
    y = addParagraph(doc, s.body, MARGIN, y + 1, USABLE_WIDTH, { size: 9, lineHeight: 4.5, color: COLORS.body })
    y += 5
  }
}

function pageDisclaimer(doc, ctx) {
  drawHeader(doc, 'Disclaimer', ctx.dateStr)
  let y = CONTENT_TOP + 12
  const body = 'Glide by Clark.com provides illustrative retirement projections for educational purposes. No plan, simulation, or projection should be relied upon as a sole basis for financial decisions. Past performance is not indicative of future results. All investments involve risk, including loss of principal.'
  y = addParagraph(doc, body, MARGIN, y, USABLE_WIDTH, { size: 10, lineHeight: 5.2, color: COLORS.body })
  y += 10

  setText(doc, COLORS.heading)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('Glide by Clark.com', MARGIN, y); y += 6

  setText(doc, COLORS.body)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text('Capital Investment Advisors', MARGIN, y); y += 5
  doc.text('10 Glenlake Parkway NE · Atlanta, GA 30328', MARGIN, y); y += 5
  doc.text('(404) 531-0018', MARGIN, y); y += 12

  setText(doc, COLORS.muted)
  doc.setFontSize(8.5)
  doc.text(`© ${new Date().getFullYear()} Glide by Clark.com. All rights reserved.`, MARGIN, y)
}

// ─── Entry point ─────────────────────────────────────────────────

export async function generatePdf(ctx) {
  if (typeof window === 'undefined' || !window.jspdf?.jsPDF) {
    throw new Error('PDF library not loaded yet.')
  }
  const { jsPDF } = window.jspdf

  const [chartProjection, chartCashflow, chartComposition, chartInflows] = await Promise.all([
    captureChart('pdf-chart-projection'),
    captureChart('pdf-chart-cashflow'),
    captureChart('pdf-chart-composition'),
    captureChart('pdf-chart-inflows'),
  ])

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const today = new Date()
  const dateStr = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const fullCtx = { ...ctx, dateStr }

  const tocEntries = []
  const addTocEntry = (title) => tocEntries.push({ title, page: doc.getNumberOfPages() })

  pageCover(doc, fullCtx)

  doc.addPage(); // page 2 reserved for TOC, rendered last

  doc.addPage(); addTocEntry('Plan Summary'); pagePlanSummary(doc, fullCtx)
  doc.addPage(); addTocEntry('Net Worth Statement'); pageNetWorth(doc, fullCtx)
  doc.addPage(); addTocEntry('Monte Carlo Analysis'); pageMonteCarlo(doc, fullCtx)
  doc.addPage(); addTocEntry('Key Plan Metrics'); pageKeyMetrics(doc, fullCtx)

  const chartPages = [
    { title: 'Portfolio Projection', image: chartProjection, caption: `Projected using ${ctx.inputs.preRetirementReturn}% pre-retirement return and ${ctx.inputs.postRetirementReturn}% post-retirement return, with ${ctx.inputs.inflationRate}% inflation. Balances shown in ${ctx.inputs.showFutureDollars ? 'future' : "today's"} dollars.` },
    { title: 'Retirement Cash Flow', image: chartCashflow, caption: 'Each year\u2019s spending is funded by guaranteed income (Social Security, pension, other income) and portfolio withdrawals. The stacked bars show how each source contributes to total retirement income; the line shows total expenses.' },
    { title: 'Portfolio Composition', image: chartComposition, caption: 'Account balances by tax bucket over time. Pretax accounts dominate during accumulation; retirement draws shift composition toward taxable and Roth as RMDs begin and buckets deplete at different rates.' },
    { title: 'Annual Inflows vs. Outflows', image: chartInflows, caption: 'Green shows total money flowing in each year (Social Security plus other income). Red shows total money flowing out. The gap is what the portfolio must fund. Expenses rise with inflation while income tends to plateau.' },
  ]
  for (const cp of chartPages) {
    doc.addPage(); addTocEntry(cp.title); pageChart(doc, fullCtx, cp)
  }

  doc.addPage(); addTocEntry('Year-by-Year Cash Flow'); pageYearByYear(doc, fullCtx)
  doc.addPage(); addTocEntry('Insights & Recommendations'); pageInsights(doc, fullCtx)
  doc.addPage(); addTocEntry('Important Information and Disclosures'); pageDisclosures(doc, fullCtx)
  doc.addPage(); addTocEntry('Disclaimer'); pageDisclaimer(doc, fullCtx)

  // Render TOC on page 2
  doc.setPage(2)
  pageTOC(doc, fullCtx, tocEntries)

  // Footers on every page
  const totalPages = doc.getNumberOfPages()
  for (let i = 2; i <= totalPages; i++) {
    doc.setPage(i)
    drawFooter(doc, i, totalPages)
  }

  const scenarioSlug = slug(ctx.scenarioName || 'plan')
  const dateSlug = today.toISOString().slice(0, 10)
  const filename = `glide-retirement-plan-${scenarioSlug}-${dateSlug}.pdf`
  doc.save(filename)
}
