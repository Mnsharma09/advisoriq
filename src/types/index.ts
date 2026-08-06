export type RiskProfile = 'Conservative' | 'Moderate' | 'Aggressive';
export type HealthColor = 'green' | 'amber' | 'red';
export type GoalType =
  | 'Retirement'
  | 'College Fund'
  | 'Home Purchase'
  | 'Emergency Fund'
  | 'Business Sale'
  // Synthetic data goal types
  | 'Business Exit'
  | 'Education'
  | 'Estate'
  | 'Charitable Giving'
  | 'Income Protection'
  | 'Retirement Income'
  | 'Property Purchase';
export type InteractionType = 'meeting' | 'call' | 'email';
export type SuggestionCategory = 'Portfolio' | 'Goals' | 'Tax' | 'Relationship' | 'Compliance';
export type SuggestionPriority = 'High' | 'Medium' | 'Low';
export type NewsCategory = 'Fed' | 'Markets' | 'Tax' | 'Sector' | 'Regulation';
export type AUMTier = 'Under $500K' | '$500K–$1M' | '$1M–$2M' | 'Over $2M';

export interface AllocationItem {
  assetClass: string;
  target: number;
  current: number;
}

export interface PerformanceDataPoint {
  month: string;
  portfolio: number;
  benchmark: number;
}

export interface Goal {
  id: string;
  type: GoalType;
  name: string;
  targetAmount: number;
  targetDate: string;
  currentAmount: number;
  monthlyContribution: number;
  onTrack: boolean;
}

export interface ActionItem {
  id: string;
  description: string;
  assignedTo: 'FA' | 'Client';
  dueDate: string;
  completed: boolean;
}

export interface Interaction {
  id: string;
  date: string;
  type: InteractionType;
  summary: string;
  actionItems: ActionItem[];
}

export interface FamilyMember {
  relationship: string;
  name: string;
  age?: number;
  note?: string;
}

export interface LifeEvent {
  date: string;
  description: string;
}

export interface ProductHolding {
  productType: string;
  held: boolean;
  flaggedAsGap: boolean;
}

export interface UpcomingMeeting {
  id: string;
  date: string;
  time: string;
  purpose: string;
}

export interface AISuggestion {
  id: string;
  category: SuggestionCategory;
  priority: SuggestionPriority;
  title: string;
  description: string;
}

export interface Client {
  id: string;
  name: string;
  age: number;
  employment: string;
  riskProfile: RiskProfile;
  aum: number;
  lastContact: string;
  allocation: AllocationItem[];
  performanceData: PerformanceDataPoint[];
  goals: Goal[];
  history: Interaction[];
  familyMembers: FamilyMember[];
  lifeEvents: LifeEvent[];
  upcomingMeetings: UpcomingMeeting[];
  personalitySummary: string;
  communicationPreferences: string;
  keyConcerns: string;
  birthday?: string;
  clientSince: string;
  aiSuggestions?: AISuggestion[];
  lastRebalanced: string;
  oneYearReturn: number;
  benchmarkReturn: number;
  // Financial Plan
  netWorth?: NetWorth;
  cashFlow?: CashFlow;
  insurance?: InsuranceCoverage[];
  estatePlan?: EstatePlan;
  retirementAge?: number;
  desiredMonthlyRetirementIncome?: number;
  savedScenarios?: SavedScenario[];
  // Synthetic data fields (populated when loading from public/data)
  contactStats?: {
    totalInteractions18m: number;
    openOverdueCommitments: number;
    avgSentimentScore: number;
  };
  nbaData?: {
    score: number | null;
    rank: number | null;
    primaryUrgencyReason: string | null;
    scenarioFlag: boolean | null;
  };
  productHoldings?: ProductHolding[];
  referralHistory?: ReferralRecord[];
}

export interface ReferralRecord {
  referralId: string;
  referredClientId: string;
  referralDate: string;
  converted: boolean;
  conversionDate?: string;
}

// ─── Financial Plan Types ─────────────────────────────────────────────────────

export interface NetWorthAssets {
  investmentAccounts: number;
  primaryResidence: number;
  otherAssets: number;
}

export interface NetWorthLiabilities {
  mortgage: number;
  otherDebt: number;
}

export interface NetWorth {
  assets: NetWorthAssets;
  liabilities: NetWorthLiabilities;
  trend: 'up' | 'down' | 'flat';
}

export interface CashFlowMonth {
  month: string;
  income: number;
  expenses: number;
  savings: number;
}

export interface CashFlow {
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlySavings: number;
  history: CashFlowMonth[];
}

export type InsuranceStatus = 'In Place' | 'Review Needed' | 'Not Covered';

export interface InsuranceCoverage {
  type: 'Life Insurance' | 'Disability Insurance' | 'Long-Term Care Insurance' | 'Umbrella Liability';
  status: InsuranceStatus;
  coverageAmount?: number;
  lastReviewDate?: string;
  notes?: string;
}

export type EstateDocStatus = 'In Place' | 'Needs Update' | 'Missing';

export interface EstateDocument {
  document: string;
  status: EstateDocStatus;
  lastReviewDate?: string;
  notes?: string;
}

export interface EstatePlan {
  documents: EstateDocument[];
}

export interface SavedScenario {
  id: string;
  name: string;
  retirementAge: number;
  monthlyContribution: number;
  expectedReturn: number;
  desiredMonthlyRetirementIncome: number;
  narrative?: string;
  createdAt: string;
}

export interface NewsItem {
  id: string;
  headline: string;
  source: string;
  date: string;
  summary: string;
  category: NewsCategory;
  affectedClientIds: string[];
  fullContent?: string;
}

export interface HealthScore {
  total: number;
  recency: number;
  portfolioHealth: number;
  goalProgress: number;
  actionItems: number;
  color: HealthColor;
}

export interface ExtractedMeetingData {
  summary: string[];
  actionItems: Array<{
    description: string;
    assignedTo: 'FA' | 'Client';
    suggestedDueDate: string;
  }>;
  clientSignals: string[];
  lifeEvents: string[];
  followUpEmail: string;
}
