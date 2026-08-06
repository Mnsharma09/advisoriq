// Mock financial plan data for all 12 clients.
// Imported and merged with base client data in appStore.ts.
// Values are intentionally consistent with each client's existing AUM, risk
// profile, employment, and goals data.

import type { NetWorth, CashFlow, InsuranceCoverage, EstatePlan } from '@/types';

export interface ClientFinancialPlan {
  clientId: string;
  retirementAge: number;
  desiredMonthlyRetirementIncome: number;
  netWorth: NetWorth;
  cashFlow: CashFlow;
  insurance: InsuranceCoverage[];
  estatePlan: EstatePlan;
}

const months6 = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'];

function makeHistory(
  income: number,
  expenses: number,
  variance = 0.05
): CashFlow['history'] {
  return months6.map((month, i) => {
    const inc = Math.round(income * (1 + (i % 2 === 0 ? variance : -variance * 0.5)));
    const exp = Math.round(expenses * (1 + (i % 3 === 0 ? variance * 0.6 : -variance * 0.3)));
    return { month, income: inc, expenses: exp, savings: inc - exp };
  });
}

export const financialPlanData: ClientFinancialPlan[] = [
  // ── client-001  Sarah Chen ────────────────────────────────────────────────
  {
    clientId: 'client-001',
    retirementAge: 52,
    desiredMonthlyRetirementIncome: 12000,
    netWorth: {
      assets: { investmentAccounts: 418000, primaryResidence: 0, otherAssets: 65000 },
      liabilities: { mortgage: 0, otherDebt: 15000 },
      trend: 'up',
    },
    cashFlow: {
      monthlyIncome: 21000,
      monthlyExpenses: 16000,
      monthlySavings: 5000,
      history: makeHistory(21000, 16000, 0.06),
    },
    insurance: [
      { type: 'Life Insurance', status: 'Review Needed', notes: 'Employer group coverage at TechFlow only — no personal policy. Startup employment increases coverage gap risk.' },
      { type: 'Disability Insurance', status: 'In Place', coverageAmount: 12000, lastReviewDate: '2025-06-01', notes: 'Own-occupation LTD — obtained personally, not through employer' },
      { type: 'Long-Term Care Insurance', status: 'Not Covered', notes: 'Review at 50 — currently appropriate to defer' },
      { type: 'Umbrella Liability', status: 'Not Covered', notes: 'Recommended given growing investment portfolio and startup equity exposure' },
    ],
    estatePlan: {
      documents: [
        { document: 'Will', status: 'Missing' },
        { document: 'Revocable Trust', status: 'Missing' },
        { document: 'Beneficiary Designations', status: 'Needs Update', lastReviewDate: '2022-03-01' },
        { document: 'Power of Attorney', status: 'Missing' },
        { document: 'Healthcare Directive', status: 'Missing' },
        { document: 'HIPAA Authorization', status: 'Missing' },
      ],
    },
  },

  // ── client-002  Marcus Rivera ─────────────────────────────────────────────
  {
    clientId: 'client-002',
    retirementAge: 55,
    desiredMonthlyRetirementIncome: 12000,
    netWorth: {
      assets: { investmentAccounts: 920000, primaryResidence: 680000, otherAssets: 350000 },
      liabilities: { mortgage: 310000, otherDebt: 85000 },
      trend: 'up',
    },
    cashFlow: {
      monthlyIncome: 28000,
      monthlyExpenses: 18000,
      monthlySavings: 10000,
      history: makeHistory(28000, 18000, 0.08),
    },
    insurance: [
      { type: 'Life Insurance', status: 'In Place', coverageAmount: 1500000, lastReviewDate: '2024-02-01', notes: 'Term policy — business key-man rider needed' },
      { type: 'Disability Insurance', status: 'Review Needed', notes: 'Only employer group policy — insufficient for business owner' },
      { type: 'Long-Term Care Insurance', status: 'Not Covered', notes: 'Not yet discussed' },
      { type: 'Umbrella Liability', status: 'In Place', coverageAmount: 1000000, lastReviewDate: '2024-02-01' },
    ],
    estatePlan: {
      documents: [
        { document: 'Will', status: 'In Place', lastReviewDate: '2022-09-01' },
        { document: 'Revocable Trust', status: 'Needs Update', lastReviewDate: '2020-06-15' },
        { document: 'Beneficiary Designations', status: 'Needs Update', lastReviewDate: '2021-01-01' },
        { document: 'Power of Attorney', status: 'In Place', lastReviewDate: '2022-09-01' },
        { document: 'Healthcare Directive', status: 'Missing' },
        { document: 'HIPAA Authorization', status: 'Missing' },
      ],
    },
  },

  // ── client-003  The Patel Family ──────────────────────────────────────────
  {
    clientId: 'client-003',
    retirementAge: 62,
    desiredMonthlyRetirementIncome: 18000,
    netWorth: {
      assets: { investmentAccounts: 3200000, primaryResidence: 1800000, otherAssets: 420000 },
      liabilities: { mortgage: 0, otherDebt: 15000 },
      trend: 'up',
    },
    cashFlow: {
      monthlyIncome: 32000,
      monthlyExpenses: 16000,
      monthlySavings: 16000,
      history: makeHistory(32000, 16000),
    },
    insurance: [
      { type: 'Life Insurance', status: 'In Place', coverageAmount: 3000000, lastReviewDate: '2024-11-01', notes: 'Universal life — estate planning vehicle' },
      { type: 'Disability Insurance', status: 'In Place', coverageAmount: 12000, lastReviewDate: '2024-11-01', notes: 'Consulting income covered' },
      { type: 'Long-Term Care Insurance', status: 'Review Needed', notes: 'LTC quote requested — awaiting carrier responses' },
      { type: 'Umbrella Liability', status: 'In Place', coverageAmount: 5000000, lastReviewDate: '2025-01-01' },
    ],
    estatePlan: {
      documents: [
        { document: 'Will', status: 'In Place', lastReviewDate: '2025-06-10' },
        { document: 'Revocable Trust', status: 'In Place', lastReviewDate: '2025-06-10' },
        { document: 'Beneficiary Designations', status: 'In Place', lastReviewDate: '2025-06-10' },
        { document: 'Power of Attorney', status: 'In Place', lastReviewDate: '2025-06-10' },
        { document: 'Healthcare Directive', status: 'In Place', lastReviewDate: '2025-06-10' },
        { document: 'HIPAA Authorization', status: 'In Place', lastReviewDate: '2025-06-10' },
      ],
    },
  },

  // ── client-004  James & Dorothy Whitfield ─────────────────────────────────
  {
    clientId: 'client-004',
    retirementAge: 71,
    desiredMonthlyRetirementIncome: 10000,
    netWorth: {
      assets: { investmentAccounts: 2100000, primaryResidence: 750000, otherAssets: 180000 },
      liabilities: { mortgage: 0, otherDebt: 8000 },
      trend: 'flat',
    },
    cashFlow: {
      monthlyIncome: 14500,
      monthlyExpenses: 12000,
      monthlySavings: 2500,
      history: makeHistory(14500, 12000, 0.03),
    },
    insurance: [
      { type: 'Life Insurance', status: 'In Place', coverageAmount: 500000, lastReviewDate: '2024-01-12', notes: 'Whole life policy — primarily estate transfer' },
      { type: 'Disability Insurance', status: 'Not Covered', notes: 'Retired — not applicable' },
      { type: 'Long-Term Care Insurance', status: 'In Place', coverageAmount: 6000, lastReviewDate: '2024-10-08', notes: '$6,000/month benefit for 3 years each' },
      { type: 'Umbrella Liability', status: 'In Place', coverageAmount: 2000000, lastReviewDate: '2024-01-12' },
    ],
    estatePlan: {
      documents: [
        { document: 'Will', status: 'In Place', lastReviewDate: '2023-06-01' },
        { document: 'Revocable Trust', status: 'In Place', lastReviewDate: '2023-06-01' },
        { document: 'Beneficiary Designations', status: 'In Place', lastReviewDate: '2024-01-12' },
        { document: 'Power of Attorney', status: 'In Place', lastReviewDate: '2023-06-01' },
        { document: 'Healthcare Directive', status: 'In Place', lastReviewDate: '2023-06-01' },
        { document: 'HIPAA Authorization', status: 'Needs Update', lastReviewDate: '2020-03-01' },
      ],
    },
  },

  // ── client-005  Linda Okafor ──────────────────────────────────────────────
  {
    clientId: 'client-005',
    retirementAge: 55,
    desiredMonthlyRetirementIncome: 20000,
    netWorth: {
      assets: { investmentAccounts: 680000, primaryResidence: 0, otherAssets: 120000 },
      liabilities: { mortgage: 0, otherDebt: 45000 },
      trend: 'up',
    },
    cashFlow: {
      monthlyIncome: 40000,
      monthlyExpenses: 18000,
      monthlySavings: 22000,
      history: makeHistory(40000, 18000, 0.04),
    },
    insurance: [
      { type: 'Life Insurance', status: 'Review Needed', notes: 'No personal policy — only employer group coverage of $500K' },
      { type: 'Disability Insurance', status: 'In Place', coverageAmount: 25000, lastReviewDate: '2025-01-01', notes: 'Own-occupation LTD — purchased personally' },
      { type: 'Long-Term Care Insurance', status: 'Not Covered', notes: 'Too early — review at 45' },
      { type: 'Umbrella Liability', status: 'In Place', coverageAmount: 2000000, lastReviewDate: '2025-11-05' },
    ],
    estatePlan: {
      documents: [
        { document: 'Will', status: 'In Place', lastReviewDate: '2024-03-01' },
        { document: 'Revocable Trust', status: 'Missing' },
        { document: 'Beneficiary Designations', status: 'In Place', lastReviewDate: '2024-03-01' },
        { document: 'Power of Attorney', status: 'In Place', lastReviewDate: '2024-03-01' },
        { document: 'Healthcare Directive', status: 'Needs Update', lastReviewDate: '2021-07-15' },
        { document: 'HIPAA Authorization', status: 'Missing' },
      ],
    },
  },

  // ── client-006  Robert Nakamura ───────────────────────────────────────────
  {
    clientId: 'client-006',
    retirementAge: 65,
    desiredMonthlyRetirementIncome: 8500,
    netWorth: {
      assets: { investmentAccounts: 1420000, primaryResidence: 920000, otherAssets: 240000 },
      liabilities: { mortgage: 185000, otherDebt: 8000 },
      trend: 'up',
    },
    cashFlow: {
      monthlyIncome: 18500,
      monthlyExpenses: 10500,
      monthlySavings: 8000,
      history: makeHistory(18500, 10500),
    },
    insurance: [
      { type: 'Life Insurance', status: 'Review Needed', notes: 'Term policy expires at 70 — evaluate conversion to permanent given recently changed estate picture from rental property proceeds' },
      { type: 'Disability Insurance', status: 'Not Covered', notes: 'Retired — no longer applicable; previous group policy lapsed at retirement in December 2025' },
      { type: 'Long-Term Care Insurance', status: 'Review Needed', notes: 'Priority evaluation — just retired and window for preferred rates is narrowing; age 64 is optimal entry point' },
      { type: 'Umbrella Liability', status: 'In Place', coverageAmount: 2000000, lastReviewDate: '2026-02-04' },
    ],
    estatePlan: {
      documents: [
        { document: 'Will', status: 'In Place', lastReviewDate: '2024-06-01' },
        { document: 'Revocable Trust', status: 'In Place', lastReviewDate: '2024-06-01' },
        { document: 'Beneficiary Designations', status: 'Needs Update', lastReviewDate: '2022-05-15', notes: 'Must update to reflect rental property sale proceeds and revised estate distribution — flag for attorney' },
        { document: 'Power of Attorney', status: 'In Place', lastReviewDate: '2024-06-01' },
        { document: 'Healthcare Directive', status: 'In Place', lastReviewDate: '2024-06-01' },
        { document: 'HIPAA Authorization', status: 'In Place', lastReviewDate: '2024-06-01' },
      ],
    },
  },

  // ── client-007  Amanda and Greg Hoffman ───────────────────────────────────
  {
    clientId: 'client-007',
    retirementAge: 60,
    desiredMonthlyRetirementIncome: 25000,
    netWorth: {
      assets: { investmentAccounts: 2800000, primaryResidence: 1900000, otherAssets: 450000 },
      liabilities: { mortgage: 750000, otherDebt: 60000 },
      trend: 'up',
    },
    cashFlow: {
      monthlyIncome: 58000,
      monthlyExpenses: 30000,
      monthlySavings: 28000,
      history: makeHistory(58000, 30000, 0.06),
    },
    insurance: [
      { type: 'Life Insurance', status: 'In Place', coverageAmount: 5000000, lastReviewDate: '2025-09-10', notes: 'Combined term + whole life for both spouses' },
      { type: 'Disability Insurance', status: 'In Place', coverageAmount: 30000, lastReviewDate: '2025-09-10', notes: 'Own-occupation policy for Greg — critical given practice ownership' },
      { type: 'Long-Term Care Insurance', status: 'Review Needed', notes: 'Discuss at next annual review — both in mid-40s' },
      { type: 'Umbrella Liability', status: 'In Place', coverageAmount: 5000000, lastReviewDate: '2025-09-10', notes: 'High coverage due to medical practice liability exposure' },
    ],
    estatePlan: {
      documents: [
        { document: 'Will', status: 'In Place', lastReviewDate: '2024-10-22' },
        { document: 'Revocable Trust', status: 'In Place', lastReviewDate: '2024-10-22' },
        { document: 'Beneficiary Designations', status: 'Needs Update', lastReviewDate: '2023-02-01' },
        { document: 'Power of Attorney', status: 'In Place', lastReviewDate: '2024-10-22' },
        { document: 'Healthcare Directive', status: 'In Place', lastReviewDate: '2024-10-22' },
        { document: 'HIPAA Authorization', status: 'In Place', lastReviewDate: '2024-10-22' },
      ],
    },
  },

  // ── client-008  Thomas Beaumont ───────────────────────────────────────────
  {
    clientId: 'client-008',
    retirementAge: 60,
    desiredMonthlyRetirementIncome: 30000,
    netWorth: {
      assets: { investmentAccounts: 3100000, primaryResidence: 2200000, otherAssets: 800000 },
      liabilities: { mortgage: 900000, otherDebt: 120000 },
      trend: 'down',
    },
    cashFlow: {
      monthlyIncome: 55000,
      monthlyExpenses: 32000,
      monthlySavings: 23000,
      history: makeHistory(55000, 32000, 0.07),
    },
    insurance: [
      { type: 'Life Insurance', status: 'In Place', coverageAmount: 5000000, lastReviewDate: '2025-02-28', notes: 'Permanent life — split-dollar arrangement with PE firm' },
      { type: 'Disability Insurance', status: 'Review Needed', notes: 'Group policy only — insufficient at current income level' },
      { type: 'Long-Term Care Insurance', status: 'Not Covered', notes: 'Has expressed preference for self-insuring — review plan' },
      { type: 'Umbrella Liability', status: 'In Place', coverageAmount: 10000000, lastReviewDate: '2025-02-28', notes: 'High coverage — PE fund management exposure' },
    ],
    estatePlan: {
      documents: [
        { document: 'Will', status: 'In Place', lastReviewDate: '2023-11-01' },
        { document: 'Revocable Trust', status: 'Needs Update', lastReviewDate: '2022-08-01' },
        { document: 'Beneficiary Designations', status: 'Needs Update', lastReviewDate: '2022-10-15' },
        { document: 'Power of Attorney', status: 'In Place', lastReviewDate: '2023-11-01' },
        { document: 'Healthcare Directive', status: 'Missing' },
        { document: 'HIPAA Authorization', status: 'Missing' },
      ],
    },
  },

  // ── client-009  Priya Krishnaswamy ────────────────────────────────────────
  {
    clientId: 'client-009',
    retirementAge: 55,
    desiredMonthlyRetirementIncome: 8000,
    netWorth: {
      assets: { investmentAccounts: 892000, primaryResidence: 0, otherAssets: 95000 },
      liabilities: { mortgage: 0, otherDebt: 0 },
      trend: 'up',
    },
    cashFlow: {
      monthlyIncome: 11000,
      monthlyExpenses: 8000,
      monthlySavings: 3000,
      history: makeHistory(11000, 8000, 0.04),
    },
    insurance: [
      { type: 'Life Insurance', status: 'Review Needed', notes: 'University group life only — no personal policy. Growing estate and potential eldercare responsibilities make personal coverage a priority.' },
      { type: 'Disability Insurance', status: 'In Place', coverageAmount: 7500, lastReviewDate: '2025-09-01', notes: 'Stanford group LTD — adequate for academic salary; review if sabbatical reduces benefit' },
      { type: 'Long-Term Care Insurance', status: 'Not Covered', notes: 'Begin evaluation at 55 — 4 years out; pricing window is approaching' },
      { type: 'Umbrella Liability', status: 'Not Covered', notes: 'Recommended given $892K portfolio — obtain $1M–$2M policy before retirement' },
    ],
    estatePlan: {
      documents: [
        { document: 'Will', status: 'In Place', lastReviewDate: '2024-01-15' },
        { document: 'Revocable Trust', status: 'Needs Update', lastReviewDate: '2021-05-10', notes: 'Needs update for eldercare provisions and to reflect current asset levels — flag for attorney review' },
        { document: 'Beneficiary Designations', status: 'In Place', lastReviewDate: '2025-09-01' },
        { document: 'Power of Attorney', status: 'In Place', lastReviewDate: '2024-01-15' },
        { document: 'Healthcare Directive', status: 'In Place', lastReviewDate: '2024-01-15' },
        { document: 'HIPAA Authorization', status: 'Needs Update', lastReviewDate: '2021-01-01' },
      ],
    },
  },

  // ── client-010  Elena Vasquez ─────────────────────────────────────────────
  {
    clientId: 'client-010',
    retirementAge: 57,
    desiredMonthlyRetirementIncome: 8500,
    netWorth: {
      assets: { investmentAccounts: 890000, primaryResidence: 520000, otherAssets: 65000 },
      liabilities: { mortgage: 195000, otherDebt: 18000 },
      trend: 'flat',
    },
    cashFlow: {
      monthlyIncome: 12500,
      monthlyExpenses: 9000,
      monthlySavings: 3500,
      history: makeHistory(12500, 9000, 0.04),
    },
    insurance: [
      { type: 'Life Insurance', status: 'In Place', coverageAmount: 500000, lastReviewDate: '2024-08-15', notes: 'FEGLI government group life insurance' },
      { type: 'Disability Insurance', status: 'In Place', coverageAmount: 4500, lastReviewDate: '2024-08-15', notes: 'Federal employee FECA coverage' },
      { type: 'Long-Term Care Insurance', status: 'Review Needed', notes: 'FLTCIP federal program — needs enrollment review' },
      { type: 'Umbrella Liability', status: 'Not Covered', notes: 'Recommend obtaining — especially with mother as dependent' },
    ],
    estatePlan: {
      documents: [
        { document: 'Will', status: 'In Place', lastReviewDate: '2023-09-01' },
        { document: 'Revocable Trust', status: 'Missing' },
        { document: 'Beneficiary Designations', status: 'In Place', lastReviewDate: '2024-08-15' },
        { document: 'Power of Attorney', status: 'In Place', lastReviewDate: '2023-09-01', notes: 'Financial POA for mother also in place' },
        { document: 'Healthcare Directive', status: 'In Place', lastReviewDate: '2023-09-01' },
        { document: 'HIPAA Authorization', status: 'Needs Update', lastReviewDate: '2021-09-01' },
      ],
    },
  },

  // ── client-011  David and Sue Park ────────────────────────────────────────
  {
    clientId: 'client-011',
    retirementAge: 62,
    desiredMonthlyRetirementIncome: 12000,
    netWorth: {
      assets: { investmentAccounts: 1120000, primaryResidence: 620000, otherAssets: 95000 },
      liabilities: { mortgage: 280000, otherDebt: 35000 },
      trend: 'up',
    },
    cashFlow: {
      monthlyIncome: 26000,
      monthlyExpenses: 16000,
      monthlySavings: 10000,
      history: makeHistory(26000, 16000, 0.05),
    },
    insurance: [
      { type: 'Life Insurance', status: 'In Place', coverageAmount: 1500000, lastReviewDate: '2026-01-08', notes: 'Term for both spouses through 2040' },
      { type: 'Disability Insurance', status: 'In Place', coverageAmount: 12000, lastReviewDate: '2026-01-08', notes: 'David: group dental policy + own-occ rider; Sue: reviewing for new practice' },
      { type: 'Long-Term Care Insurance', status: 'Not Covered', notes: 'Review at 55 — currently focusing on practice launch fund' },
      { type: 'Umbrella Liability', status: 'In Place', coverageAmount: 2000000, lastReviewDate: '2026-01-08' },
    ],
    estatePlan: {
      documents: [
        { document: 'Will', status: 'In Place', lastReviewDate: '2024-04-01' },
        { document: 'Revocable Trust', status: 'Needs Update', lastReviewDate: '2022-04-01' },
        { document: 'Beneficiary Designations', status: 'In Place', lastReviewDate: '2026-01-08' },
        { document: 'Power of Attorney', status: 'In Place', lastReviewDate: '2024-04-01' },
        { document: 'Healthcare Directive', status: 'In Place', lastReviewDate: '2024-04-01' },
        { document: 'HIPAA Authorization', status: 'Missing' },
      ],
    },
  },

  // ── client-012  Michael Callahan ──────────────────────────────────────────
  {
    clientId: 'client-012',
    retirementAge: 65,
    desiredMonthlyRetirementIncome: 14000,
    netWorth: {
      assets: { investmentAccounts: 2450000, primaryResidence: 780000, otherAssets: 120000 },
      liabilities: { mortgage: 210000, otherDebt: 55000 },
      trend: 'down',
    },
    cashFlow: {
      monthlyIncome: 28000,
      monthlyExpenses: 20000,
      monthlySavings: 8000,
      history: makeHistory(28000, 20000, 0.04),
    },
    insurance: [
      { type: 'Life Insurance', status: 'Review Needed', notes: 'Beneficiaries need updating post-divorce — urgent' },
      { type: 'Disability Insurance', status: 'In Place', coverageAmount: 18000, lastReviewDate: '2024-08-05', notes: 'CFO group policy through Harrington Industries' },
      { type: 'Long-Term Care Insurance', status: 'Review Needed', notes: 'Approaching 65 — evaluate standalone LTC vs. hybrid policy' },
      { type: 'Umbrella Liability', status: 'In Place', coverageAmount: 3000000, lastReviewDate: '2024-08-05' },
    ],
    estatePlan: {
      documents: [
        { document: 'Will', status: 'Needs Update', lastReviewDate: '2022-12-01' },
        { document: 'Revocable Trust', status: 'Needs Update', lastReviewDate: '2022-12-01' },
        { document: 'Beneficiary Designations', status: 'Needs Update', lastReviewDate: '2022-12-01' },
        { document: 'Power of Attorney', status: 'In Place', lastReviewDate: '2022-12-01' },
        { document: 'Healthcare Directive', status: 'In Place', lastReviewDate: '2022-12-01' },
        { document: 'HIPAA Authorization', status: 'Missing' },
      ],
    },
  },
];
