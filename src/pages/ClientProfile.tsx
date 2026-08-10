import { useEffect, useRef, useState, useCallback, useMemo, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Copy, CheckCheck, RefreshCw, PlusCircle, Calendar,
  Users, Target, ClipboardList, Sparkles, AlertTriangle,
  TrendingUp, TrendingDown, Shield, FileText, DollarSign, Phone, ExternalLink,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, Tooltip as RechartsTooltip, Legend,
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  AreaChart, Area, BarChart, Bar, ReferenceLine,
} from 'recharts';
import {
  differenceInDays, differenceInMonths, parseISO, format,
  formatDistanceToNow, addDays,
} from 'date-fns';
import { useAppStore } from '@/store/appStore';
import { calculateHealthScore, formatAUM, formatDate } from '@/lib/healthScore';
import { generateBrief, generateSuggestions, extractMeetingNotes } from '@/lib/claudeClient';
import { AttritionRiskCard } from '@/components/client/AttritionRiskCard';
import { WalletCaptureCard } from '@/components/client/WalletCaptureCard';
import { CrossSellCard } from '@/components/client/CrossSellCard';
import { ReferralCard } from '@/components/client/ReferralCard';
import { CallNotesPanel } from '@/components/client/CallNotesPanel';
import { HealthBadge } from '@/components/ui/HealthBadge';
import { AiBadge } from '@/components/ui/AiBadge';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { toast } from '@/hooks/use-toast';
import { Slider } from '@/components/ui/slider';
import type { Client, GoalType, Goal, FamilyMember, AISuggestion, ExtractedMeetingData, Interaction, InteractionType, ActionItem, SavedScenario, UpcomingMeeting, CashFlow, CashFlowMonth, NetWorth } from '@/types';
import {
  calculateProjections, getRetirementTarget, fmtDollars,
  type ProjectionDataPoint,
} from '@/lib/projections';
import {
  calculateRebalancePlan, STRATEGY_LABELS, STRATEGY_DESCRIPTIONS,
  type RebalanceStrategy,
} from '@/lib/rebalancing';
import {
  calculateMarketImpact, SCENARIO_CONFIGS, fmtImpact,
  type MarketScenario,
} from '@/lib/marketImpact';
import { generateBrief as generateScenarioNarrative } from '@/lib/claudeClient';
import { cn } from '@/lib/utils';
import { calculateHouseholdIntelligence } from '@/lib/householdIntelligence';
import type { HouseholdAlert, MemberEngagementStatus, MemberEngagementStatusValue } from '@/lib/householdIntelligence';

// ─── Constants ────────────────────────────────────────────────────────────────

const ASSET_COLORS: Record<string, string> = {
  'US Equity': '#3b82f6',
  'International Equity': '#10b981',
  'Fixed Income': '#f59e0b',
  'Alternatives': '#8b5cf6',
  'Cash': '#6b7280',
  // Short-form keys produced by syntheticDataLoader buildAllocation()
  'Equity': '#3b82f6',
  'Bonds':  '#f59e0b',
};

const BRIEF_SECTIONS: Array<{ label: string; allCaps: string }> = [
  { label: 'Client Snapshot',         allCaps: 'CLIENT SNAPSHOT' },
  { label: 'Portfolio Status',        allCaps: 'PORTFOLIO STATUS' },
  { label: 'Goal Progress',           allCaps: 'GOAL PROGRESS' },
  { label: 'Relevant Market Context', allCaps: 'RELEVANT MARKET CONTEXT' },
  { label: 'Suggested Talking Points',allCaps: 'SUGGESTED TALKING POINTS' },
  { label: 'Outstanding Action Items',allCaps: 'OUTSTANDING ACTION ITEMS' },
  { label: 'Watch Out For',           allCaps: 'WATCH OUT FOR' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

function parseBriefSections(text: string): Array<{ title: string; content: string }> {
  const result: Array<{ title: string; content: string }> = [];
  for (let i = 0; i < BRIEF_SECTIONS.length; i++) {
    const { label, allCaps } = BRIEF_SECTIONS[i];
    const nextSection = BRIEF_SECTIONS[i + 1];
    // Accept ALL CAPS form, legacy markdown forms, and title case
    const variants = [
      `${allCaps}:`, allCaps,
      `**${label}:**`, `**${label}**`, `## ${label}`, `# ${label}`, `${label}:`, label,
    ];
    let headerIdx = -1;
    let headerEnd = -1;
    for (const v of variants) {
      const idx = text.indexOf(v);
      if (idx !== -1) { headerIdx = idx; headerEnd = idx + v.length; break; }
    }
    if (headerIdx === -1) continue;
    let contentEnd = text.length;
    if (nextSection) {
      const nextVariants = [
        `${nextSection.allCaps}:`, nextSection.allCaps,
        `**${nextSection.label}:**`, `**${nextSection.label}**`,
        `## ${nextSection.label}`, `# ${nextSection.label}`,
        `${nextSection.label}:`, nextSection.label,
      ];
      for (const v of nextVariants) {
        const idx = text.indexOf(v, headerEnd);
        if (idx !== -1 && idx < contentEnd) contentEnd = idx;
      }
    }
    const content = text.slice(headerEnd, contentEnd).replace(/^[\s:*\n]+/, '').trim();
    result.push({ title: label, content });
  }
  return result.length > 0 ? result : [{ title: 'Pre-Meeting Brief', content: text }];
}

function BriefContent({ text }: { text: string }) {
  // Parse the content into paragraphs and numbered list items
  const lines = text.split('\n');
  const elements: ReactNode[] = [];
  let listItems: string[] = [];
  let key = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ol key={key++} className="list-decimal list-inside space-y-1 text-sm text-gray-700 leading-relaxed">
          {listItems.map((item, idx) => <li key={idx}>{item}</li>)}
        </ol>
      );
      listItems = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { flushList(); continue; }
    const numberedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (numberedMatch) {
      listItems.push(numberedMatch[2]);
    } else {
      flushList();
      // Strip any residual markdown emphasis
      const clean = trimmed.replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1');
      elements.push(<p key={key++} className="text-sm text-gray-700 leading-relaxed">{clean}</p>);
    }
  }
  flushList();

  return <div className="space-y-1.5">{elements}</div>;
}

// ─── API-mode detail types (from GET /api/v1/clients/{id}/detail) ─────────────

interface ApiGoalOut {
  goal_id: string;
  goal_type: string | null;
  target_amount: number | null;
  current_progress_pct: number | null;
  target_date: string | null;
  on_track: boolean | null;
  priority_rank: number | null;
}

interface ApiInteractionOut {
  interaction_id: string;
  date: string | null;
  type: string | null;
  initiated_by: string | null;
  duration_minutes: number | null;
  outcome: string | null;
  sentiment: string | null;
  topics_discussed: string | null;
  commitment_made: boolean | null;
  follow_up_created: boolean | null;
  follow_up_due_date: string | null;
}

export interface ApiLifeEventOut {
  event_id: string;
  event_type: string | null;
  event_date: string | null;
  urgency_level: string | null;
  advisor_aware: boolean | null;
  action_taken: boolean | null;
  days_since_event: number | null;
}

export interface ApiProductHoldingOut {
  holding_id: string;
  product_type: string | null;
  held: boolean | null;
  start_date: string | null;
  review_due_date: string | null;
  flagged_as_gap: boolean | null;
}

interface ApiContactLogOut {
  total_interactions_18m: number | null;
  open_overdue_commitments: number | null;
  avg_sentiment_score: number | null;
}

interface ApiHouseholdOut {
  household_id: string;
  primary_client_id: string | null;
  member_ids: string | null;   // pipe-separated, e.g. "C0014|C0037|C0055"
  member_count: number | null;
  total_household_aum: number | null;
  engagement_score: number | null;
  wealth_transfer_flag: boolean | null;
  next_gen_engaged: boolean | null;
}

interface ApiDetailResponse {
  goals: ApiGoalOut[];
  interactions: ApiInteractionOut[];
  contact_log: ApiContactLogOut | null;
  product_holdings: ApiProductHoldingOut[];
  life_events: ApiLifeEventOut[];
  household: ApiHouseholdOut | null;
}

// ─── Mapping helpers (API → Client type) ─────────────────────────────────────

const _API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '');

/**
 * Derives a synthetic but realistic CashFlow from a client's AUM and
 * employment string. Used for API clients that have no income/expense data
 * in the database.
 *
 * Income is estimated by AUM tier (wealth proxy); savings rate adjusts for
 * life stage (retired clients draw down rather than accumulate).
 */
function _deriveCashFlow(aum: number, employment: string): CashFlow {
  const isRetired = employment.toLowerCase().includes('retired');

  const annualIncome =
    aum <   250_000 ?  80_000 :
    aum <   500_000 ? 120_000 :
    aum < 1_000_000 ? 160_000 :
    aum < 2_000_000 ? 220_000 :
    aum < 5_000_000 ? 360_000 : 480_000;

  const monthlyIncome   = Math.round(annualIncome / 12);
  const savingsRate     = isRetired ? 0.08 : 0.30;
  const monthlySavings  = Math.round(monthlyIncome * savingsRate);
  const monthlyExpenses = monthlyIncome - monthlySavings;

  // 6-month trailing history with small deterministic variance seeded by AUM
  const MONTHS = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'];
  const v = 0.04 + (aum % 3) * 0.01; // 4–6%, deterministic per client
  const history: CashFlowMonth[] = MONTHS.map((month, i) => {
    const inc = Math.round(monthlyIncome   * (1 + (i % 2 === 0 ?  v : -v * 0.5)));
    const exp = Math.round(monthlyExpenses * (1 + (i % 3 === 0 ?  v * 0.6 : -v * 0.3)));
    return { month, income: inc, expenses: exp, savings: inc - exp };
  });

  return { monthlyIncome, monthlyExpenses, monthlySavings, history };
}

function _mapGoalType(raw: string | null | undefined): GoalType {
  const r = raw?.toLowerCase() ?? '';
  if (r.includes('retirement income')) return 'Retirement Income';
  if (r.includes('business exit'))     return 'Business Exit';
  if (r.includes('education'))         return 'Education';
  if (r.includes('estate') || r.includes('legacy')) return 'Estate';
  if (r.includes('charitable'))        return 'Charitable Giving';
  if (r.includes('property') || r.includes('purchase')) return 'Property Purchase';
  if (r.includes('emergency'))         return 'Emergency Fund';
  if (r.includes('income protection')) return 'Income Protection';
  if (r.includes('college'))           return 'College Fund';
  return 'Retirement';
}

function _mapApiGoals(apiGoals: ApiGoalOut[]): Goal[] {
  return apiGoals.map((g) => ({
    id: g.goal_id,
    type: _mapGoalType(g.goal_type),
    name: g.goal_type ?? 'Goal',
    targetAmount:        Number(g.target_amount ?? 0),
    targetDate:          g.target_date ?? '2050-01-01',
    currentAmount:       Math.round(Number(g.target_amount ?? 0) * (Number(g.current_progress_pct ?? 0) / 100)),
    monthlyContribution: 0,
    onTrack:             g.on_track ?? false,
  }));
}

function _mapApiInteractions(apiInter: ApiInteractionOut[]): Interaction[] {
  return apiInter.map((i) => {
    const rawType = i.type?.toLowerCase() ?? '';
    const type: InteractionType =
      rawType === 'call'  ? 'call'    :
      rawType === 'email' ? 'email'   : 'meeting';

    const summary = [i.topics_discussed, i.outcome].filter(Boolean).join(' · ')
      || (i.initiated_by ? `${i.initiated_by}-initiated interaction` : 'Interaction recorded');

    const actionItems: ActionItem[] =
      i.commitment_made && i.follow_up_due_date
        ? [{ id: `ai-${i.interaction_id}`, description: 'Follow-up commitment', assignedTo: 'FA', dueDate: i.follow_up_due_date, completed: false }]
        : [];

    return { id: i.interaction_id, date: i.date ?? '', type, summary, actionItems };
  });
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ClientProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const clients = useAppStore((s) => s.clients);
  const updateClientSavedScenarios = useAppStore((s) => s.updateClientSavedScenarios);
  const client = clients.find((c) => c.id === id);

  // ── Detail data from /api/v1/clients/{id}/detail ──
  const [detailData, setDetailData] = useState<ApiDetailResponse | null>(null);

  useEffect(() => {
    if (!_API_URL || !id) return;
    fetch(`${_API_URL}/api/v1/clients/${id}/detail`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: ApiDetailResponse) => setDetailData(data))
      .catch((err) => console.warn('[AdvisorIQ] detail fetch failed:', err));
  }, [id]);

  // Enriched client: merge store data with full detail from API
  const enrichedClient = useMemo<Client | undefined>(() => {
    if (!client) return undefined;

    const aum = Number(client.aum);

    // Derive cashFlow + netWorth for API clients that have no income/estate data
    // in the database. Falls back to stored values if the client was loaded from
    // the old hardcoded JSON dataset (which did have these fields).
    const cashFlow: CashFlow =
      client.cashFlow ?? _deriveCashFlow(aum, client.employment);
    const netWorth: NetWorth = client.netWorth ?? {
      assets: { investmentAccounts: aum, primaryResidence: 0, otherAssets: 0 },
      liabilities: { mortgage: 0, otherDebt: 0 },
      trend: (client.oneYearReturn ?? 0) >= 0 ? 'up' : 'down',
    };

    if (!detailData) return { ...client, cashFlow, netWorth };

    // Resolve household members from pipe-separated member_ids into FamilyMember[]
    const familyMembers: FamilyMember[] = [];
    if (detailData.household?.member_ids) {
      const otherIds = detailData.household.member_ids
        .split('|')
        .map((s) => s.trim())
        .filter((mid) => mid && mid !== client.id);
      for (const mid of otherIds) {
        const member = clients.find((c) => c.id === mid);
        if (member) {
          familyMembers.push({
            relationship: 'Household Member',
            name:         member.name,
            age:          member.age || undefined,
          });
        }
      }
    }

    return {
      ...client,
      goals:         _mapApiGoals(detailData.goals),
      history:       _mapApiInteractions(detailData.interactions),
      familyMembers,
      lifeEvents: detailData.life_events.map((e) => ({
        date:        e.event_date ?? '',
        description: e.event_type ?? 'Life event',
      })),
      contactStats: detailData.contact_log ? {
        totalInteractions18m:   detailData.contact_log.total_interactions_18m   ?? 0,
        openOverdueCommitments: detailData.contact_log.open_overdue_commitments ?? 0,
        avgSentimentScore:      Number(detailData.contact_log.avg_sentiment_score ?? 0),
      } : client.contactStats,
      cashFlow,
      netWorth,
    };
  }, [client, detailData, clients]);

  useEffect(() => {
    document.title = client ? `AdvisorIQ — ${client.name}` : 'AdvisorIQ — Client Profile';
  }, [client]);

  const tabParam = searchParams.get('tab');
  const isBriefRoute = tabParam === 'brief';
  const initialTab = isBriefRoute ? 'ai-insights' : (tabParam ?? 'overview');
  const [activeTab, setActiveTab] = useState(initialTab);

  // Signals the AI Insights tab to generate a brief — incremented each time "Generate Brief" is clicked
  const [briefTriggerCount, setBriefTriggerCount] = useState(isBriefRoute ? 1 : 0);

  function handleGenerateBrief() {
    setActiveTab('ai-insights');
    setBriefTriggerCount((n) => n + 1);
  }

  if (!enrichedClient) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-4 py-24">
        <AlertTriangle size={32} className="text-gray-300" />
        <p className="text-gray-500 font-medium">Client not found</p>
        <Button variant="outline" onClick={() => navigate('/clients')}>
          <ArrowLeft size={14} className="mr-1.5" /> All Clients
        </Button>
      </div>
    );
  }

  const healthScore = calculateHealthScore(enrichedClient);

  return (
    <div className="p-6 space-y-5">
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <button
            onClick={() => navigate('/clients')}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 mt-1 transition-colors"
          >
            <ArrowLeft size={14} /> All Clients
          </button>
          <div className="h-11 w-11 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
            {getInitials(enrichedClient.name)}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900 leading-tight">{enrichedClient.name}</h1>
            <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
              <span className="text-sm font-medium text-gray-700 tabular-nums">{formatAUM(enrichedClient.aum)}</span>
              <span className="text-gray-300">·</span>
              <Badge variant="outline" className="text-xs">{enrichedClient.riskProfile}</Badge>
              <span className="text-gray-300">·</span>
              <HealthBadge score={healthScore.total} color={healthScore.color} size="sm" />
              <span className="text-gray-300">·</span>
              <span className="text-xs text-gray-500">
                Last contact {formatDistanceToNow(parseISO(enrichedClient.lastContact), { addSuffix: true })}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="outline" onClick={() => navigate(`/clients/${enrichedClient.id}/summary`)}>
            <ExternalLink size={14} className="mr-1.5" /> Client View
          </Button>
          <Button variant="outline" onClick={() => navigate(`/clients/${enrichedClient.id}/call`)}>
            <Phone size={14} className="mr-1.5" /> Start Call
          </Button>
          <Button onClick={handleGenerateBrief}>
            <Sparkles size={14} className="mr-1.5" /> Generate Brief
          </Button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="w-full justify-start h-auto p-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
          <TabsTrigger value="goals">Goals</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="ai-insights">AI Insights</TabsTrigger>
          <TabsTrigger value="financial-plan">Financial Plan</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab client={enrichedClient} lifeEvents={detailData?.life_events ?? []} />
        </TabsContent>

        <TabsContent value="portfolio" className="mt-4">
          <PortfolioTab client={enrichedClient} productHoldings={detailData?.product_holdings ?? []} />
        </TabsContent>

        <TabsContent value="goals" className="mt-4">
          <GoalsTab client={enrichedClient} />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <HistoryTab client={enrichedClient} />
        </TabsContent>

        <TabsContent value="ai-insights" className="mt-4">
          <AIInsightsTab client={enrichedClient} briefTriggerCount={briefTriggerCount} />
        </TabsContent>

        <TabsContent value="financial-plan" className="mt-4">
          <FinancialPlanTab client={enrichedClient} updateSavedScenarios={updateClientSavedScenarios} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Tab 1: Overview ──────────────────────────────────────────────────────────

function OverviewTab({ client, lifeEvents }: { client: Client; lifeEvents: ApiLifeEventOut[] }) {
  return (
    <div className="space-y-5">
      {/* Know Your Client */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-gray-900">Know Your Client</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
          <KycRow label="Age" value={`${client.age} years old`} />
          <KycRow label="Employment" value={client.employment} />
          <KycRow label="Client Since" value={formatDate(client.clientSince)} />
          <KycRow label="Risk Profile" value={client.riskProfile} />
          <KycRow label="Communication" value={client.communicationPreferences} full />
          <KycRow label="Key Concerns" value={client.keyConcerns} full />
          <KycRow label="Personality" value={client.personalitySummary} full />
        </CardContent>
      </Card>

      {/* Life Events */}
      <LifeEventsSection lifeEvents={lifeEvents} />

      {/* Family Map */}
      <div>
        <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Users size={14} className="text-gray-400" /> Household & Relationships
        </h2>
        {client.familyMembers.length === 0 ? (
          <p className="text-sm text-gray-400 py-3">No family information recorded</p>
        ) : (
          <div className="flex gap-3 flex-wrap">
            {client.familyMembers.map((m, i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-3 bg-white min-w-[140px]">
                <div className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">{m.relationship}</div>
                <div className="text-sm font-medium text-gray-900">{m.name}</div>
                {m.age && <div className="text-xs text-gray-500">Age {m.age}</div>}
                {m.note && <div className="text-xs text-gray-500 mt-1 leading-relaxed">{m.note}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Household Intelligence Panel */}
      <HouseholdIntelligencePanel client={client} />

      {/* Upcoming Interactions */}
      <div>
        <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <Calendar size={14} className="text-gray-400" /> Upcoming Meetings
        </h2>
        {client.upcomingMeetings.length === 0 ? (
          <div className="border border-dashed border-gray-200 rounded-lg py-8 text-center">
            <Calendar size={20} className="text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No upcoming meetings scheduled</p>
          </div>
        ) : (
          <div className="space-y-2">
            {client.upcomingMeetings.map((m) => (
              <div key={m.id} className="border border-gray-200 rounded-lg p-3 flex items-start justify-between bg-white">
                <div>
                  <div className="text-sm font-medium text-gray-900">{m.purpose}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {format(parseISO(m.date), 'EEEE, MMMM d, yyyy')} · {m.time}
                  </div>
                </div>
                <span className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-2 py-0.5 flex-shrink-0">
                  {differenceInDays(parseISO(m.date), new Date()) === 0 ? 'Today' : `In ${differenceInDays(parseISO(m.date), new Date())} days`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Life Events Section ──────────────────────────────────────────────────────

const _URGENCY_LIFE_EVENT: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  high:     'bg-orange-50 text-orange-700 border-orange-200',
  medium:   'bg-amber-50 text-amber-700 border-amber-200',
  low:      'bg-blue-50 text-blue-700 border-blue-200',
};

function LifeEventsSection({ lifeEvents }: { lifeEvents: ApiLifeEventOut[] }) {
  if (lifeEvents.length === 0) return null;

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <AlertTriangle size={14} className="text-gray-400" /> Life Events
      </h2>
      <div className="space-y-2">
        {lifeEvents.map((e) => (
          <div key={e.event_id} className="border border-gray-200 rounded-lg p-3 bg-white flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-800">{e.event_type}</span>
                {e.urgency_level && (
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${_URGENCY_LIFE_EVENT[e.urgency_level.toLowerCase()] ?? 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                    {e.urgency_level}
                  </span>
                )}
                {e.action_taken && (
                  <span className="text-xs font-medium px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                    Action Taken
                  </span>
                )}
              </div>
              {e.event_date && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {format(parseISO(e.event_date), 'MMMM d, yyyy')}
                  {e.days_since_event != null && ` · ${e.days_since_event} days ago`}
                </p>
              )}
            </div>
            {e.advisor_aware === false && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded border bg-yellow-50 text-yellow-700 border-yellow-200 flex-shrink-0">
                Not Aware
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Product Holdings Section ─────────────────────────────────────────────────

function ProductHoldingsSection({ productHoldings }: { productHoldings: ApiProductHoldingOut[] }) {
  if (productHoldings.length === 0) return null;

  const held = productHoldings.filter((h) => h.held);
  const gaps = productHoldings.filter((h) => !h.held && h.flagged_as_gap);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Shield size={14} className="text-gray-400" /> Products & Coverage
          </CardTitle>
          {gaps.length > 0 && (
            <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
              {gaps.length} gap{gaps.length > 1 ? 's' : ''} identified
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Product</th>
              <th className="text-center px-4 py-2.5 text-xs text-gray-500 font-medium">Status</th>
              <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium">Review Due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {productHoldings.map((h) => (
              <tr key={h.holding_id}>
                <td className="px-4 py-2.5 font-medium text-gray-800">{h.product_type ?? '—'}</td>
                <td className="px-4 py-2.5 text-center">
                  {h.held ? (
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded border bg-emerald-50 text-emerald-700 border-emerald-200">
                      Held
                    </span>
                  ) : h.flagged_as_gap ? (
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                      Gap
                    </span>
                  ) : (
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded border bg-gray-100 text-gray-500 border-gray-200">
                      Not Held
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right text-xs text-gray-500 tabular-nums">
                  {h.review_due_date ? format(parseISO(h.review_due_date), 'MMM d, yyyy') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {held.length > 0 && (
          <p className="text-xs text-gray-400 px-4 py-2 border-t border-gray-50">
            {held.length} product{held.length > 1 ? 's' : ''} held
            {gaps.length > 0 ? ` · ${gaps.length} gap${gaps.length > 1 ? 's' : ''} flagged` : ''}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function KycRow({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <div className="text-xs text-gray-400 font-medium mb-0.5">{label}</div>
      <div className="text-sm text-gray-700 leading-relaxed">{value}</div>
    </div>
  );
}

// ─── Household Intelligence Panel ─────────────────────────────────────────────

function statusDot(status: MemberEngagementStatusValue) {
  if (status === 'Engaged') return 'bg-emerald-500';
  if (status === 'Not Recently Engaged') return 'bg-amber-400';
  return 'bg-red-500';
}

function statusLabel(status: MemberEngagementStatusValue) {
  if (status === 'Engaged') return 'text-emerald-700';
  if (status === 'Not Recently Engaged') return 'text-amber-600';
  return 'text-red-600';
}

function scoreStyle(score: number) {
  if (score >= 75) return 'text-emerald-700 bg-emerald-50 border-emerald-300';
  if (score >= 50) return 'text-amber-700 bg-amber-50 border-amber-300';
  return 'text-red-700 bg-red-50 border-red-300';
}

function alertStyle(severity: HouseholdAlert['severity']) {
  if (severity === 'high') return 'bg-red-50 border-red-200';
  return 'bg-amber-50 border-amber-200';
}

function alertBadgeStyle(severity: HouseholdAlert['severity']) {
  if (severity === 'high') return 'bg-red-100 text-red-700 border border-red-200';
  return 'bg-amber-100 text-amber-700 border border-amber-200';
}

function alertTitleStyle(severity: HouseholdAlert['severity']) {
  if (severity === 'high') return 'text-red-800';
  return 'text-amber-800';
}

function HouseholdIntelligencePanel({ client }: { client: Client }) {
  const intel = useMemo(
    () => calculateHouseholdIntelligence(client),
    [client]
  );

  // Don't render if the client has no family data at all
  if (client.familyMembers.length === 0) return null;

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <Shield size={14} className="text-gray-400" /> Household Intelligence
      </h2>

      <Card>
        <CardContent className="pt-5 space-y-5">

          {/* ── Row 1: Score + Member Engagement ── */}
          <div className="flex items-start gap-6">

            {/* Score badge */}
            <div className="flex-shrink-0 text-center">
              <div className="text-xs text-gray-400 font-medium mb-2">Household Engagement Score</div>
              <div
                className={cn(
                  'w-16 h-16 rounded-xl border-2 flex items-center justify-center font-bold text-2xl mx-auto',
                  scoreStyle(intel.engagementScore)
                )}
              >
                {intel.engagementScore}
              </div>
              <div className="text-xs text-gray-400 mt-1.5">out of 100</div>
            </div>

            {/* Vertical divider */}
            <div className="w-px bg-gray-100 self-stretch flex-shrink-0" />

            {/* Per-member engagement rows */}
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-400 font-medium mb-2">Family Member Engagement</div>
              <div className="space-y-2">
                {intel.memberStatuses.map((ms: MemberEngagementStatus, i: number) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        'w-2 h-2 rounded-full flex-shrink-0',
                        statusDot(ms.status)
                      )}
                    />
                    <span className="text-sm font-medium text-gray-800 truncate">
                      {ms.member.name}
                    </span>
                    <span className="text-xs text-gray-400 flex-shrink-0">
                      {ms.member.relationship}
                      {typeof ms.member.age === 'number' ? `, age ${ms.member.age}` : ''}
                    </span>
                    <span
                      className={cn(
                        'text-xs font-medium ml-auto flex-shrink-0',
                        statusLabel(ms.status)
                      )}
                    >
                      {ms.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Row 2: Household Risk Alerts ── */}
          {intel.alerts.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-gray-400 font-medium">Household Risk Alerts</div>
              {intel.alerts.map((alert: HouseholdAlert, i: number) => (
                <div
                  key={i}
                  className={cn(
                    'rounded-lg border px-3.5 py-3 flex items-start gap-2.5',
                    alertStyle(alert.severity)
                  )}
                >
                  <AlertTriangle
                    size={13}
                    className={cn(
                      'flex-shrink-0 mt-0.5',
                      alert.severity === 'high' ? 'text-red-500' : 'text-amber-500'
                    )}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span
                        className={cn(
                          'text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded',
                          alertBadgeStyle(alert.severity)
                        )}
                      >
                        {alert.severity}
                      </span>
                      <span
                        className={cn(
                          'text-xs font-semibold',
                          alertTitleStyle(alert.severity)
                        )}
                      >
                        {alert.title}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 leading-relaxed">
                      {alert.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Row 3: Suggested Action ── */}
          {intel.suggestedAction && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3.5 py-3 flex items-start gap-2.5">
              <Sparkles size={13} className="text-blue-500 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-semibold text-blue-700 mb-1">
                  Suggested Advisor Action
                </div>
                <p className="text-xs text-gray-700 leading-relaxed">
                  {intel.suggestedAction}
                </p>
              </div>
            </div>
          )}

        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tab 2: Portfolio ─────────────────────────────────────────────────────────

function PortfolioTab({ client, productHoldings }: { client: Client; productHoldings: ApiProductHoldingOut[] }) {
  const targetData = client.allocation.map((a) => ({ name: a.assetClass, value: a.target }));
  const currentData = client.allocation.map((a) => ({ name: a.assetClass, value: a.current }));

  const perfData = client.performanceData.map((d) => ({
    month: d.month.slice(0, 3) + ' ' + d.month.slice(-4),
    Portfolio: parseFloat((d.portfolio - 100).toFixed(2)),
    Benchmark: parseFloat((d.benchmark - 100).toFixed(2)),
  }));

  const benchmarkDelta = client.oneYearReturn - client.benchmarkReturn;

  return (
    <div className="space-y-6">
      {/* Allocation Pies */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Asset Allocation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-6">
            <AllocationPie title="Target Allocation" data={targetData} />
            <AllocationPie title="Current Allocation" data={currentData} />
          </div>
        </CardContent>
      </Card>

      {/* Drift Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Allocation Drift Analysis</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">Asset Class</th>
                <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium">Target %</th>
                <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium">Current %</th>
                <th className="text-right px-4 py-2.5 text-xs text-gray-500 font-medium">Drift</th>
                <th className="text-center px-4 py-2.5 text-xs text-gray-500 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {client.allocation.map((a) => {
                const drift = a.current - a.target;
                const absDrift = Math.abs(drift);
                const status = absDrift <= 3 ? 'On Track' : absDrift <= 7 ? 'Review' : 'Action Needed';
                const statusCls =
                  status === 'On Track'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : status === 'Review'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : 'bg-red-50 text-red-700 border-red-200';
                return (
                  <tr key={a.assetClass}>
                    <td className="px-4 py-2.5 font-medium text-gray-800">
                      <span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ background: ASSET_COLORS[a.assetClass] ?? '#ccc' }} />
                      {a.assetClass}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">{a.target}%</td>
                    <td className="px-4 py-2.5 text-right text-gray-800 tabular-nums font-medium">{a.current}%</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${drift > 0 ? 'text-orange-600' : drift < 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                      {drift > 0 ? '+' : ''}{drift.toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded border ${statusCls}`}>{status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Performance Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">12-Month Performance</CardTitle>
        </CardHeader>
        <CardContent>
          {perfData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={perfData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v > 0 ? '+' : ''}${v}%`} />
                <RechartsTooltip
                  formatter={(value: number, name: string) => [`${value > 0 ? '+' : ''}${value}%`, name]}
                  contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb' }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="Portfolio" stroke="#3b82f6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Benchmark" stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[220px] rounded-lg bg-gray-50 border border-dashed border-gray-200">
              <p className="text-sm text-gray-400">Performance trend data not available</p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100">
            <StatBlock label="1-Year Return" value={`${client.oneYearReturn > 0 ? '+' : ''}${client.oneYearReturn}%`} positive={client.oneYearReturn >= 0} />
            <StatBlock
              label="vs Benchmark"
              value={`${benchmarkDelta > 0 ? '+' : ''}${benchmarkDelta.toFixed(1)}%`}
              positive={benchmarkDelta >= 0}
            />
            <StatBlock label="Last Rebalanced" value={formatDate(client.lastRebalanced)} />
          </div>
        </CardContent>
      </Card>

      {/* Rebalancing Panel */}
      <RebalancingPanel client={client} />

      {/* Product Holdings */}
      <ProductHoldingsSection productHoldings={productHoldings} />
    </div>
  );
}

// ─── Rebalancing Panel ────────────────────────────────────────────────────────

function RebalancingPanel({ client }: { client: Client }) {
  const apiKey = useAppStore((s) => s.claudeApiKey);
  const navigate = useNavigate();

  const [strategy, setStrategy] = useState<RebalanceStrategy>('threshold');
  const [proposalLoading, setProposalLoading] = useState(false);
  const [proposal, setProposal] = useState('');
  const [proposalError, setProposalError] = useState('');
  const [proposalCopied, setProposalCopied] = useState(false);

  const plan = calculateRebalancePlan(client.allocation, client.aum, strategy);

  const ACTION_STYLES = {
    Buy:  'bg-emerald-50 text-emerald-700 border-emerald-200',
    Sell: 'bg-red-50 text-red-700 border-red-200',
    Hold: 'bg-gray-100 text-gray-500 border-gray-200',
  };

  async function handleGenerateProposal() {
    setProposalLoading(true);
    setProposalError('');
    setProposal('');
    try {
      const tradeLines = plan.trades
        .filter((t) => t.action !== 'Hold')
        .map((t) => `  ${t.action} ${t.assetClass}: ${t.drift > 0 ? '' : '+'}${(-t.drift).toFixed(1)}% drift → $${Math.abs(t.dollarAmount).toLocaleString()} ${t.action === 'Buy' ? 'purchase' : 'sale'}`)
        .join('\n');

      const prompt = `You are a financial advisor assistant. Draft a concise rebalancing proposal memo for ${client.name} (${client.riskProfile} risk, AUM $${client.aum.toLocaleString()}).

Strategy selected: ${STRATEGY_LABELS[strategy]}
Proposed trades:
${tradeLines}
Total buys: $${plan.totalBuys.toLocaleString()}
Total sells: $${plan.totalSells.toLocaleString()}
Estimated transaction cost: ~$${plan.estimatedCost.toLocaleString()}

Write a 2-3 paragraph advisor memo explaining the rationale for this rebalance, the specific trades, and any risks to consider. Keep it professional and client-friendly.`;

      const result = await generateScenarioNarrative(prompt);
      setProposal(result);
    } catch {
      setProposalError('Unable to generate proposal. Check your API key in Settings.');
    } finally {
      setProposalLoading(false);
    }
  }

  async function handleCopyProposal() {
    try {
      await navigator.clipboard.writeText(proposal);
      setProposalCopied(true);
      toast({ title: 'Proposal copied to clipboard' });
      setTimeout(() => setProposalCopied(false), 2000);
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' });
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <RefreshCw size={14} className="text-gray-400" /> Rebalancing Options
          </CardTitle>
          {/* Strategy selector */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            {(Object.keys(STRATEGY_LABELS) as RebalanceStrategy[]).map((s) => (
              <button
                key={s}
                onClick={() => { setStrategy(s); setProposal(''); setProposalError(''); }}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  strategy === s
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {STRATEGY_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-1">{STRATEGY_DESCRIPTIONS[strategy]}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Trade table */}
        {!plan.hasChanges ? (
          <div className="flex flex-col items-center py-8 text-center gap-2">
            <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCheck size={16} className="text-emerald-600" />
            </div>
            <p className="text-sm font-medium text-emerald-700">Portfolio is within tolerance</p>
            <p className="text-xs text-gray-400">No trades required under the {STRATEGY_LABELS[strategy]} strategy.</p>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-3 py-2.5 text-xs text-gray-500 font-medium">Asset Class</th>
                  <th className="text-right px-3 py-2.5 text-xs text-gray-500 font-medium">Current</th>
                  <th className="text-right px-3 py-2.5 text-xs text-gray-500 font-medium">Target</th>
                  <th className="text-right px-3 py-2.5 text-xs text-gray-500 font-medium">Drift</th>
                  <th className="text-right px-3 py-2.5 text-xs text-gray-500 font-medium">Trade ($)</th>
                  <th className="text-center px-3 py-2.5 text-xs text-gray-500 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {plan.trades.map((t) => (
                  <tr key={t.assetClass} className={t.action === 'Hold' ? 'opacity-40' : ''}>
                    <td className="px-3 py-2.5 font-medium text-gray-800">
                      <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 flex-shrink-0" style={{ background: ASSET_COLORS[t.assetClass] ?? '#ccc' }} />
                      {t.assetClass}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{t.currentPct}%</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{t.targetPct}%</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${t.drift > 0 ? 'text-orange-600' : t.drift < 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                      {t.drift > 0 ? '+' : ''}{t.drift.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-gray-800 font-medium">
                      {t.action === 'Hold' ? '—' : `${t.dollarAmount < 0 ? '-' : '+'}$${Math.abs(t.dollarAmount).toLocaleString()}`}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded border ${ACTION_STYLES[t.action]}`}>{t.action}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Summary row */}
            <div className="flex items-center gap-6 px-3 pt-2 border-t border-gray-100 text-xs">
              {plan.totalBuys > 0 && (
                <span className="text-emerald-700 font-medium">
                  Total Buys: +${plan.totalBuys.toLocaleString()}
                </span>
              )}
              {plan.totalSells > 0 && (
                <span className="text-red-600 font-medium">
                  Total Sells: −${plan.totalSells.toLocaleString()}
                </span>
              )}
              <span className="text-gray-400 ml-auto">
                Est. cost: ~${plan.estimatedCost.toLocaleString()}
              </span>
            </div>
          </>
        )}

        {/* Proposal draft */}
        <div className="pt-2 border-t border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Rebalancing Proposal</span>
            <div className="flex items-center gap-2">
              {proposal && (
                <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={handleCopyProposal}>
                  {proposalCopied ? <><CheckCheck size={11} className="mr-1" />Copied</> : <><Copy size={11} className="mr-1" />Copy</>}
                </Button>
              )}
              {!apiKey ? (
                <button onClick={() => navigate('/settings')} className="text-xs text-blue-600 underline">Add API key</button>
              ) : (
                <Button
                  size="sm" variant="outline" className="h-6 text-xs"
                  onClick={handleGenerateProposal}
                  disabled={proposalLoading || !plan.hasChanges}
                >
                  <Sparkles size={11} className="mr-1" />
                  {proposal ? 'Regenerate' : 'Draft Proposal'}
                </Button>
              )}
            </div>
          </div>

          {proposalLoading && (
            <div className="space-y-2">
              <Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-3/4" />
            </div>
          )}
          {proposalError && (
            <Alert variant="destructive"><AlertDescription>{proposalError}</AlertDescription></Alert>
          )}
          {proposal && !proposalLoading && (
            <div className="p-3.5 bg-gray-50 rounded-lg border border-gray-100 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
              {proposal}
              <AiBadge />
            </div>
          )}
          {!proposal && !proposalLoading && !proposalError && plan.hasChanges && apiKey && (
            <p className="text-xs text-gray-400 italic">Draft a professional rebalancing proposal memo for this client.</p>
          )}
          {!plan.hasChanges && (
            <p className="text-xs text-gray-400 italic">No trades required — no proposal to draft.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AllocationPie({ title, data }: { title: string; data: Array<{ name: string; value: number }> }) {
  return (
    <div>
      <p className="text-xs text-gray-500 font-medium text-center mb-2">{title}</p>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" outerRadius={75} dataKey="value" label={({ name, value }) => `${name} ${value}%`} labelLine={false} fontSize={10}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={ASSET_COLORS[entry.name] ?? '#ccc'} />
            ))}
          </Pie>
          <RechartsTooltip formatter={(v: number) => [`${v}%`]} contentStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-1">
        {data.map((d) => (
          <span key={d.name} className="flex items-center gap-1 text-xs text-gray-500">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: ASSET_COLORS[d.name] ?? '#ccc' }} />
            {d.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function StatBlock({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  const textColor = positive === undefined ? 'text-gray-900' : positive ? 'text-emerald-700' : 'text-red-600';
  return (
    <div className="text-center">
      <div className={`text-base font-bold tabular-nums ${textColor}`}>{value}</div>
      <div className="text-xs text-gray-400 mt-0.5">{label}</div>
    </div>
  );
}

// ─── Tab 3: Goals ─────────────────────────────────────────────────────────────

function GoalsTab({ client }: { client: Client }) {
  if (client.goals.length === 0) {
    return (
      <div className="flex flex-col items-center py-16 text-center">
        <Target size={32} className="text-gray-200 mb-3" />
        <p className="text-sm text-gray-400">No goals recorded for this client</p>
      </div>
    );
  }

  const today = new Date();
  // Assumed annual return for projection (7% blended)
  const ANNUAL_RETURN = 0.07;
  const MONTHLY_RATE = ANNUAL_RETURN / 12;

  return (
    <div className="space-y-5">
      <MarketImpactPanel client={client} />
      <div className="grid grid-cols-2 gap-4">
      {client.goals.map((goal) => {
        const monthsRemaining = Math.max(0, differenceInMonths(parseISO(goal.targetDate), today));
        // Compound growth projection: FV of lump sum + FV of monthly contributions
        const fvPV = goal.currentAmount * Math.pow(1 + MONTHLY_RATE, monthsRemaining);
        const fvPMT = monthsRemaining > 0
          ? goal.monthlyContribution * (Math.pow(1 + MONTHLY_RATE, monthsRemaining) - 1) / MONTHLY_RATE
          : 0;
        const projectedValue = Math.round(fvPV + fvPMT);
        const isOnTrack = projectedValue >= goal.targetAmount;
        const progressPct = Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100));
        const gap = projectedValue - goal.targetAmount;

        const fmtGoalAmount = (v: number) => {
          if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
          if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
          return `$${v.toLocaleString()}`;
        };

        return (
          <Card key={goal.id}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-sm font-semibold text-gray-900 leading-tight">{goal.name}</CardTitle>
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded border flex-shrink-0 ${isOnTrack ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                  {isOnTrack ? 'On Track' : 'Off Track'}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Current saved</span>
                  <span className="font-medium text-gray-700">{progressPct}% of target</span>
                </div>
                <Progress value={progressPct} className="h-1.5" />
              </div>

              {/* Three key numbers */}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-gray-50 rounded p-2 text-center">
                  <div className="text-gray-400 mb-0.5">Current Saved</div>
                  <div className="font-semibold text-gray-800">{fmtGoalAmount(goal.currentAmount)}</div>
                </div>
                <div className={`rounded p-2 text-center ${isOnTrack ? 'bg-emerald-50' : 'bg-red-50'}`}>
                  <div className="text-gray-400 mb-0.5">Projected</div>
                  <div className={`font-semibold ${isOnTrack ? 'text-emerald-700' : 'text-red-600'}`}>{fmtGoalAmount(projectedValue)}</div>
                </div>
                <div className="bg-gray-50 rounded p-2 text-center">
                  <div className="text-gray-400 mb-0.5">Target</div>
                  <div className="font-semibold text-gray-800">{fmtGoalAmount(goal.targetAmount)}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <GoalStat label="Monthly" value={goal.monthlyContribution >= 0 ? `$${goal.monthlyContribution.toLocaleString()}` : `–$${Math.abs(goal.monthlyContribution).toLocaleString()}`} />
                <GoalStat label="Target Date" value={format(parseISO(goal.targetDate), 'MMM yyyy')} />
              </div>

              <div className="pt-2 border-t border-gray-100">
                {isOnTrack ? (
                  <div className="text-xs text-emerald-600 text-right font-medium">
                    Projected surplus at target date: {fmtGoalAmount(gap)}
                  </div>
                ) : (
                  <div className="text-xs text-red-500 text-right font-medium">
                    Projected shortfall at target date: {fmtGoalAmount(Math.abs(gap))}
                  </div>
                )}
                <div className="text-xs text-gray-400 text-right mt-0.5">{monthsRemaining} months · 7% assumed return</div>
              </div>
            </CardContent>
          </Card>
        );
      })}
      </div>
    </div>
  );
}

// ─── Market Impact Panel ──────────────────────────────────────────────────────

function MarketImpactPanel({ client }: { client: Client }) {
  const apiKey = useAppStore((s) => s.claudeApiKey);
  const navigate = useNavigate();

  const [scenario, setScenario] = useState<MarketScenario>('base');
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [narrative, setNarrative] = useState('');
  const [narrativeError, setNarrativeError] = useState('');

  const impacts = calculateMarketImpact(client.goals, scenario);
  const cfg = SCENARIO_CONFIGS[scenario];

  const flippedOffTrack = impacts.filter((i) => i.statusChanged && !i.isOnTrack).length;
  const flippedOnTrack  = impacts.filter((i) => i.statusChanged && i.isOnTrack).length;

  async function handleGenerateNarrative() {
    setNarrativeLoading(true);
    setNarrativeError('');
    setNarrative('');
    try {
      const lines = impacts.map((imp) =>
        `  • ${imp.goalName}: base ${imp.baseProjected >= imp.targetAmount ? 'on track' : 'off track'} → ${imp.isOnTrack ? 'on track' : 'OFF TRACK'} (${fmtImpact(imp.delta)})`
      ).join('\n');

      const prompt = `You are a financial advisor assistant. A client's goals are being stress-tested under a "${cfg.label}" scenario (${cfg.description}).

Client: ${client.name}, Risk Profile: ${client.riskProfile}

Goal impact summary:
${lines}

Write a concise 2-3 paragraph advisor note explaining: (1) what this scenario means for the client's goals, (2) which goals are most at risk and why, (3) two specific action steps the advisor should discuss with the client. Keep it professional and actionable.`;

      const result = await generateScenarioNarrative(prompt);
      setNarrative(result);
    } catch {
      setNarrativeError('Unable to generate narrative. Check your API key in Settings.');
    } finally {
      setNarrativeLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <TrendingUp size={14} className="text-gray-400" /> Market Impact on Goals
          </CardTitle>
          {/* Scenario toggle */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
            {(Object.keys(SCENARIO_CONFIGS) as MarketScenario[]).map((s) => (
              <button
                key={s}
                onClick={() => { setScenario(s); setNarrative(''); setNarrativeError(''); }}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  scenario === s
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {SCENARIO_CONFIGS[s].label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-1">{cfg.description}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status change banner */}
        {scenario !== 'base' && (flippedOffTrack > 0 || flippedOnTrack > 0) && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${
            flippedOffTrack > 0 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
          }`}>
            {flippedOffTrack > 0
              ? `⚠ ${flippedOffTrack} goal${flippedOffTrack > 1 ? 's' : ''} fall${flippedOffTrack === 1 ? 's' : ''} off-track in this scenario`
              : `✓ ${flippedOnTrack} additional goal${flippedOnTrack > 1 ? 's' : ''} come${flippedOnTrack === 1 ? 's' : ''} on-track in this scenario`}
          </div>
        )}
        {scenario === 'base' && (
          <p className="text-xs text-gray-400 italic">Switch to Bear or Bull to see how market conditions affect each goal.</p>
        )}

        {/* Per-goal impact rows */}
        <div className="space-y-2">
          {impacts.map((imp) => {
            const pct = Math.min(100, Math.round((imp.scenarioProjected / imp.targetAmount) * 100));
            const barColor =
              imp.isOnTrack ? 'bg-emerald-500' :
              imp.statusChanged ? 'bg-red-500' :
              'bg-amber-500';

            return (
              <div
                key={imp.goalId}
                className={`p-3 rounded-lg border transition-colors ${
                  imp.statusChanged
                    ? imp.isOnTrack
                      ? 'border-emerald-200 bg-emerald-50/40'
                      : 'border-red-200 bg-red-50/40'
                    : 'border-gray-100 bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-gray-800 truncate">{imp.goalName}</span>
                    {imp.statusChanged && (
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded border flex-shrink-0 ${
                        imp.isOnTrack
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-red-50 text-red-700 border-red-200'
                      }`}>
                        {imp.isOnTrack ? '↑ Now On Track' : '↓ Now Off Track'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs flex-shrink-0">
                    <span className="text-gray-400 tabular-nums">
                      {fmtDollars(imp.scenarioProjected)} / {fmtDollars(imp.targetAmount)}
                    </span>
                    {scenario !== 'base' && (
                      <span className={`font-semibold tabular-nums ${imp.delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {fmtImpact(imp.delta)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    className={`${barColor} h-1.5 rounded-full transition-all duration-500`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* AI Narrative */}
        <div className="pt-2 border-t border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Advisor Narrative</span>
            {!apiKey ? (
              <button onClick={() => navigate('/settings')} className="text-xs text-blue-600 underline">Add API key</button>
            ) : (
              <Button size="sm" variant="outline" className="h-6 text-xs" onClick={handleGenerateNarrative} disabled={narrativeLoading}>
                <Sparkles size={11} className="mr-1" /> {narrative ? 'Regenerate' : 'Generate'}
              </Button>
            )}
          </div>
          {narrativeLoading && (
            <div className="space-y-2">
              <Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-4/5" />
            </div>
          )}
          {narrativeError && (
            <Alert variant="destructive"><AlertDescription>{narrativeError}</AlertDescription></Alert>
          )}
          {narrative && !narrativeLoading && (
            <div className="p-3.5 bg-gray-50 rounded-lg border border-gray-100 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
              {narrative}
              <AiBadge />
            </div>
          )}
          {!narrative && !narrativeLoading && !narrativeError && apiKey && (
            <p className="text-xs text-gray-400 italic">
              Generate an advisor note explaining this scenario's impact and recommended actions.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function GoalStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-gray-400 mb-0.5">{label}</div>
      <div className="font-medium text-gray-800">{value}</div>
    </div>
  );
}

// ─── Tab 4: History ───────────────────────────────────────────────────────────

function HistoryTab({ client }: { client: Client }) {
  const [showModal, setShowModal] = useState(false);
  const toggleActionItem = useAppStore((s) => s.toggleActionItem);

  const sorted = [...client.history].sort(
    (a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime()
  );

  const TYPE_STYLES: Record<string, string> = {
    meeting: 'bg-blue-50 text-blue-700 border-blue-200',
    call: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    email: 'bg-purple-50 text-purple-700 border-purple-200',
    note: 'bg-gray-100 text-gray-600 border-gray-200',
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowModal(true)}>
          <PlusCircle size={13} className="mr-1.5" /> Log Interaction
        </Button>
      </div>

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <ClipboardList size={32} className="text-gray-200 mb-3" />
          <p className="text-sm text-gray-400">No interaction history recorded</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sorted.map((interaction) => (
            <div key={interaction.id} className="border border-gray-200 rounded-lg p-4 bg-white space-y-3">
              <div className="flex items-center gap-3">
                <span className={`text-xs font-medium px-2 py-0.5 rounded border capitalize ${TYPE_STYLES[interaction.type] ?? TYPE_STYLES.note}`}>
                  {interaction.type}
                </span>
                <span className="text-sm font-medium text-gray-700">{format(parseISO(interaction.date), 'MMMM d, yyyy')}</span>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">{interaction.summary}</p>

              {interaction.actionItems.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">Action Items</p>
                  {interaction.actionItems.map((ai) => (
                    <div key={ai.id} className="flex items-start gap-2.5">
                      <Checkbox
                        checked={ai.completed}
                        onCheckedChange={() => toggleActionItem(client.id, interaction.id, ai.id)}
                        className="mt-0.5 flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm leading-tight ${ai.completed ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                          {ai.description}
                        </span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-xs px-1.5 py-0.5 rounded ${ai.assignedTo === 'FA' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                            {ai.assignedTo}
                          </span>
                          <span className="text-xs text-gray-400">Due {formatDate(ai.dueDate)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && <LogInteractionModal client={client} onClose={() => setShowModal(false)} />}
    </div>
  );
}

// ─── Log Interaction Modal ────────────────────────────────────────────────────

type EditableActionItem = {
  description: string;
  assignedTo: 'FA' | 'Client';
  suggestedDueDate: string;
};

const FOLLOWUP_KEYWORDS = /\bschedule\b|\bfollow[- ]?up\b|\bnext meeting\b|\bcall back\b|\bcheck[- ]?in\b/i;

// Generate time options in 30-min intervals, 7am–7pm
function generateTimeOptions(): string[] {
  const opts: string[] = [];
  for (let h = 7; h <= 19; h++) {
    for (const m of [0, 30]) {
      const period = h < 12 ? 'AM' : 'PM';
      const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
      opts.push(`${displayH}:${m === 0 ? '00' : '30'} ${period}`);
    }
  }
  return opts;
}

function LogInteractionModal({ client, onClose }: { client: Client; onClose: () => void }) {
  const addInteraction = useAppStore((s) => s.addInteraction);
  const addUpcomingMeeting = useAppStore((s) => s.addUpcomingMeeting);
  const apiKey = useAppStore((s) => s.claudeApiKey);
  const navigate = useNavigate();
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [extracted, setExtracted] = useState<ExtractedMeetingData | null>(null);
  const [editableItems, setEditableItems] = useState<EditableActionItem[]>([]);
  const [followUpEmail, setFollowUpEmail] = useState('');
  const [emailCopied, setEmailCopied] = useState(false);

  // Schedule follow-up state (shown after save)
  const [saved, setSaved] = useState(false);
  const [followUpReason, setFollowUpReason] = useState('');
  const [followUpDate, setFollowUpDate] = useState(
    format(addDays(new Date(), 14), 'yyyy-MM-dd')
  );
  const [followUpTime, setFollowUpTime] = useState('10:00 AM');

  async function handleExtract() {
    if (!notes.trim()) return;
    setLoading(true);
    setError('');
    setExtracted(null);
    try {
      const raw = await extractMeetingNotes(notes);
      const data = JSON.parse(raw) as ExtractedMeetingData;
      setExtracted(data);
      setEditableItems(data.actionItems.map((ai) => ({ ...ai })));
      setFollowUpEmail(data.followUpEmail ?? '');
    } catch {
      setError('Unable to extract meeting notes. Please check your API key in Settings or try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleSave() {
    if (!extracted) return;
    const newInteraction: Interaction = {
      id: `hist-${client.id}-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      type: 'meeting',
      summary: Array.isArray(extracted.summary) ? extracted.summary.join(' ') : String(extracted.summary),
      actionItems: editableItems.map((ai, i): ActionItem => ({
        id: `ai-new-${Date.now()}-${i}`,
        description: ai.description,
        assignedTo: ai.assignedTo,
        dueDate: ai.suggestedDueDate,
        completed: false,
      })),
    };
    addInteraction(client.id, newInteraction);
    toast({ title: 'Interaction saved', description: 'Meeting notes added to history.' });

    // Check action items for follow-up keywords
    const followUpItem = editableItems.find((ai) => FOLLOWUP_KEYWORDS.test(ai.description));
    if (followUpItem) {
      setFollowUpReason(followUpItem.description);
      setSaved(true);
    } else {
      onClose();
    }
  }

  function handleAddToCalendar() {
    const newMeeting: UpcomingMeeting = {
      id: `mtg-${client.id}-${Date.now()}`,
      date: followUpDate,
      time: followUpTime,
      purpose: followUpReason || 'Follow-up meeting',
    };
    addUpcomingMeeting(client.id, newMeeting);
    toast({
      title: 'Follow-up scheduled',
      description: `Meeting added for ${format(parseISO(followUpDate), 'MMM d, yyyy')} at ${followUpTime}.`,
    });
    onClose();
  }

  async function handleCopyEmail() {
    try {
      await navigator.clipboard.writeText(followUpEmail);
      setEmailCopied(true);
      toast({ title: 'Email copied', description: 'Follow-up email ready to paste.' });
      setTimeout(() => setEmailCopied(false), 2000);
    } catch {
      toast({ title: 'Copy failed', description: 'Please select and copy manually.', variant: 'destructive' });
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Log Interaction — {client.name}</DialogTitle>
          <DialogDescription>Paste meeting notes below. Claude will extract and structure them for you.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!apiKey && (
            <Alert>
              <AlertDescription className="flex items-center justify-between gap-2">
                <span>Add your Claude API key in Settings to enable AI features.</span>
                <button onClick={() => { onClose(); navigate('/settings'); }} className="text-xs underline flex-shrink-0">
                  Go to Settings
                </button>
              </AlertDescription>
            </Alert>
          )}
          {!extracted && (
            <>
              <Textarea
                placeholder="Paste raw meeting notes, call notes, or interaction summary here…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={8}
                className="resize-none text-sm"
                disabled={loading || !apiKey}
              />
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-4/6" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ) : (
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
                  <Button size="sm" onClick={handleExtract} disabled={!notes.trim() || !apiKey}>
                    Extract & Save
                  </Button>
                </div>
              )}
            </>
          )}

          {extracted && !saved && (
            <div className="space-y-5">
              {/* Summary */}
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Meeting Summary</h3>
                <ul className="space-y-1">
                  {(Array.isArray(extracted.summary) ? extracted.summary : [extracted.summary]).map((s, i) => (
                    <li key={i} className="text-sm text-gray-700 flex gap-2">
                      <span className="text-gray-400 flex-shrink-0">•</span>{s}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Action Items */}
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Action Items</h3>
                <div className="space-y-2">
                  {editableItems.map((ai, i) => (
                    <div key={i} className="flex items-start gap-3 p-2.5 bg-gray-50 rounded-lg">
                      <div className="flex-1 space-y-1.5">
                        <input
                          className="w-full text-sm bg-transparent border-b border-gray-200 focus:border-blue-400 outline-none pb-0.5 text-gray-800"
                          value={ai.description}
                          onChange={(e) => setEditableItems((items) => items.map((item, idx) => idx === i ? { ...item, description: e.target.value } : item))}
                        />
                        <div className="flex items-center gap-2">
                          <select
                            className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white"
                            value={ai.assignedTo}
                            onChange={(e) => setEditableItems((items) => items.map((item, idx) => idx === i ? { ...item, assignedTo: e.target.value as 'FA' | 'Client' } : item))}
                          >
                            <option value="FA">FA</option>
                            <option value="Client">Client</option>
                          </select>
                          <input
                            type="date"
                            className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white"
                            value={ai.suggestedDueDate}
                            onChange={(e) => setEditableItems((items) => items.map((item, idx) => idx === i ? { ...item, suggestedDueDate: e.target.value } : item))}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Client Signals */}
              {extracted.clientSignals?.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Client Signals</h3>
                  <ul className="space-y-1">
                    {extracted.clientSignals.map((s, i) => (
                      <li key={i} className="text-sm text-gray-600 flex gap-2"><span className="text-amber-400">⚡</span>{s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Life Events */}
              {extracted.lifeEvents?.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Life Events Mentioned</h3>
                  <ul className="space-y-1">
                    {extracted.lifeEvents.map((e, i) => (
                      <li key={i} className="text-sm text-gray-600 flex gap-2"><span className="text-purple-400">★</span>{e}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Follow-up Email */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Follow-up Email Draft</h3>
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleCopyEmail}>
                    {emailCopied ? <><CheckCheck size={11} className="mr-1" />Copied</> : <><Copy size={11} className="mr-1" />Copy</>}
                  </Button>
                </div>
                <Textarea
                  value={followUpEmail}
                  onChange={(e) => setFollowUpEmail(e.target.value)}
                  rows={5}
                  className="resize-none text-sm"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
                <Button size="sm" onClick={handleSave}>Confirm &amp; Save</Button>
              </div>
            </div>
          )}

          {/* ── Schedule Follow-up Card (shown after save) ──────────────────── */}
          {saved && (
            <div className="space-y-4">
              {/* Success confirmation */}
              <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                <CheckCheck size={16} className="text-emerald-600 flex-shrink-0" />
                <span className="text-sm font-medium text-emerald-800">Interaction saved to {client.name}'s history</span>
              </div>

              {/* Schedule follow-up card */}
              <div className="border border-blue-200 rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 bg-blue-50 border-b border-blue-200">
                  <Calendar size={15} className="text-blue-600" />
                  <span className="text-sm font-semibold text-blue-900">Schedule your follow-up</span>
                </div>
                <div className="p-4 space-y-4">
                  <div>
                    <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1.5">
                      Reason
                    </label>
                    <input
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none"
                      value={followUpReason}
                      onChange={(e) => setFollowUpReason(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1.5">
                        Date
                      </label>
                      <input
                        type="date"
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none"
                        value={followUpDate}
                        onChange={(e) => setFollowUpDate(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1.5">
                        Time
                      </label>
                      <select
                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none bg-white"
                        value={followUpTime}
                        onChange={(e) => setFollowUpTime(e.target.value)}
                      >
                        {generateTimeOptions().map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <button
                      onClick={onClose}
                      className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      Skip
                    </button>
                    <Button size="sm" onClick={handleAddToCalendar}>
                      <Calendar size={13} className="mr-1.5" />
                      Add to Calendar
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Tab 5: AI Insights ───────────────────────────────────────────────────────

function AIInsightsTab({ client, briefTriggerCount }: { client: Client; briefTriggerCount: number }) {
  const updateClientSuggestions = useAppStore((s) => s.updateClientSuggestions);
  const apiKey = useAppStore((s) => s.claudeApiKey);
  const navigate = useNavigate();

  // ── Brief state ──
  const [brief, setBrief] = useState('');
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState('');
  const [briefCopied, setBriefCopied] = useState(false);
  const prevTriggerCount = useRef(0);

  // ── Suggestions state ──
  const [suggestions, setSuggestions] = useState<AISuggestion[]>(client.aiSuggestions ?? []);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState('');

  const generateBriefNow = useCallback(async () => {
    setBriefLoading(true);
    setBriefError('');
    setBrief('');
    try {
      const context = JSON.stringify(client, null, 2);
      const result = await generateBrief(context);
      setBrief(result);
    } catch (err) {
      setBriefError(err instanceof Error ? err.message : 'Unable to generate brief. Check your API key in Settings.');
    } finally {
      setBriefLoading(false);
    }
  }, [client]);

  const generateSuggestionsNow = useCallback(async () => {
    setSuggestionsLoading(true);
    setSuggestionsError('');
    try {
      const context = JSON.stringify(client, null, 2);
      const raw = await generateSuggestions(context);
      const parsed = JSON.parse(raw) as AISuggestion[];
      const withIds = parsed.map((s, i) => ({ ...s, id: `ai-suggest-${client.id}-${Date.now()}-${i}` }));
      setSuggestions(withIds);
      updateClientSuggestions(client.id, withIds);
    } catch {
      setSuggestionsError('Unable to load suggestions. Check your API key in Settings or try again.');
    } finally {
      setSuggestionsLoading(false);
    }
  }, [client, updateClientSuggestions]);

  // Auto-trigger brief when briefTriggerCount changes (only if API key exists)
  useEffect(() => {
    if (apiKey && briefTriggerCount > 0 && briefTriggerCount !== prevTriggerCount.current) {
      prevTriggerCount.current = briefTriggerCount;
      generateBriefNow();
    }
  }, [briefTriggerCount, generateBriefNow, apiKey]);

  // Auto-load suggestions on first mount if none cached (only if API key exists)
  useEffect(() => {
    if (apiKey && (!suggestions || suggestions.length === 0)) {
      generateSuggestionsNow();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCopyBrief() {
    try {
      await navigator.clipboard.writeText(brief);
      setBriefCopied(true);
      toast({ title: 'Brief copied to clipboard' });
      setTimeout(() => setBriefCopied(false), 2000);
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' });
    }
  }

  const briefSections = brief ? parseBriefSections(brief) : [];

  const PRIORITY_STYLES: Record<string, string> = {
    High: 'bg-red-50 text-red-700 border-red-200',
    Medium: 'bg-amber-50 text-amber-700 border-amber-200',
    Low: 'bg-gray-100 text-gray-600 border-gray-200',
  };

  const CATEGORY_STYLES: Record<string, string> = {
    Portfolio: 'bg-blue-50 text-blue-700 border-blue-200',
    Goals: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Tax: 'bg-orange-50 text-orange-700 border-orange-200',
    Relationship: 'bg-pink-50 text-pink-700 border-pink-200',
    Compliance: 'bg-red-50 text-red-700 border-red-200',
  };

  return (
    <div className="space-y-6">
      {/* ── Call Notes — re-runs all 4 agents ── */}
      <CallNotesPanel client={client} />

      {/* ── Attrition Risk Assessment ── */}
      <AttritionRiskCard client={client} />

      {/* ── Wallet Capture Opportunity ── */}
      <WalletCaptureCard client={client} />

      {/* ── Cross-Sell Opportunity ── */}
      <CrossSellCard client={client} />

      {/* ── Referral & Acquisition ── */}
      <ReferralCard client={client} />

      {/* ── Pre-Meeting Brief ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Pre-Meeting Brief</CardTitle>
            {brief && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={generateBriefNow} disabled={briefLoading}>
                  <RefreshCw size={12} className="mr-1" /> Regenerate
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleCopyBrief}>
                  {briefCopied ? <><CheckCheck size={12} className="mr-1" />Copied</> : <><Copy size={12} className="mr-1" />Copy</>}
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {briefLoading && (
            <div className="space-y-2.5">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className={`h-4 ${i % 3 === 0 ? 'w-1/3' : i % 2 === 0 ? 'w-5/6' : 'w-full'}`} />
              ))}
            </div>
          )}

          {briefError && (
            <div className="space-y-3">
              <Alert variant="destructive">
                <AlertDescription>{briefError}</AlertDescription>
              </Alert>
              <Button size="sm" onClick={generateBriefNow}>Try Again</Button>
            </div>
          )}

          {!brief && !briefLoading && !briefError && !apiKey && (
            <Alert>
              <AlertDescription className="flex items-center justify-between gap-2">
                <span>Add your Claude API key in Settings to enable AI features.</span>
                <button onClick={() => navigate('/settings')} className="text-xs underline flex-shrink-0">Go to Settings</button>
              </AlertDescription>
            </Alert>
          )}
          {!brief && !briefLoading && !briefError && apiKey && (
            <div className="flex flex-col items-center py-10 text-center gap-3">
              <Sparkles size={28} className="text-gray-200" />
              <p className="text-sm text-gray-500">
                Generate a pre-meeting brief for <span className="font-medium">{client.name}</span>
              </p>
              <Button onClick={generateBriefNow}>
                <Sparkles size={13} className="mr-1.5" /> Generate Brief
              </Button>
              <p className="text-xs text-gray-400 italic">Client data is summarised and anonymised before AI processing.</p>
            </div>
          )}

          {brief && !briefLoading && (
            <div className="space-y-4">
              {briefSections.map((section) => (
                <div key={section.title} className="p-3.5 bg-gray-50 rounded-lg border border-gray-100">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{section.title}</h3>
                  <BriefContent text={section.content} />
                </div>
              ))}
              <AiBadge />
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── AI Suggestions ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Insights & Recommendations</CardTitle>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={generateSuggestionsNow}
              disabled={suggestionsLoading}
            >
              <RefreshCw size={12} className="mr-1" /> Refresh
            </Button>
          </div>
          <p className="text-xs text-gray-400 italic mt-1">Client data is summarised and anonymised before AI processing.</p>
        </CardHeader>
        <CardContent>
          {suggestionsLoading && (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="border border-gray-100 rounded-lg p-4 space-y-2">
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                </div>
              ))}
            </div>
          )}

          {suggestionsError && (
            <div className="space-y-3">
              <Alert variant="destructive">
                <AlertDescription>{suggestionsError}</AlertDescription>
              </Alert>
              <Button size="sm" onClick={generateSuggestionsNow}>Try Again</Button>
            </div>
          )}

          {!suggestionsLoading && !suggestionsError && suggestions.length === 0 && !apiKey && (
            <Alert>
              <AlertDescription className="flex items-center justify-between gap-2">
                <span>Add your Claude API key in Settings to enable AI features.</span>
                <button onClick={() => navigate('/settings')} className="text-xs underline flex-shrink-0">Go to Settings</button>
              </AlertDescription>
            </Alert>
          )}
          {!suggestionsLoading && !suggestionsError && suggestions.length === 0 && apiKey && (
            <div className="flex flex-col items-center py-10 text-center gap-3">
              <Sparkles size={24} className="text-gray-200" />
              <p className="text-sm text-gray-400">No suggestions loaded yet</p>
              <Button size="sm" onClick={generateSuggestionsNow}>Generate Suggestions</Button>
            </div>
          )}

          {!suggestionsLoading && suggestions.length > 0 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {suggestions.map((s) => (
                  <div key={s.id} className="border border-gray-200 rounded-lg p-4 space-y-2 bg-white">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${CATEGORY_STYLES[s.category] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                        {s.category}
                      </span>
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${PRIORITY_STYLES[s.priority] ?? ''}`}>
                        {s.priority}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-gray-900 leading-tight">{s.title}</div>
                    <p className="text-xs text-gray-500 leading-relaxed">{s.description}</p>
                  </div>
                ))}
              </div>
              <AiBadge />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tab 6: Financial Plan ────────────────────────────────────────────────────

function FinancialPlanTab({
  client,
  updateSavedScenarios,
}: {
  client: Client;
  updateSavedScenarios: (clientId: string, scenarios: SavedScenario[]) => void;
}) {
  if (!client.netWorth) {
    return (
      <div className="space-y-6">
        {client.goals.length > 0 ? (
          <GoalsOverviewSection goals={client.goals} />
        ) : (
          <div className="flex flex-col items-center py-16 text-center">
            <DollarSign size={32} className="text-gray-200 mb-3" />
            <p className="text-sm text-gray-400">No financial plan data available for this client</p>
          </div>
        )}
        <InsuranceSection client={client} />
        <EstatePlanSection client={client} />
        <ScenarioModellingSection client={client} updateSavedScenarios={updateSavedScenarios} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <NetWorthSection client={client} />
      <CashFlowSection client={client} />
      <RetirementProjectionSection client={client} />
      <InsuranceSection client={client} />
      <EstatePlanSection client={client} />
      <ScenarioModellingSection client={client} updateSavedScenarios={updateSavedScenarios} />
    </div>
  );
}

// ─── Goals Overview (shown when netWorth is unavailable) ──────────────────────

function GoalsOverviewSection({ goals }: { goals: Goal[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Target size={14} className="text-gray-400" /> Goals Overview
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {goals.map((g) => {
          const pct = g.targetAmount > 0
            ? Math.min(100, Math.round((g.currentAmount / g.targetAmount) * 100))
            : 0;
          return (
            <div key={g.id} className="border border-gray-100 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-gray-900">{g.name}</p>
                  {g.targetDate && (
                    <p className="text-xs text-gray-400">Target: {g.targetDate}</p>
                  )}
                </div>
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${g.onTrack ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                  {g.onTrack ? 'On Track' : 'Off Track'}
                </span>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>${g.currentAmount.toLocaleString()} of ${g.targetAmount.toLocaleString()}</span>
                  <span>{pct}%</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${g.onTrack ? 'bg-emerald-500' : 'bg-amber-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── Section 1: Net Worth ──────────────────────────────────────────────────────

function NetWorthSection({ client }: { client: Client }) {
  const nw = client.netWorth!;
  const totalAssets = nw.assets.investmentAccounts + nw.assets.primaryResidence + nw.assets.otherAssets;
  const totalLiabilities = nw.liabilities.mortgage + nw.liabilities.otherDebt;
  const netWorthValue = totalAssets - totalLiabilities;

  const TrendIcon = nw.trend === 'up' ? TrendingUp : nw.trend === 'down' ? TrendingDown : null;
  const trendColor = nw.trend === 'up' ? 'text-emerald-600' : nw.trend === 'down' ? 'text-red-500' : 'text-gray-400';

  const assetItems = [
    { label: 'Investment Accounts', value: nw.assets.investmentAccounts, color: '#3b82f6' },
    { label: 'Primary Residence', value: nw.assets.primaryResidence, color: '#10b981' },
    { label: 'Other Assets', value: nw.assets.otherAssets, color: '#8b5cf6' },
  ];
  const liabilityItems = [
    { label: 'Mortgage', value: nw.liabilities.mortgage, color: '#f59e0b' },
    { label: 'Other Debt', value: nw.liabilities.otherDebt, color: '#ef4444' },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <DollarSign size={14} className="text-gray-400" /> Net Worth
          </CardTitle>
          <div className={`flex items-center gap-1 text-sm font-semibold ${trendColor}`}>
            {TrendIcon && <TrendIcon size={14} />}
            {fmtDollars(netWorthValue)}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-6">
          {/* Assets */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Assets · {fmtDollars(totalAssets)}</p>
            <div className="space-y-2.5">
              {assetItems.map((item) => (
                <div key={item.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ background: item.color }} />
                      {item.label}
                    </span>
                    <span className="font-medium text-gray-800 tabular-nums">{fmtDollars(item.value)}</span>
                  </div>
                  <Progress value={Math.round((item.value / totalAssets) * 100)} className="h-1.5" />
                </div>
              ))}
            </div>
          </div>
          {/* Liabilities */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Liabilities · {fmtDollars(totalLiabilities)}</p>
            <div className="space-y-2.5">
              {liabilityItems.map((item) => (
                <div key={item.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ background: item.color }} />
                      {item.label}
                    </span>
                    <span className="font-medium text-gray-800 tabular-nums">{fmtDollars(item.value)}</span>
                  </div>
                  <Progress value={totalLiabilities > 0 ? Math.round((item.value / totalLiabilities) * 100) : 0} className="h-1.5" />
                </div>
              ))}
            </div>
            <div className="mt-4 pt-3 border-t border-gray-100">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Debt-to-Asset Ratio</span>
                <span className="font-semibold text-gray-700 tabular-nums">
                  {totalAssets > 0 ? ((totalLiabilities / totalAssets) * 100).toFixed(1) : 0}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Section 2: Cash Flow ──────────────────────────────────────────────────────

function CashFlowSection({ client }: { client: Client }) {
  const cf = client.cashFlow!;
  const savingsRate = cf.monthlyIncome > 0 ? ((cf.monthlySavings / cf.monthlyIncome) * 100).toFixed(1) : '0';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <TrendingUp size={14} className="text-gray-400" /> Cash Flow
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Summary row */}
        <div className="grid grid-cols-3 gap-4">
          <StatBlock label="Monthly Income" value={fmtDollars(cf.monthlyIncome)} />
          <StatBlock label="Monthly Expenses" value={fmtDollars(cf.monthlyExpenses)} />
          <StatBlock label="Monthly Savings" value={fmtDollars(cf.monthlySavings)} positive={cf.monthlySavings >= 0} />
        </div>
        <div className="text-xs text-gray-400 text-center -mt-2">
          Savings rate: <span className="font-semibold text-gray-600">{savingsRate}%</span>
        </div>
        {/* Bar chart */}
        {cf.history.length > 0 && (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={cf.history} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => fmtDollars(v)} />
              <RechartsTooltip
                formatter={(value: number, name: string) => [fmtDollars(value), name]}
                contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e5e7eb' }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="income" name="Income" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              <Bar dataKey="expenses" name="Expenses" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              <Bar dataKey="savings" name="Savings" fill="#10b981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section 3: Retirement Projection ─────────────────────────────────────────

function RetirementProjectionSection({ client }: { client: Client }) {
  const retirementAge = client.retirementAge ?? 65;
  const desiredIncome = client.desiredMonthlyRetirementIncome ?? 5000;
  const currentSavings = client.netWorth?.assets.investmentAccounts ?? client.aum;
  const monthlyContribution = client.cashFlow?.monthlySavings ?? 1000;

  const data = calculateProjections({
    currentAge: client.age,
    retirementAge,
    currentSavings,
    monthlyContribution,
    desiredMonthlyRetirementIncome: desiredIncome,
  });

  const target = getRetirementTarget(desiredIncome);
  const atRetirement = data.find((d) => d.age === retirementAge);

  const meetsBase = (atRetirement?.baseCase ?? 0) >= target;
  const meetsConservative = (atRetirement?.conservative ?? 0) >= target;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Target size={14} className="text-gray-400" /> Retirement Projection
          </CardTitle>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>Retire at <span className="font-semibold text-gray-700">{retirementAge}</span></span>
            <span>·</span>
            <span>Goal: <span className="font-semibold text-gray-700">{fmtDollars(desiredIncome)}/mo</span></span>
            <span>·</span>
            <span>Target: <span className="font-semibold text-gray-700">{fmtDollars(target)}</span></span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Status badges */}
        <div className="flex gap-3">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${meetsBase ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
            Base case: {fmtDollars(atRetirement?.baseCase ?? 0)} {meetsBase ? '✓' : '✗'}
          </span>
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${meetsConservative ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
            Conservative: {fmtDollars(atRetirement?.conservative ?? 0)} {meetsConservative ? '✓' : '△'}
          </span>
        </div>

        {/* Area chart */}
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="optimisticGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="baseCaseGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="conservativeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="age" tick={{ fontSize: 10 }} tickLine={false} label={{ value: 'Age', position: 'insideBottomRight', offset: -4, fontSize: 10, fill: '#9ca3af' }} />
            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => fmtDollars(v)} width={56} />
            <RechartsTooltip
              formatter={(value: number, name: string) => [fmtDollars(value), name]}
              contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #e5e7eb' }}
              labelFormatter={(label) => `Age ${label}`}
            />
            <ReferenceLine x={retirementAge} stroke="#6b7280" strokeDasharray="4 2" label={{ value: 'Retire', position: 'insideTopLeft', fontSize: 9, fill: '#9ca3af' }} />
            <ReferenceLine y={target} stroke="#ef4444" strokeDasharray="4 2" label={{ value: 'Target', position: 'insideTopRight', fontSize: 9, fill: '#ef4444' }} />
            <Area type="monotone" dataKey="optimistic" name="Optimistic" stroke="#10b981" strokeWidth={1.5} fill="url(#optimisticGrad)" dot={false} />
            <Area type="monotone" dataKey="baseCase" name="Base Case" stroke="#3b82f6" strokeWidth={2} fill="url(#baseCaseGrad)" dot={false} />
            <Area type="monotone" dataKey="conservative" name="Conservative" stroke="#f59e0b" strokeWidth={1.5} fill="url(#conservativeGrad)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>

        <p className="text-xs text-gray-400 text-center">
          Conservative 5% · Base 7% · Optimistic 9% annual return · 4% withdrawal rule
        </p>
      </CardContent>
    </Card>
  );
}

// ── Section 4: Insurance ──────────────────────────────────────────────────────

const INS_STATUS_STYLES: Record<string, string> = {
  'In Place': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Review Needed': 'bg-amber-50 text-amber-700 border-amber-200',
  'Not Covered': 'bg-red-50 text-red-700 border-red-200',
};

function InsuranceSection({ client }: { client: Client }) {
  const insurance = client.insurance ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <Shield size={14} className="text-gray-400" /> Insurance Coverage
        </CardTitle>
      </CardHeader>
      <CardContent>
        {insurance.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No insurance data recorded</p>
        ) : (
          <div className="space-y-3">
            {insurance.map((ins, i) => (
              <div key={i} className="flex items-start justify-between gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-800">{ins.type}</span>
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${INS_STATUS_STYLES[ins.status] ?? 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                      {ins.status}
                    </span>
                  </div>
                  {ins.coverageAmount && (
                    <div className="text-xs text-gray-500 mt-1">Coverage: {fmtDollars(ins.coverageAmount)}</div>
                  )}
                  {ins.notes && <div className="text-xs text-gray-400 mt-0.5 leading-relaxed">{ins.notes}</div>}
                </div>
                {ins.lastReviewDate && (
                  <div className="text-xs text-gray-400 flex-shrink-0 text-right">
                    Reviewed<br />{format(parseISO(ins.lastReviewDate), 'MMM yyyy')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section 5: Estate Plan ────────────────────────────────────────────────────

const ESTATE_STATUS_STYLES: Record<string, string> = {
  'In Place': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Needs Update': 'bg-amber-50 text-amber-700 border-amber-200',
  'Missing': 'bg-red-50 text-red-700 border-red-200',
};

function EstatePlanSection({ client }: { client: Client }) {
  const docs = client.estatePlan?.documents ?? [];
  const missing = docs.filter((d) => d.status !== 'In Place').length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <FileText size={14} className="text-gray-400" /> Estate Plan
          </CardTitle>
          {missing > 0 && (
            <span className="text-xs text-amber-600 font-medium">{missing} document{missing > 1 ? 's' : ''} need attention</span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {docs.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No estate planning documents recorded</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {docs.map((doc, i) => (
              <div key={i} className="flex items-start justify-between gap-2 p-3 bg-gray-50 rounded-lg border border-gray-100">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 leading-tight">{doc.document}</div>
                  {doc.lastReviewDate && (
                    <div className="text-xs text-gray-400 mt-0.5">
                      {format(parseISO(doc.lastReviewDate), 'MMM yyyy')}
                    </div>
                  )}
                </div>
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded border flex-shrink-0 ${ESTATE_STATUS_STYLES[doc.status] ?? 'bg-gray-100 text-gray-500 border-gray-200'}`}>
                  {doc.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Section 6: Scenario Modelling ─────────────────────────────────────────────

function ScenarioModellingSection({
  client,
  updateSavedScenarios,
}: {
  client: Client;
  updateSavedScenarios: (clientId: string, scenarios: SavedScenario[]) => void;
}) {
  const apiKey = useAppStore((s) => s.claudeApiKey);
  const navigate = useNavigate();

  // Default values derived from client data
  const defaults = {
    retAge: client.retirementAge ?? 65,
    monthlyContrib: client.cashFlow?.monthlySavings ?? 1000,
    expectedReturn: 7,
    desiredIncome: client.desiredMonthlyRetirementIncome ?? 5000,
  };

  // Sliders
  const [retAge, setRetAge] = useState(defaults.retAge);
  const [monthlyContrib, setMonthlyContrib] = useState(defaults.monthlyContrib);
  const [expectedReturn, setExpectedReturn] = useState(defaults.expectedReturn);
  const [desiredIncome, setDesiredIncome] = useState(defaults.desiredIncome);

  // Narrative
  const [narrative, setNarrative] = useState('');
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [narrativeError, setNarrativeError] = useState('');

  // Save modal
  const [saveOpen, setSaveOpen] = useState(false);
  const [scenarioName, setScenarioName] = useState('');
  const savedScenarios = client.savedScenarios ?? [];

  const currentSavings = client.netWorth?.assets.investmentAccounts ?? client.aum;

  // Live projection with slider values — updates synchronously on every render
  const projData: ProjectionDataPoint[] = calculateProjections({
    currentAge: client.age,
    retirementAge: retAge,
    currentSavings,
    monthlyContribution: monthlyContrib,
    desiredMonthlyRetirementIncome: desiredIncome,
    baseReturn: expectedReturn / 100,
  });

  const target = getRetirementTarget(desiredIncome);
  const atRetirement = projData.find((d) => d.age === retAge);
  const projectedValue = atRetirement?.baseCase ?? 0;
  const meetsTarget = projectedValue >= target;
  const gap = projectedValue - target;

  // Stable narrative generator — useCallback so debounce effect dep array is clean
  const handleGenerateNarrative = useCallback(async () => {
    setNarrativeLoading(true);
    setNarrativeError('');
    setNarrative('');
    try {
      const proj = calculateProjections({
        currentAge: client.age,
        retirementAge: retAge,
        currentSavings: client.netWorth?.assets.investmentAccounts ?? client.aum,
        monthlyContribution: monthlyContrib,
        desiredMonthlyRetirementIncome: desiredIncome,
        baseReturn: expectedReturn / 100,
      });
      const tgt = getRetirementTarget(desiredIncome);
      const atRet = proj.find((d) => d.age === retAge);
      const pv = atRet?.baseCase ?? 0;
      const g = pv - tgt;

      const prompt = `You are a financial advisor assistant. Write a concise 2-3 paragraph plain-English interpretation of the following retirement scenario:
Client: ${client.name}, Age ${client.age}
Retirement Age: ${retAge}
Monthly Contribution: $${monthlyContrib.toLocaleString()}
Expected Annual Return: ${expectedReturn}%
Desired Monthly Income in Retirement: $${desiredIncome.toLocaleString()}
Projected Portfolio at Retirement: ${fmtDollars(pv)}
Target Portfolio (4% rule): ${fmtDollars(tgt)}
Gap: ${g >= 0 ? '+' : ''}${fmtDollars(g)}

Describe whether this scenario is on track, the key risks, and 2 specific actionable recommendations.`;
      const result = await generateScenarioNarrative(prompt);
      setNarrative(result);
    } catch {
      setNarrativeError('Unable to generate narrative. Check your API key in Settings.');
    } finally {
      setNarrativeLoading(false);
    }
  }, [retAge, monthlyContrib, expectedReturn, desiredIncome, client]);

  // 1.5s debounce: auto-fire narrative after any lever change (only if API key present)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!apiKey) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      handleGenerateNarrative();
    }, 1500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [retAge, monthlyContrib, expectedReturn, desiredIncome, apiKey, handleGenerateNarrative]);

  // Reset all levers to the client's actual data values
  function handleReset() {
    setRetAge(defaults.retAge);
    setMonthlyContrib(defaults.monthlyContrib);
    setExpectedReturn(defaults.expectedReturn);
    setDesiredIncome(defaults.desiredIncome);
    setNarrative('');
    setNarrativeError('');
  }

  function handleSaveScenario() {
    if (!scenarioName.trim()) return;
    const newScenario: SavedScenario = {
      id: `scenario-${client.id}-${Date.now()}`,
      name: scenarioName.trim(),
      retirementAge: retAge,
      monthlyContribution: monthlyContrib,
      expectedReturn,
      desiredMonthlyRetirementIncome: desiredIncome,
      narrative: narrative || undefined,
      createdAt: new Date().toISOString().split('T')[0],
    };
    const updated = [newScenario, ...savedScenarios].slice(0, 10); // keep last 10
    updateSavedScenarios(client.id, updated);
    toast({ title: 'Scenario saved', description: `"${newScenario.name}" added to saved scenarios.` });
    setSaveOpen(false);
    setScenarioName('');
  }

  function handleLoadScenario(s: SavedScenario) {
    setRetAge(s.retirementAge);
    setMonthlyContrib(s.monthlyContribution);
    setExpectedReturn(s.expectedReturn);
    setDesiredIncome(s.desiredMonthlyRetirementIncome);
    if (s.narrative) setNarrative(s.narrative);
    toast({ title: 'Scenario loaded', description: `"${s.name}" applied to sliders.` });
  }

  function handleDeleteScenario(scenarioId: string) {
    const updated = savedScenarios.filter((s) => s.id !== scenarioId);
    updateSavedScenarios(client.id, updated);
    toast({ title: 'Scenario deleted' });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Sparkles size={14} className="text-gray-400" /> Scenario Modelling
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500" onClick={handleReset}>
              <RefreshCw size={11} className="mr-1" /> Reset to defaults
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSaveOpen(true)}>
              Save Scenario
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Sliders */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          <SliderControl
            label="Retirement Age"
            value={retAge}
            min={50} max={75} step={1}
            display={`${retAge}`}
            onChange={(v) => setRetAge(v[0])}
          />
          <SliderControl
            label="Monthly Contribution"
            value={monthlyContrib}
            min={0} max={20000} step={250}
            display={fmtDollars(monthlyContrib)}
            onChange={(v) => setMonthlyContrib(v[0])}
          />
          <SliderControl
            label="Expected Return"
            value={expectedReturn}
            min={3} max={12} step={0.5}
            display={`${expectedReturn}%`}
            onChange={(v) => setExpectedReturn(v[0])}
          />
          <SliderControl
            label="Desired Monthly Income"
            value={desiredIncome}
            min={1000} max={30000} step={500}
            display={fmtDollars(desiredIncome)}
            onChange={(v) => setDesiredIncome(v[0])}
          />
        </div>

        {/* Live result bar */}
        <div className={`flex items-center justify-between gap-4 p-4 rounded-lg border ${meetsTarget ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <div>
            <div className="text-xs text-gray-500 font-medium">Projected at retirement · {fmtDollars(projectedValue)}</div>
            <div className={`text-lg font-bold mt-0.5 tabular-nums ${meetsTarget ? 'text-emerald-700' : 'text-red-600'}`}>
              {meetsTarget
                ? `Projected surplus: +${fmtDollars(gap)}`
                : `Projected shortfall: ${fmtDollars(gap)}`}
            </div>
          </div>
          <div className="text-right text-xs text-gray-500">
            <div>Target (4% rule)</div>
            <div className="font-semibold text-gray-700 tabular-nums">{fmtDollars(target)}</div>
          </div>
        </div>

        {/* Mini projection chart */}
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={projData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="scenarioGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="age" tick={{ fontSize: 10 }} tickLine={false} />
            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => fmtDollars(v)} width={52} />
            <RechartsTooltip
              formatter={(value: number) => [fmtDollars(value), 'Portfolio']}
              contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #e5e7eb' }}
              labelFormatter={(label) => `Age ${label}`}
            />
            <ReferenceLine x={retAge} stroke="#6b7280" strokeDasharray="4 2" />
            <ReferenceLine y={target} stroke="#ef4444" strokeDasharray="4 2" />
            <Area type="monotone" dataKey="baseCase" name="Portfolio" stroke="#3b82f6" strokeWidth={2} fill="url(#scenarioGrad)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>

        {/* Narrative — auto-fires 1.5s after any lever change when API key is set */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              AI Scenario Narrative
              {apiKey && <span className="ml-1.5 text-gray-300 font-normal normal-case tracking-normal">· updates automatically</span>}
            </span>
            {!apiKey ? (
              <button onClick={() => navigate('/settings')} className="text-xs text-blue-600 underline">Add API key</button>
            ) : (
              <Button size="sm" variant="outline" className="h-6 text-xs" onClick={handleGenerateNarrative} disabled={narrativeLoading}>
                <RefreshCw size={11} className={`mr-1 ${narrativeLoading ? 'animate-spin' : ''}`} />
                {narrativeLoading ? 'Generating…' : 'Regenerate'}
              </Button>
            )}
          </div>
          {narrativeLoading && (
            <div className="space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          )}
          {narrativeError && !narrativeLoading && (
            <Alert variant="destructive"><AlertDescription>{narrativeError}</AlertDescription></Alert>
          )}
          {narrative && !narrativeLoading && (
            <div className="p-3.5 bg-gray-50 rounded-lg border border-gray-100 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
              {narrative}
              <AiBadge />
            </div>
          )}
          {!narrative && !narrativeLoading && !narrativeError && !apiKey && (
            <p className="text-xs text-gray-400 italic">Add a Claude API key in Settings to enable auto-generated narratives.</p>
          )}
        </div>

        {/* Saved Scenarios */}
        {savedScenarios.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Saved Scenarios</p>
            <div className="space-y-2">
              {savedScenarios.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 p-3 bg-gray-50 border border-gray-100 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">{s.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      Retire {s.retirementAge} · {fmtDollars(s.monthlyContribution)}/mo · {s.expectedReturn}% return · {format(parseISO(s.createdAt), 'MMM d, yyyy')}
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => handleLoadScenario(s)}>Load</Button>
                    <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleDeleteScenario(s.id)}>Delete</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Save Dialog */}
        <Dialog open={saveOpen} onOpenChange={(o) => { if (!o) setSaveOpen(false); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Save Scenario</DialogTitle>
              <DialogDescription>Give this scenario a name to save it for future reference.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                placeholder="e.g. Early retirement at 58"
                value={scenarioName}
                onChange={(e) => setScenarioName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveScenario(); }}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSaveOpen(false)}>Cancel</Button>
                <Button size="sm" onClick={handleSaveScenario} disabled={!scenarioName.trim()}>Save</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ── Shared: Slider Control ────────────────────────────────────────────────────

function SliderControl({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number[]) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs">
        <span className="text-gray-500 font-medium">{label}</span>
        <span className="font-semibold text-gray-800 tabular-nums">{display}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={onChange} className="w-full" />
      <div className="flex justify-between text-xs text-gray-300 tabular-nums">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
