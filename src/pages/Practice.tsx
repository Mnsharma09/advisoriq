import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import {
  TrendingUp, Users, AlertTriangle, ClipboardList,
  Briefcase, Info, ArrowUpRight, ArrowDownRight, Search,
  DollarSign, Home, Clock, FileWarning, ChevronRight, BarChart3,
} from 'lucide-react';
import { differenceInDays, parseISO, format, subMonths } from 'date-fns';
import { useAppStore } from '@/store/appStore';
import { calculateHealthScore } from '@/lib/healthScore';
import { analyseBook } from '@/lib/crossBookIntelligence';
import type { InsightSeverity } from '@/lib/crossBookIntelligence';
import { HealthBadge } from '@/components/ui/HealthBadge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PatternDiscoveryCard } from '@/components/practice/PatternDiscoveryCard';
import { BookOfWorkCard } from '@/components/practice/BookOfWorkCard';

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmtUSD = (v: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(v);

const fmtCompact = (v: number): string => {
  const abs = Math.abs(v);
  const prefix = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${prefix}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${prefix}$${Math.round(abs / 1_000)}K`;
  return fmtUSD(v);
};

const fmtPct = (v: number) => `${v.toFixed(1)}%`;

// ─── Types ────────────────────────────────────────────────────────────────────

type SortKey = 'aum' | 'health' | 'lastContact' | 'openItems' | 'revenue';

// ─── Component ────────────────────────────────────────────────────────────────

export function PracticeDashboard() {
  const navigate = useNavigate();
  const clients = useAppStore((s) => s.clients);
  useEffect(() => { document.title = 'AdvisorIQ — My Practice'; }, []);

  // ── Derived client data ──────────────────────────────────────────────
  const scoredClients = useMemo(() => {
    const now = new Date();
    return clients.map((c, idx) => {
      const healthScore = calculateHealthScore(c);
      const openItems = c.history.flatMap((h) =>
        h.actionItems.filter((ai) => !ai.completed)
      ).length;
      const overdueItems = c.history.flatMap((h) =>
        h.actionItems.filter(
          (ai) => !ai.completed && differenceInDays(now, parseISO(ai.dueDate)) > 0
        )
      ).length;
      const daysSinceContact = differenceInDays(now, parseISO(c.lastContact));
      const revenue = c.aum * 0.01;
      const trendUp = idx % 10 < 7; // deterministic 70 % up, 30 % down
      return { ...c, healthScore, openItems, overdueItems, daysSinceContact, revenue, trendUp };
    });
  }, [clients]);

  // ── Aggregate metrics ────────────────────────────────────────────────
  const totalAUM = useMemo(
    () => scoredClients.reduce((s, c) => s + Number(c.aum), 0),
    [scoredClients]
  );
  const avgAUM = clients.length > 0 ? totalAUM / clients.length : 0;
  const estimatedRevenue = totalAUM * 0.01;
  const clientsAtRisk = scoredClients.filter((c) => c.healthScore.total < 50);
  const totalOpenItems = scoredClients.reduce((s, c) => s + c.openItems, 0);
  const totalOverdueItems = scoredClients.reduce((s, c) => s + c.overdueItems, 0);
  const avgHealth = scoredClients.length > 0
    ? Math.round(scoredClients.reduce((s, c) => s + c.healthScore.total, 0) / scoredClients.length)
    : 0;

  // ── Mock AUM trend (12 months) ───────────────────────────────────────
  const aumTrendData = useMemo(() => {
    const now = new Date();
    const startAUM = totalAUM * 0.92;
    const pts = Array.from({ length: 12 }, (_, i) => {
      const mo = subMonths(now, 11 - i);
      const progress = i / 11;
      const base = startAUM + (totalAUM - startAUM) * progress;
      const wiggle = 1 + Math.sin(i * 1.3 + 0.5) * 0.018;
      return { month: format(mo, 'MMM yy'), aum: Math.round(base * wiggle) };
    });
    pts[pts.length - 1].aum = totalAUM; // pin last point to actual value
    return pts;
  }, [totalAUM]);

  // ── Health distribution ──────────────────────────────────────────────
  const healthDistData = useMemo(() =>
    [
      {
        name: 'On Track (75–100)',
        value: scoredClients.filter((c) => c.healthScore.total >= 75).length,
        fill: '#22c55e',
      },
      {
        name: 'Needs Attention (50–74)',
        value: scoredClients.filter(
          (c) => c.healthScore.total >= 50 && c.healthScore.total < 75
        ).length,
        fill: '#f59e0b',
      },
      {
        name: 'Critical (<50)',
        value: scoredClients.filter((c) => c.healthScore.total < 50).length,
        fill: '#ef4444',
      },
    ].filter((d) => d.value > 0),
    [scoredClients]
  );

  // ── Mock action item trend (6 months) ───────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const actionItemTrendData = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => {
      const mo = subMonths(now, 5 - i);
      const open = Math.max(4, 28 - i * 2 + Math.round(Math.sin(i * 0.9) * 3));
      const completed = 12 + i * 3 + Math.round(Math.cos(i * 0.6) * 2);
      return { month: format(mo, 'MMM'), open, completed };
    });
  }, []); // static mock — intentionally empty deps

  // ── Insights ─────────────────────────────────────────────────────────
  const topClient = useMemo(
    () => [...scoredClients].sort((a, b) => b.aum - a.aum)[0] ?? null,
    [scoredClients]
  );
  const topClientPct = topClient && totalAUM > 0 ? (topClient.aum / totalAUM) * 100 : 0;
  const revenueAtRisk = clientsAtRisk.reduce((s, c) => s + c.revenue, 0);
  const avgDaysSinceContact = scoredClients.length > 0
    ? Math.round(scoredClients.reduce((s, c) => s + c.daysSinceContact, 0) / scoredClients.length)
    : 0;

  // ── Cross-book intelligence ───────────────────────────────────────────────
  const crossBook = useMemo(() => analyseBook(clients), [clients]);

  // ── Table state ───────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('aum');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const filteredClients = useMemo(() => {
    let result = scoredClients;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => c.name.toLowerCase().includes(q));
    }
    return [...result].sort((a, b) => {
      let diff = 0;
      switch (sortKey) {
        case 'aum':         diff = a.aum - b.aum; break;
        case 'health':      diff = a.healthScore.total - b.healthScore.total; break;
        case 'lastContact': diff = a.daysSinceContact - b.daysSinceContact; break;
        case 'openItems':   diff = a.openItems - b.openItems; break;
        case 'revenue':     diff = a.revenue - b.revenue; break;
      }
      return sortDir === 'desc' ? -diff : diff;
    });
  }, [scoredClients, search, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortKey(key); setSortDir('desc'); }
  }

  function getInitials(name: string) {
    return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">My Practice</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Business intelligence overview — {format(new Date(), 'MMMM d, yyyy')}
        </p>
      </div>

      <Tabs defaultValue="bookofwork">
        <TabsList className="mb-2">
          <TabsTrigger value="overview">Book Overview</TabsTrigger>
          <TabsTrigger value="intelligence">Cross-Book Intelligence</TabsTrigger>
          <TabsTrigger value="bookofwork">Book of Work</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Book Overview ─────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-6 mt-0">

      {/* ── Section 1: Headline Metrics ─────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <PracticeMetricCard
          label="Total AUM"
          value={fmtCompact(totalAUM)}
          icon={<TrendingUp size={18} className="text-blue-600" />}
          sub={
            <span className="flex items-center gap-1 text-emerald-600 text-xs">
              <ArrowUpRight size={12} />
              {`+2.3% vs last month (${fmtCompact(totalAUM / 1.023)})`}
            </span>
          }
        />

        <PracticeMetricCard
          label="Average AUM per Client"
          value={fmtCompact(avgAUM)}
          icon={<Users size={18} className="text-blue-600" />}
          sub={
            <span className="text-xs text-gray-400">
              Across {clients.length} clients
            </span>
          }
        />

        <PracticeMetricCard
          label="Total Clients"
          value={clients.length.toString()}
          icon={<Users size={18} className="text-blue-600" />}
          sub={
            <span className="flex items-center gap-1.5 text-xs">
              <span className="bg-emerald-100 text-emerald-700 text-xs font-semibold px-1.5 py-0.5 rounded-full">
                +1 new this month
              </span>
            </span>
          }
        />

        <PracticeMetricCard
          label="Clients at Risk"
          value={clientsAtRisk.length.toString()}
          valueClass="text-red-600"
          icon={<AlertTriangle size={18} className="text-red-500" />}
          sub={
            <span className="text-xs text-red-400">Health score below 50</span>
          }
        />

        <PracticeMetricCard
          label="Open Action Items"
          value={totalOpenItems.toString()}
          icon={<ClipboardList size={18} className="text-amber-600" />}
          sub={
            <span className="text-xs text-red-500">
              {totalOverdueItems} overdue
            </span>
          }
        />

        <PracticeMetricCard
          label="Est. Annual Revenue"
          value={fmtCompact(estimatedRevenue)}
          icon={<Briefcase size={18} className="text-blue-600" />}
          sub={
            <span className="text-xs text-gray-400">
              Based on 1% advisory fee estimate
            </span>
          }
        />
      </div>

      {/* ── Section 2: Charts ───────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-5">
        {/* Chart 1: AUM Trend */}
        <Card className="border-gray-200">
          <CardContent className="p-4 pb-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              AUM under management — 12 months
            </div>
            <div className="text-2xl font-bold text-blue-700 mb-3">
              {fmtCompact(totalAUM)}
            </div>
            <ResponsiveContainer width="100%" height={150}>
              <AreaChart
                data={aumTrendData}
                margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="practiceAumGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  interval={2}
                />
                <YAxis
                  tick={{ fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  width={46}
                  tickFormatter={(v: number) => `$${(v / 1_000_000).toFixed(1)}M`}
                />
                <RechartsTooltip
                  formatter={(v: number) => [fmtUSD(v), 'AUM']}
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 6,
                    border: '1px solid #e5e7eb',
                  }}
                  labelStyle={{ fontWeight: 600 }}
                />
                <Area
                  type="monotone"
                  dataKey="aum"
                  name="AUM"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#practiceAumGrad)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Chart 2: Health Distribution Donut */}
        <Card className="border-gray-200">
          <CardContent className="p-4 pb-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Client health distribution
            </div>
            <ResponsiveContainer width="100%" height={190}>
              <PieChart>
                <Pie
                  data={healthDistData}
                  cx="50%"
                  cy="45%"
                  innerRadius={50}
                  outerRadius={74}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {healthDistData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <RechartsTooltip
                  formatter={(v: number, name: string) => [`${v} clients`, name]}
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 6,
                    border: '1px solid #e5e7eb',
                  }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value: string) => (
                    <span style={{ fontSize: 10, color: '#6b7280' }}>{value}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Chart 3: Action Items Trend */}
        <Card className="border-gray-200">
          <CardContent className="p-4 pb-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Action items — 6 month trend
            </div>
            <ResponsiveContainer width="100%" height={190}>
              <BarChart
                data={actionItemTrendData}
                margin={{ top: 8, right: 4, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={24}
                />
                <RechartsTooltip
                  contentStyle={{
                    fontSize: 11,
                    borderRadius: 6,
                    border: '1px solid #e5e7eb',
                  }}
                />
                <Legend
                  iconType="square"
                  iconSize={8}
                  formatter={(value: string) => (
                    <span style={{ fontSize: 10, color: '#6b7280' }}>{value}</span>
                  )}
                />
                <Bar
                  dataKey="completed"
                  name="Completed"
                  fill="#22c55e"
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  dataKey="open"
                  name="Open"
                  fill="#f59e0b"
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* ── Section 3: Client Breakdown Table ───────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-900">
            Client Breakdown
            <span className="ml-2 text-xs font-normal text-gray-400">
              ({filteredClients.length} of {clients.length} clients)
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <Input
                placeholder="Search clients…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs w-48"
              />
            </div>
            <Select
              value={sortKey}
              onValueChange={(v) => {
                setSortKey(v as SortKey);
                setSortDir('desc');
              }}
            >
              <SelectTrigger className="h-8 text-xs w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aum">Sort: AUM</SelectItem>
                <SelectItem value="health">Sort: Health Score</SelectItem>
                <SelectItem value="lastContact">Sort: Last Contact</SelectItem>
                <SelectItem value="openItems">Sort: Open Items</SelectItem>
                <SelectItem value="revenue">Sort: Revenue</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Client
                </th>
                <SortableHeader
                  label="AUM"
                  col="aum"
                  sortKey={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                />
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">
                  % of Book
                </th>
                <SortableHeader
                  label="Health"
                  col="health"
                  sortKey={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Last Contact"
                  col="lastContact"
                  sortKey={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Open Items"
                  col="openItems"
                  sortKey={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                />
                <SortableHeader
                  label="Est. Revenue"
                  col="revenue"
                  sortKey={sortKey}
                  dir={sortDir}
                  onSort={handleSort}
                />
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Trend
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredClients.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/clients/${c.id}`)}
                  className="bg-white hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  {/* Name */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="h-7 w-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                        {getInitials(c.name)}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900 text-sm leading-tight">
                          {c.name}
                        </div>
                        <div className="text-xs text-gray-400">{c.riskProfile}</div>
                      </div>
                    </div>
                  </td>

                  {/* AUM */}
                  <td className="px-4 py-3 font-semibold text-gray-800 tabular-nums text-sm">
                    {fmtCompact(c.aum)}
                  </td>

                  {/* % of Book */}
                  <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">
                    {totalAUM > 0 ? fmtPct((c.aum / totalAUM) * 100) : '—'}
                  </td>

                  {/* Health */}
                  <td className="px-4 py-3">
                    <HealthBadge
                      score={c.healthScore.total}
                      color={c.healthScore.color}
                      size="sm"
                    />
                  </td>

                  {/* Last Contact */}
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {c.daysSinceContact}d ago
                  </td>

                  {/* Open Items */}
                  <td className="px-4 py-3">
                    <span
                      className={`text-sm font-medium ${
                        c.openItems > 0 ? 'text-amber-600' : 'text-gray-400'
                      }`}
                    >
                      {c.openItems}
                    </span>
                  </td>

                  {/* Est. Revenue */}
                  <td className="px-4 py-3 text-sm text-gray-700 tabular-nums">
                    {fmtCompact(c.revenue)}
                  </td>

                  {/* Trend */}
                  <td className="px-4 py-3">
                    {c.trendUp ? (
                      <span className="flex items-center gap-0.5 text-emerald-600 text-xs font-medium">
                        <ArrowUpRight size={13} /> Up
                      </span>
                    ) : (
                      <span className="flex items-center gap-0.5 text-red-500 text-xs font-medium">
                        <ArrowDownRight size={13} /> Down
                      </span>
                    )}
                  </td>
                </tr>
              ))}

              {/* Summary / totals row */}
              <tr className="bg-gray-50 border-t-2 border-gray-200">
                <td className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Totals / Averages
                </td>
                <td className="px-4 py-3 text-sm font-bold text-gray-900 tabular-nums">
                  {fmtCompact(totalAUM)}
                </td>
                <td className="px-4 py-3 text-sm font-semibold text-gray-500">100%</td>
                <td className="px-4 py-3 text-sm font-semibold text-gray-700">
                  Avg {avgHealth}
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">—</td>
                <td className="px-4 py-3 text-sm font-bold text-gray-900">
                  {totalOpenItems}
                </td>
                <td className="px-4 py-3 text-sm font-bold text-gray-900 tabular-nums">
                  {fmtCompact(estimatedRevenue)}
                </td>
                <td className="px-4 py-3 text-xs text-gray-400">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Section 4: Insights Strip ────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Practice Insights</h2>
        <div className="grid grid-cols-3 gap-4">
          <InsightCard
            icon={<Info size={15} className="text-blue-500" />}
            title="Concentration Risk"
            text={
              topClient
                ? `Your top client (${topClient.name}) represents ${fmtPct(topClientPct)} of total AUM. Consider whether this concentration aligns with your business risk tolerance.`
                : 'No clients in book yet.'
            }
          />
          <InsightCard
            icon={<AlertTriangle size={15} className="text-amber-500" />}
            title="Revenue at Risk"
            text={
              clientsAtRisk.length > 0
                ? `Clients with critical health scores represent ${fmtCompact(revenueAtRisk)} in estimated annual revenue. Addressing these relationships is your highest-value activity.`
                : 'No clients currently in the critical health band.'
            }
          />
          <InsightCard
            icon={<Users size={15} className="text-blue-500" />}
            title="Engagement Gap"
            text={`Average days since last client contact: ${avgDaysSinceContact} days. Industry best practice is 30 days for active clients.`}
          />
        </div>
      </div>

        </TabsContent>{/* end Book Overview tab */}

        {/* ── Tab 2: Cross-Book Intelligence ──────────────────────────── */}
        <TabsContent value="intelligence" className="mt-0">
          <p className="text-sm text-gray-500 mb-5">
            Patterns across your full client book — invisible at the individual level.
          </p>

          <PatternDiscoveryCard clients={clients} />

          <div className="space-y-4 mt-4">

            {/* 1. Cash Concentration */}
            <CrossBookCard
              severity={crossBook.cashConcentration.severity}
              icon={<DollarSign size={15} />}
              headline={crossBook.cashConcentration.headline}
              detail={crossBook.cashConcentration.supportingDetail}
              bullets={
                crossBook.cashConcentration.topClients.length > 0
                  ? crossBook.cashConcentration.topClients.map(
                      (c) => `${c.name}: ${c.cashPct.toFixed(0)}% cash (${fmtCompact(c.cashAmount)})`
                    )
                  : []
              }
              linkTo={
                crossBook.cashConcentration.affectedClientIds.length > 0
                  ? `/clients?clientIds=${crossBook.cashConcentration.affectedClientIds.join(',')}`
                  : '/clients?sort=aum'
              }
              linkLabel="View affected clients"
              onNavigate={navigate}
            />

            {/* 2. Contact Gaps */}
            <CrossBookCard
              severity={crossBook.contactGaps.severity}
              icon={<Users size={15} />}
              headline={crossBook.contactGaps.headline}
              detail={crossBook.contactGaps.supportingDetail}
              bullets={crossBook.contactGaps.tiers.map(
                (t) => `${t.tier} (${t.clientCount} clients): ${t.avgDaysSinceContact}d avg${t.flagged ? ' ⚠️' : ''}`
              )}
              linkTo={
                crossBook.contactGaps.affectedClientIds.length > 0
                  ? `/clients?clientIds=${crossBook.contactGaps.affectedClientIds.join(',')}`
                  : '/clients?sort=lastContact'
              }
              linkLabel="View affected clients"
              onNavigate={navigate}
            />

            {/* 3. Household Engagement Gap */}
            <CrossBookCard
              severity={crossBook.householdGap.severity}
              icon={<Home size={15} />}
              headline={crossBook.householdGap.headline}
              detail={crossBook.householdGap.supportingDetail}
              bullets={crossBook.householdGap.topClients.map(
                (c) => `${c.name}: HH score ${c.householdScore}/100 · ${fmtCompact(c.aum)} AUM`
              )}
              linkTo={
                crossBook.householdGap.affectedClientIds.length > 0
                  ? `/clients?clientIds=${crossBook.householdGap.affectedClientIds.join(',')}`
                  : '/clients'
              }
              linkLabel="View affected clients"
              onNavigate={navigate}
            />

            {/* 4. Estate Document Overdue */}
            <CrossBookCard
              severity={crossBook.estateOverdue.severity}
              icon={<FileWarning size={15} />}
              headline={crossBook.estateOverdue.headline}
              detail={crossBook.estateOverdue.supportingDetail}
              bullets={crossBook.estateOverdue.byDocumentType.slice(0, 4).map(
                (d) => `${d.documentName}: ${d.overdueCount} client${d.overdueCount > 1 ? 's' : ''}`
              )}
              linkTo={
                crossBook.estateOverdue.affectedClientIds.length > 0
                  ? `/clients?clientIds=${crossBook.estateOverdue.affectedClientIds.join(',')}`
                  : '/clients'
              }
              linkLabel="View affected clients"
              onNavigate={navigate}
            />

            {/* 5. Action Item Age */}
            <CrossBookCard
              severity={crossBook.actionItemAge.severity}
              icon={<Clock size={15} />}
              headline={crossBook.actionItemAge.headline}
              detail={crossBook.actionItemAge.supportingDetail}
              bullets={crossBook.actionItemAge.topClients.map(
                (c) => `${c.name}: ${c.overdueCount} item${c.overdueCount > 1 ? 's' : ''} overdue 30+ days`
              )}
              linkTo={
                crossBook.actionItemAge.affectedClientIds.length > 0
                  ? `/clients?clientIds=${crossBook.actionItemAge.affectedClientIds.join(',')}`
                  : '/clients?sort=openItems'
              }
              linkLabel="View affected clients"
              onNavigate={navigate}
            />

            {/* 6. NBA Score Distribution */}
            <CrossBookCard
              severity={crossBook.nbaDistribution.severity}
              icon={<BarChart3 size={15} />}
              headline={crossBook.nbaDistribution.headline}
              detail={crossBook.nbaDistribution.supportingDetail}
              bullets={[crossBook.nbaDistribution.dominantDriverDescription]}
              linkTo={
                crossBook.nbaDistribution.affectedClientIds.length > 0
                  ? `/clients?clientIds=${crossBook.nbaDistribution.affectedClientIds.join(',')}`
                  : '/clients?health=attention'
              }
              linkLabel="View affected clients"
              onNavigate={navigate}
              chart={
                <div className="mt-2">
                  <ResponsiveContainer width="100%" height={90}>
                    <PieChart>
                      <Pie
                        data={crossBook.nbaDistribution.bands}
                        cx="50%"
                        cy="50%"
                        innerRadius={28}
                        outerRadius={42}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {crossBook.nbaDistribution.bands.map((b, i) => (
                          <Cell key={i} fill={b.fill} />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        formatter={(v: number, name: string) => [`${v} clients`, name]}
                        contentStyle={{ fontSize: 10, borderRadius: 6, border: '1px solid #e5e7eb' }}
                      />
                      <Legend
                        iconType="circle"
                        iconSize={6}
                        formatter={(value: string) => (
                          <span style={{ fontSize: 9, color: '#6b7280' }}>{value}</span>
                        )}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              }
            />

          </div>
        </TabsContent>{/* end Cross-Book Intelligence tab */}

        {/* ── Tab 3: Book of Work ─────────────────────────────────── */}
        <TabsContent value="bookofwork" className="mt-0">
          <p className="text-sm text-gray-500 mb-5">
            AdvisorIQ analyzes the advisor's entire book and turns fragmented client information into a prioritized Book of Work — identifying which relationships need attention, why, and what opportunity or risk may be behind them.
          </p>
          <BookOfWorkCard clients={clients} />
        </TabsContent>

      </Tabs>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function PracticeMetricCard({
  label,
  value,
  valueClass,
  icon,
  sub,
}: {
  label: string;
  value: string;
  valueClass?: string;
  icon: ReactNode;
  sub: ReactNode;
}) {
  return (
    <Card className="border-gray-200">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-xs text-gray-500 font-medium leading-tight">{label}</span>
        </div>
        <div className={`text-2xl font-bold ${valueClass ?? 'text-gray-900'}`}>{value}</div>
        <div className="mt-1">{sub}</div>
      </CardContent>
    </Card>
  );
}

function SortableHeader({
  label,
  col,
  sortKey,
  dir,
  onSort,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  dir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
}) {
  const isActive = col === sortKey;
  return (
    <th
      className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-700 select-none whitespace-nowrap"
      onClick={() => onSort(col)}
    >
      {label}
      {isActive && (
        <span className="ml-1 text-blue-500">{dir === 'desc' ? '↓' : '↑'}</span>
      )}
    </th>
  );
}

function InsightCard({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="flex gap-3 p-4 rounded-lg bg-blue-50/60 border border-blue-100">
      <div className="mt-0.5 flex-shrink-0">{icon}</div>
      <div>
        <div className="text-xs font-semibold text-gray-800 mb-1">{title}</div>
        <p className="text-xs text-gray-500 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

// ─── Cross-Book Intelligence Card ─────────────────────────────────────────────

const SEVERITY_ACCENT: Record<InsightSeverity, string> = {
  high:   'bg-red-500',
  medium: 'bg-amber-400',
  info:   'bg-teal-400',
};

const SEVERITY_ICON_COLOR: Record<InsightSeverity, string> = {
  high:   'text-red-500',
  medium: 'text-amber-500',
  info:   'text-teal-500',
};

const SEVERITY_BG: Record<InsightSeverity, string> = {
  high:   'bg-red-50/40',
  medium: 'bg-amber-50/30',
  info:   'bg-teal-50/20',
};

const SEVERITY_LABEL: Record<InsightSeverity, string> = {
  high:   'HIGH',
  medium: 'MEDIUM',
  info:   'INFO',
};

const SEVERITY_LABEL_STYLE: Record<InsightSeverity, string> = {
  high:   'bg-red-100 text-red-700 border border-red-200',
  medium: 'bg-amber-100 text-amber-700 border border-amber-200',
  info:   'bg-teal-100 text-teal-700 border border-teal-200',
};

function CrossBookCard({
  severity,
  icon,
  headline,
  detail,
  bullets,
  linkTo,
  linkLabel,
  onNavigate,
  chart,
}: {
  severity: InsightSeverity;
  icon: ReactNode;
  headline: string;
  detail: string;
  bullets: string[];
  linkTo: string;
  linkLabel: string;
  onNavigate: (path: string) => void;
  chart?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden flex">
      {/* Left accent bar */}
      <div className={`w-1.5 flex-shrink-0 ${SEVERITY_ACCENT[severity]}`} />

      {/* Card body */}
      <div className={`flex-1 p-4 ${SEVERITY_BG[severity]}`}>
        {/* Header row */}
        <div className="flex items-start gap-2 mb-2">
          <span className={`mt-0.5 flex-shrink-0 ${SEVERITY_ICON_COLOR[severity]}`}>
            {icon}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${SEVERITY_LABEL_STYLE[severity]}`}
              >
                {SEVERITY_LABEL[severity]}
              </span>
            </div>
            <p className="text-xs font-semibold text-gray-800 leading-snug">{headline}</p>
          </div>
        </div>

        {/* Supporting detail */}
        <p className="text-xs text-gray-500 leading-relaxed mb-2">{detail}</p>

        {/* Bullet list of specific findings */}
        {bullets.length > 0 && (
          <ul className="space-y-0.5 mb-3">
            {bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-gray-600">
                <span className="text-gray-300 flex-shrink-0 mt-0.5">›</span>
                <span className="leading-relaxed">{b}</span>
              </li>
            ))}
          </ul>
        )}

        {/* Optional embedded chart */}
        {chart}

        {/* Footer action */}
        <button
          onClick={() => onNavigate(linkTo)}
          className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors mt-1"
        >
          {linkLabel}
          <ChevronRight size={11} />
        </button>
      </div>
    </div>
  );
}
