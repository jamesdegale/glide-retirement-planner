import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'

export const plaidClient = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SANDBOX_SECRET,
      },
    },
  })
)

const RETIREMENT_SUBTYPES = new Set([
  '401k',
  '401a',
  '403b',
  '457b',
  'ira',
  'roth',
  'roth 401k',
  'roth ira',
  'simple ira',
  'sep ira',
  'thrift savings plan',
  'pension',
  'profit sharing plan',
  'retirement',
  'keogh',
])

export function categorize(type, subtype) {
  const t = (type || '').toLowerCase()
  const s = (subtype || '').toLowerCase()
  if (t === 'investment' || t === 'brokerage') {
    return RETIREMENT_SUBTYPES.has(s) ? 'retirement' : 'investment'
  }
  if (t === 'depository') return 'banking'
  if (t === 'loan' || t === 'credit') return 'loans'
  return 'other'
}
