import { useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Printer, TrendingUp, Target, Shield,
  FileText, DollarSign, CheckCircle, AlertCircle, Clock,
} from 'lucide-react';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip as RechartsTooltip,
} from 'recharts';
import { format, parseISO, differenceInMonths } from 'date-fns';
import { useAppStore } from '@/store/appStore';
import { calculateProjections, getRetirementTarget, fmtDollars } from '@/lib/projections';
import { calculateHealthScore, formatAUM } from '@/lib/healthScore';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { Client } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

const INS_STATUS_ICON: Record<string, React.ReactNode> = {
  'In Place':      <CheckCircle size={13} className="text-emerald-500 flex-shrink-0" />,
  'Review Needed': <Clock size={13} className="text-amber-500 flex-shrink-0" />,
  'Not Covered':   <AlertCircle size={13} className="text-red-500 flex-shrink-0" />,
};

const ESTATE_STATUS_ICON: Record<string, React.ReactNode> = {
  'In Place':    <CheckCircle size={13} className="text-emerald-500 flex-shrink-0" />,
  'Needs Update':<Clock size={13} className="text-amber-500 flex-shrink-0" />,
  'Missing':     <AlertCircle size={13} className="text-red-500 flex-shrink-0" />,
};

// ─── Main Component ───────────────────────────────────────────────────────────

export function ClientSummary() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const clients = useAppStore((s) => s.clients);
  const client = clients.find((c) => c.id === id);
  const printRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = client
      ? `AdvisorIQ — Summary · ${client.name}`
      : 'AdvisorIQ — Client Summary';
  }, [client]);

  function handlePrint() {
    window.print();
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-gray-50">
        <p className="text-gray-500">Client not found</p>
        <Button variant="outline" onClick={() => navigate('/clients')}>
          <ArrowLeft size={14} className="mr-1.5" /> All Clients
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      {/* ── Screen-only toolbar ── */}
      <div className="print:hidden sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between gap-4 shadow-sm">
        <button
          onClick={() => navigate(`/clients/${client.id}`)}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft size={14} /> Back to Profile
        </button>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Client-Facing Summary · {format(new Date(), 'MMMM d, yyyy')}</span>
          <Button size="sm" onClick={handlePrint} className="h-8">
            <Printer size={13} className="mr-1.5" /> Print / Save PDF
          </Button>
        </div>
      </div>

      {/* ── Printable body ── */}
      <div ref={printRef} className="max-w-3xl mx-auto px-6 py-10 print:px-8 print:py-6 space-y-8 print:space-y-6">

        {/* ── Cover header ── */}
        <SummaryHeader client={client} />

        {/* ── Net Worth ── */}
        {client.netWorth && <NetWorthSummary client={client} />}

        {/* ── Goals ── */}
        {client.goals.length > 0 && <GoalsSummary client={client} />}

        {/* ── Retirement Projection ── */}
        {client.retirementAge && client.desiredMonthlyRetirementIncome && (
          <RetirementSummary client={client} />
        )}

        {/* ── Insurance ── */}
        {client.insurance && client.insurance.length > 0 && (
          <InsuranceSummary client={client} />
        )}

        {/* ── Estate Plan ── */}
        {client.estatePlan && client.estatePlan.documents.length > 0 && (
          <EstateSummary client={client} />
        )}

        {/* ── Next Steps ── */}
        <NextStepsSummary client={client} />

        {/* ── Footer ── */}
        <SummaryFooter />
      </div>
    </div>
  );
}

// ─── Section: Header ──────────────────────────────────────────────────────────

function SummaryHeader({ client }: { client: Client }) {
  const health = calculateHealthScore(client);
  const healthLabel =
    health.color === 'green' ? 'On Track' :
    health.color === 'amber' ? 'Needs Attention' : 'Action Required';
  const healthColor =
    health.color === 'green' ? 'text-emerald-600 bg-emerald-50 border-emerald-200' :
    health.color === 'amber' ? 'text-amber-600 bg-amber-50 border-amber-200' :
    'text-red-600 bg-red-50 border-red-200';

  return (
    <div className="flex items-start justify-between gap-6 pb-6 border-b border-gray-200">
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-lg font-bold flex-shrink-0 print:border print:border-blue-200">
          {getInitials(client.name)}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{client.name}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Age {client.age} · {client.employment} · Client since {format(parseISO(client.clientSince), 'yyyy')}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-sm font-semibold text-gray-800">{formatAUM(client.aum)}</span>
            <span className="text-gray-300">·</span>
            <span className="text-xs font-medium text-gray-600 border border-gray-200 rounded px-1.5 py-0.5">
              {client.riskProfile}
            </span>
            <span className={`text-xs font-medium border rounded px-1.5 py-0.5 ${healthColor}`}>
              {healthLabel}
            </span>
          </div>
        </div>
      </div>
      <div className="text-right text-xs text-gray-400 flex-shrink-0 print:block hidden">
        <p className="font-semibold text-gray-600">Financial Summary</p>
        <p>{format(new Date(), 'MMMM d, yyyy')}</p>
        <p className="mt-1">Confidential</p>
      </div>
    </div>
  );
}

// ─── Section: Net Worth ───────────────────────────────────────────────────────

function NetWorthSummary({ client }: { client: Client }) {
  const nw = client.netWorth!;
  const totalAssets = nw.assets.investmentAccounts + nw.assets.primaryResidence + nw.assets.otherAssets;
  const totalLiabilities = nw.liabilities.mortgage + nw.liabilities.otherDebt;
  const netWorthValue = totalAssets - totalLiabilities;

  const radarData = [
    { subject: 'Investments', value: Math.round((nw.assets.investmentAccounts / totalAssets) * 100) },
    { subject: 'Real Estate', value: Math.round((nw.assets.primaryResidence / totalAssets) * 100) },
    { subject: 'Other Assets', value: Math.round((nw.assets.otherAssets / totalAssets) * 100) },
    { subject: 'Low Debt', value: totalAssets > 0 ? Math.round((1 - totalLiabilities / totalAssets) * 100) : 100 },
    { subject: 'Liquidity', value: Math.round((nw.assets.investmentAccounts / totalAssets) * 100) },
  ];

  return (
    <section>
      <SectionTitle icon={<DollarSign size={15} />} title="Net Worth Snapshot" />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <SummaryStatCard label="Total Assets" value={fmtDollars(totalAssets)} sub="across all accounts" />
        <SummaryStatCard label="Total Liabilities" value={fmtDollars(totalLiabilities)} sub="mortgage + debt" />
        <SummaryStatCard label="Net Worth" value={fmtDollars(netWorthValue)} sub={`trend: ${nw.trend}`} highlight />
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Asset breakdown */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Asset Breakdown</p>
          <div className="space-y-2">
            {[
              { label: 'Investment Accounts', value: nw.assets.investmentAccounts, total: totalAssets, color: 'bg-blue-500' },
              { label: 'Primary Residence', value: nw.assets.primaryResidence, total: totalAssets, color: 'bg-emerald-500' },
              { label: 'Other Assets', value: nw.assets.otherAssets, total: totalAssets, color: 'bg-purple-500' },
            ].map((item) => (
              <div key={item.label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-gray-600">{item.label}</span>
                  <span className="font-medium text-gray-800 tabular-nums">{fmtDollars(item.value)}</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div className={`${item.color} h-1.5 rounded-full`} style={{ width: `${Math.round((item.value / item.total) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Radar chart */}
        <div className="print:hidden">
          <ResponsiveContainer width="100%" height={160}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#e5e7eb" />
              <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: '#6b7280' }} />
              <Radar dataKey="value" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={1.5} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

// ─── Section: Goals ───────────────────────────────────────────────────────────

function GoalsSummary({ client }: { client: Client }) {
  const today = new Date();

  return (
    <section>
      <SectionTitle icon={<Target size={15} />} title="Financial Goals" />
      <div className="space-y-3">
        {client.goals.map((goal) => {
          const months = Math.max(0, differenceInMonths(parseISO(goal.targetDate), today));
          const projected = goal.currentAmount + goal.monthlyContribution * months;
          const pct = Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100));
          const onTrack = projected >= goal.targetAmount;

          return (
            <div key={goal.id} className="flex items-center gap-4 p-3 bg-gray-50 rounded-lg border border-gray-100 print:border-gray-200">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm font-medium text-gray-800">{goal.name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${onTrack ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                    {onTrack ? 'On Track' : 'Needs Review'}
                  </span>
                </div>
                <Progress value={pct} className="h-1.5 mb-1" />
                <div className="flex justify-between text-xs text-gray-400">
                  <span>{fmtDollars(goal.currentAmount)} saved</span>
                  <span>{fmtDollars(goal.targetAmount)} target · {format(parseISO(goal.targetDate), 'MMM yyyy')}</span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-sm font-bold tabular-nums text-gray-900">{pct}%</div>
                <div className="text-xs text-gray-400">funded</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Section: Retirement Projection ──────────────────────────────────────────

function RetirementSummary({ client }: { client: Client }) {
  const retirementAge = client.retirementAge!;
  const desiredIncome = client.desiredMonthlyRetirementIncome!;
  const currentSavings = client.netWorth?.assets.investmentAccounts ?? client.aum;
  const monthlyContrib = client.cashFlow?.monthlySavings ?? 1000;

  const data = calculateProjections({
    currentAge: client.age,
    retirementAge,
    currentSavings,
    monthlyContribution: monthlyContrib,
    desiredMonthlyRetirementIncome: desiredIncome,
  });

  const target = getRetirementTarget(desiredIncome);
  const atRetirement = data.find((d) => d.age === retirementAge);
  const projected = atRetirement?.baseCase ?? 0;
  const surplus = projected - target;
  const onTrack = projected >= target;

  return (
    <section>
      <SectionTitle icon={<TrendingUp size={15} />} title="Retirement Projection" />
      <div className="grid grid-cols-3 gap-4 mb-5">
        <SummaryStatCard label="Retire At" value={`Age ${retirementAge}`} sub={`${retirementAge - client.age} years away`} />
        <SummaryStatCard label="Target Portfolio" value={fmtDollars(target)} sub={`4% rule · ${fmtDollars(desiredIncome)}/mo`} />
        <SummaryStatCard
          label={onTrack ? 'Projected Surplus' : 'Projected Shortfall'}
          value={`${surplus >= 0 ? '+' : ''}${fmtDollars(surplus)}`}
          sub={`Base case at age ${retirementAge}`}
          highlight
          positive={onTrack}
        />
      </div>

      <ResponsiveContainer width="100%" height={200} className="print:hidden">
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="summaryOptGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="summaryBaseGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="summaryConsGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="age" tick={{ fontSize: 10 }} tickLine={false} />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => fmtDollars(v)} width={56} />
          <RechartsTooltip
            formatter={(value: number, name: string) => [fmtDollars(value), name]}
            contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #e5e7eb' }}
            labelFormatter={(label) => `Age ${label}`}
          />
          <Area type="monotone" dataKey="optimistic" name="Optimistic" stroke="#10b981" strokeWidth={1.5} fill="url(#summaryOptGrad)" dot={false} />
          <Area type="monotone" dataKey="baseCase" name="Base Case" stroke="#3b82f6" strokeWidth={2} fill="url(#summaryBaseGrad)" dot={false} />
          <Area type="monotone" dataKey="conservative" name="Conservative" stroke="#f59e0b" strokeWidth={1.5} fill="url(#summaryConsGrad)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
      <p className="text-xs text-gray-400 mt-2 print:hidden text-center">Conservative 5% · Base 7% · Optimistic 9% annual return</p>
    </section>
  );
}

// ─── Section: Insurance ───────────────────────────────────────────────────────

function InsuranceSummary({ client }: { client: Client }) {
  const insurance = client.insurance ?? [];
  return (
    <section>
      <SectionTitle icon={<Shield size={15} />} title="Insurance Coverage" />
      <div className="grid grid-cols-2 gap-2">
        {insurance.map((ins, i) => (
          <div key={i} className="flex items-start gap-2 p-3 bg-gray-50 border border-gray-100 rounded-lg print:border-gray-200">
            {INS_STATUS_ICON[ins.status]}
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-800 leading-tight">{ins.type}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {ins.status}{ins.coverageAmount ? ` · ${fmtDollars(ins.coverageAmount)}` : ''}
              </div>
              {ins.notes && <div className="text-xs text-gray-400 mt-0.5 leading-relaxed">{ins.notes}</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Section: Estate Plan ─────────────────────────────────────────────────────

function EstateSummary({ client }: { client: Client }) {
  const docs = client.estatePlan?.documents ?? [];
  const needsAttention = docs.filter((d) => d.status !== 'In Place');

  return (
    <section>
      <SectionTitle icon={<FileText size={15} />} title="Estate Plan" />
      {needsAttention.length > 0 && (
        <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 font-medium">
          {needsAttention.length} document{needsAttention.length > 1 ? 's' : ''} need{needsAttention.length === 1 ? 's' : ''} attention: {needsAttention.map((d) => d.document).join(', ')}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        {docs.map((doc, i) => (
          <div key={i} className="flex items-center gap-2 p-2.5 bg-gray-50 border border-gray-100 rounded-lg print:border-gray-200">
            {ESTATE_STATUS_ICON[doc.status]}
            <div className="flex-1 min-w-0">
              <span className="text-sm text-gray-800">{doc.document}</span>
            </div>
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded border flex-shrink-0 ${
              doc.status === 'In Place' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
              doc.status === 'Needs Update' ? 'bg-amber-50 text-amber-700 border-amber-200' :
              'bg-red-50 text-red-700 border-red-200'
            }`}>
              {doc.status}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Section: Next Steps ──────────────────────────────────────────────────────

function NextStepsSummary({ client }: { client: Client }) {
  // Collect open action items across all history
  const openItems = client.history
    .flatMap((h) => h.actionItems.filter((ai) => !ai.completed))
    .slice(0, 6);

  if (openItems.length === 0) return null;

  return (
    <section>
      <SectionTitle icon={<CheckCircle size={15} />} title="Open Action Items" />
      <div className="space-y-2">
        {openItems.map((ai) => (
          <div key={ai.id} className="flex items-start gap-2.5 p-2.5 bg-gray-50 border border-gray-100 rounded-lg print:border-gray-200">
            <div className="w-4 h-4 rounded border border-gray-300 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-700">{ai.description}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {ai.assignedTo === 'FA' ? 'Advisor' : 'Client'} · Due {format(parseISO(ai.dueDate), 'MMM d, yyyy')}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Section: Footer ──────────────────────────────────────────────────────────

function SummaryFooter() {
  return (
    <footer className="pt-6 border-t border-gray-200 text-xs text-gray-400 space-y-1">
      <p className="font-medium text-gray-500">Important Disclosures</p>
      <p>
        This summary is prepared for informational purposes only and does not constitute investment advice.
        Past performance is not indicative of future results. Projections shown are hypothetical and based
        on assumed rates of return which may not be achieved. All figures are estimates and subject to change.
      </p>
      <p>
        Prepared by AdvisorIQ · {format(new Date(), 'MMMM d, yyyy')} · Confidential — for client use only
      </p>
    </footer>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <span className="text-gray-400">{icon}</span>
      <h2 className="text-base font-semibold text-gray-900">{title}</h2>
      <div className="flex-1 h-px bg-gray-200" />
    </div>
  );
}

function SummaryStatCard({
  label, value, sub, highlight, positive,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  positive?: boolean;
}) {
  const valueColor =
    highlight && positive !== undefined
      ? positive ? 'text-emerald-700' : 'text-red-600'
      : highlight
      ? 'text-blue-700'
      : 'text-gray-900';

  return (
    <div className={`p-3.5 rounded-lg border ${highlight ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-100'} print:border-gray-200`}>
      <div className="text-xs text-gray-500 font-medium mb-1">{label}</div>
      <div className={`text-lg font-bold tabular-nums leading-tight ${valueColor}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}
