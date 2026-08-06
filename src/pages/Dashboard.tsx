import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { calculateHealthScore, formatAUM, formatDate } from '@/lib/healthScore';
import { HealthBadge } from '@/components/ui/HealthBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, TriangleAlert as AlertTriangle, Calendar, SquareCheck as CheckSquare, ArrowRight, Clock, Gift, Bell, ChevronRight, Sparkles, FileText, TrendingDown, Zap, Phone, TrendingUp, Target } from 'lucide-react';
import { differenceInDays, parseISO, format, isToday, isTomorrow, startOfWeek, endOfWeek } from 'date-fns';
import type { Client, NewsItem } from '@/types';
import { NewsDraftModal } from '@/components/feed/NewsDraftModal';
import { calculateNBAScore } from '@/lib/nbaEngine';
import type { NBAScore, NBAUrgencyLevel, NBAActionCategory } from '@/lib/nbaEngine';

const NEWS_CATEGORY_COLORS: Record<string, string> = {
  Fed: 'bg-blue-50 text-blue-700 border-blue-200',
  Markets: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Tax: 'bg-orange-50 text-orange-700 border-orange-200',
  Sector: 'bg-gray-100 text-gray-700 border-gray-200',
  Regulation: 'bg-red-50 text-red-700 border-red-200',
};

export function Dashboard() {
  const navigate = useNavigate();
  const clients = useAppStore((s) => s.clients);
  useEffect(() => { document.title = 'AdvisorIQ — Dashboard'; }, []);
  const news = useAppStore((s) => s.news);
  const [draftModal, setDraftModal] = useState<{ newsItem: NewsItem; clientId: string } | null>(null);

  const scoredClients = useMemo(
    () =>
      clients.map((c) => {
        const healthScore = calculateHealthScore(c);
        const aumMultiplier = c.aum >= 1_000_000 ? 1.5 : c.aum >= 500_000 ? 1.2 : 1.0;
        const priorityScore = (100 - healthScore.total) * aumMultiplier;
        const nbaScore = calculateNBAScore(c);
        return { ...c, healthScore, priorityScore, nbaScore };
      }).sort((a, b) => a.healthScore.total - b.healthScore.total),
    [clients]
  );

  // NBA queue: nba_scenario_flag cases first, then by days since last contact descending.
  // (nba_score is null until the signal engine runs; this interim sort surfaces
  //  injected test scenarios at the top and longest-silent clients below them.)
  const nbaSortedClients = useMemo(() => {
    const now = new Date();
    return [...scoredClients].sort((a, b) => {
      const aFlag = a.nbaData?.scenarioFlag ? 1 : 0;
      const bFlag = b.nbaData?.scenarioFlag ? 1 : 0;
      if (bFlag !== aFlag) return bFlag - aFlag;                        // scenario-flagged first
      const aDays = differenceInDays(now, parseISO(a.lastContact));
      const bDays = differenceInDays(now, parseISO(b.lastContact));
      return bDays - aDays;                                             // most-silent first
    });
  }, [scoredClients]);

  const needsAttention = scoredClients
    .filter((c) => c.healthScore.total < 75)
    .sort((a, b) => b.priorityScore - a.priorityScore);
  const totalOpenItems = clients.flatMap((c) =>
    c.history.flatMap((h) => h.actionItems.filter((ai) => !ai.completed))
  ).length;

  // Use proper Monday–Sunday calendar week
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });
  const thisWeekMeetings = clients.flatMap((c) =>
    c.upcomingMeetings.filter((m) => {
      const d = parseISO(m.date);
      return d >= weekStart && d <= weekEnd;
    })
  );

  const today = new Date();
  const upcomingAllMeetings = clients.flatMap((c) =>
    c.upcomingMeetings
      .filter((m) => {
        const d = parseISO(m.date);
        return d >= weekStart && d <= weekEnd;
      })
      .map((m) => ({ ...m, client: c }))
  ).sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime());

  const birthdaysThisWeek = clients.filter((c) => {
    if (!c.birthday) return false;
    const bday = parseISO(c.birthday);
    const thisYear = new Date(today.getFullYear(), bday.getMonth(), bday.getDate());
    return differenceInDays(thisYear, today) >= 0 && differenceInDays(thisYear, today) <= 7;
  });

  const longOverdueClients = clients.filter((c) => {
    return differenceInDays(today, parseISO(c.lastContact)) >= 60;
  });

  const sortedNews = [...news].sort((a, b) => {
    const dateSort = parseISO(b.date).getTime() - parseISO(a.date).getTime();
    if (dateSort !== 0) return dateSort;
    return b.affectedClientIds.length - a.affectedClientIds.length;
  });

  const urgencyReason = (c: Client & { healthScore: ReturnType<typeof calculateHealthScore> }) => {
    const days = differenceInDays(today, parseISO(c.lastContact));
    if (days >= 90) return `No contact in ${days} days`;
    const drift = Math.max(...c.allocation.map((a) => Math.abs(a.current - a.target)));
    if (drift >= 7) return `Portfolio drifted ${drift.toFixed(0)}pts from target`;
    const overdue = c.history.flatMap((h) =>
      h.actionItems.filter((ai) => !ai.completed && differenceInDays(today, parseISO(ai.dueDate)) > 0)
    ).length;
    if (overdue >= 2) return `${overdue} overdue action items`;
    if (!c.goals.every((g) => g.onTrack)) return 'Goals falling behind';
    return 'Needs attention';
  };

  return (
    <div className="p-6 space-y-6">
      {/* Metrics Strip */}
      <div className="space-y-2">
      <div className="flex justify-end">
        <button
          onClick={() => navigate('/practice')}
          className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium transition-colors"
        >
          View practice summary
          <ArrowRight size={12} />
        </button>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <MetricCard
          icon={<Users size={18} className="text-blue-600" />}
          label="Clients Under Management"
          value={clients.length.toString()}
          sub="Total relationships"
          onClick={() => navigate('/clients')}
        />
        <MetricCard
          icon={<AlertTriangle size={18} className="text-amber-600" />}
          label="Need Attention Today"
          value={needsAttention.length.toString()}
          sub="Health score below 75"
          accent="amber"
          onClick={() => navigate('/clients?health=attention')}
        />
        <MetricCard
          icon={<Calendar size={18} className="text-blue-600" />}
          label="Meetings This Week"
          value={thisWeekMeetings.length.toString()}
          sub="Mon – Sun calendar week"
          onClick={() => navigate('/clients?meetings=thisWeek')}
        />
        <MetricCard
          icon={<CheckSquare size={18} className="text-red-600" />}
          label="Open Action Items"
          value={totalOpenItems.toString()}
          sub="Across all clients"
          accent="red"
          onClick={() => navigate('/clients?sort=openItems')}
        />
      </div>
      </div>

      {/* Three Column Layout */}
      <div className="grid grid-cols-12 gap-5">
        {/* Left: NBA Queue + Classic Queue */}
        <div className="col-span-4 space-y-5">

          {/* ── Advisor Intelligence Queue (NBA Engine) ── */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                <Zap size={14} className="text-blue-500" />
                Advisor Intelligence Queue
              </h2>
              <span className="text-xs text-gray-400">NBA Engine</span>
            </div>
            <div className="space-y-2">
              {nbaSortedClients.slice(0, 6).map((c) => (
                <NBAClientCard
                  key={c.id}
                  client={c}
                  nbaScore={c.nbaScore}
                  onNavigate={navigate}
                />
              ))}
            </div>
          </div>

          {/* ── Classic Action Queue (hidden — preserved for reference) ── */}
          {false && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Client Action Queue</h2>
              <span className="text-xs text-gray-400 italic">Classic View · {needsAttention.length} clients</span>
            </div>

          {needsAttention.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center">
                <div className="text-emerald-600 font-medium text-sm">All clients on track!</div>
                <div className="text-gray-400 text-xs mt-1">No immediate attention needed.</div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2.5">
              {needsAttention.slice(0, 6).map((c) => (
                <Card
                  key={c.id}
                  className="cursor-pointer hover:shadow-sm transition-shadow border-gray-200"
                  onClick={() => navigate(`/clients/${c.id}`)}
                >
                  <CardContent className="p-3.5">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="font-medium text-sm text-gray-900 leading-tight">{c.name}</div>
                      <HealthBadge score={c.healthScore.total} color={c.healthScore.color} size="sm" />
                    </div>
                    <div className="flex items-start gap-1.5 mb-2.5">
                      <TrendingDown size={11} className="text-amber-500 flex-shrink-0 mt-0.5" />
                      <span className="text-xs text-gray-600 leading-tight">{urgencyReason(c)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">
                        Last: {formatDate(c.lastContact)}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs px-2 py-0"
                        onClick={(e) => { e.stopPropagation(); navigate(`/clients/${c.id}`); }}
                      >
                        View
                        <ChevronRight size={11} className="ml-0.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-blue-600 hover:text-blue-700"
              onClick={() => navigate('/clients')}
            >
              View all clients
              <ArrowRight size={12} className="ml-1" />
            </Button>
          </div>
          )}{/* end classic queue */}

        </div>{/* end left col */}

        {/* Center: Market Pulse */}
        <div className="col-span-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Market Pulse</h2>
            <Button variant="ghost" size="sm" className="text-xs text-blue-600" onClick={() => navigate('/news')}>
              Full feed <ArrowRight size={12} className="ml-1" />
            </Button>
          </div>

          <div className="space-y-3">
            {sortedNews.slice(0, 5).map((item) => (
              <DashboardNewsCard
                key={item.id}
                item={item}
                clients={clients}
                onDraft={(newsItem, clientId) => setDraftModal({ newsItem, clientId })}
              />
            ))}
          </div>
        </div>

        {/* Right: Agenda & Nudges */}
        <div className="col-span-3 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900">Today's Agenda</h2>

          {upcomingAllMeetings.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-6 text-center">
                <Calendar size={20} className="text-gray-300 mx-auto mb-2" />
                <div className="text-gray-400 text-xs">No meetings scheduled this week</div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {upcomingAllMeetings.map((m) => {
                const label = isToday(parseISO(m.date)) ? 'Today' : isTomorrow(parseISO(m.date)) ? 'Tomorrow' : format(parseISO(m.date), 'EEE MMM d');
                return (
                  <Card key={m.id} className="border-gray-200">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-1 mb-1">
                        <span className="text-xs font-semibold text-gray-900 leading-tight">{m.client.name}</span>
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${isToday(parseISO(m.date)) ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{label}</span>
                      </div>
                      <p className="text-xs text-gray-500 mb-2 leading-tight">{m.purpose}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          <Clock size={10} /> {m.time}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs px-2"
                          onClick={() => navigate(`/clients/${m.client.id}?tab=brief`)}
                        >
                          <FileText size={11} className="mr-1" />
                          Brief
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Nudges */}
          <div>
            <h2 className="text-sm font-semibold text-gray-900 mb-2">Relationship Nudges</h2>
            <div className="space-y-2">
              {birthdaysThisWeek.map((c) => (
                <NudgeCard
                  key={c.id}
                  icon={<Gift size={13} className="text-pink-500" />}
                  label={`${c.name}'s birthday`}
                  sub={c.birthday ? format(parseISO(c.birthday), 'MMM d') : ''}
                  onClick={() => navigate(`/clients/${c.id}`)}
                />
              ))}
              {longOverdueClients.slice(0, 3).map((c) => {
                const days = differenceInDays(today, parseISO(c.lastContact));
                return (
                  <NudgeCard
                    key={c.id}
                    icon={<Bell size={13} className="text-amber-500" />}
                    label={`Reach out to ${c.name}`}
                    sub={`${days} days since last contact`}
                    onClick={() => navigate(`/clients/${c.id}`)}
                  />
                );
              })}
              {birthdaysThisWeek.length === 0 && longOverdueClients.length === 0 && (
                <div className="text-xs text-gray-400 py-3 text-center">No nudges today</div>
              )}
            </div>
          </div>

          {/* Financial Calendar */}
          <div>
            <h2 className="text-sm font-semibold text-gray-900 mb-2">Financial Calendar</h2>
            <div className="space-y-1.5">
              <CalendarAlert icon="📋" text="IRA contribution deadline: Apr 15, 2027" />
              <CalendarAlert icon="📅" text="RMD deadline for 70+ clients: Dec 31, 2026" />
              <CalendarAlert icon="💡" text="HSA contribution limit reset: Jan 1, 2027" />
            </div>
          </div>
        </div>
      </div>

      {draftModal && (
        <NewsDraftModal
          newsItem={draftModal.newsItem}
          clientId={draftModal.clientId}
          clients={clients}
          onClose={() => setDraftModal(null)}
        />
      )}
    </div>
  );
}

// ─── NBA Client Card ──────────────────────────────────────────────────────────

const URGENCY_STYLES: Record<NBAUrgencyLevel, string> = {
  Critical: 'bg-red-100 text-red-700',
  High:     'bg-orange-100 text-orange-700',
  Medium:   'bg-amber-100 text-amber-700',
  Low:      'bg-blue-100 text-blue-700',
};

const URGENCY_BORDER: Record<NBAUrgencyLevel, string> = {
  Critical: 'border-l-red-500',
  High:     'border-l-orange-500',
  Medium:   'border-l-amber-500',
  Low:      'border-l-blue-400',
};

const CATEGORY_COLORS: Record<NBAActionCategory, string> = {
  Contact:    'text-blue-600',
  Portfolio:  'text-emerald-600',
  Goals:      'text-amber-600',
  Household:  'text-violet-600',
  Estate:     'text-orange-600',
  Compliance: 'text-red-600',
};

/** Map a signal name to its Lucide icon element with a colour class applied. */
function SignalIcon({ name, score, maxScore }: { name: string; score: number; maxScore: number }) {
  const ratio = score / maxScore;
  const colorClass = ratio >= 0.7 ? 'text-green-500' : ratio >= 0.4 ? 'text-amber-500' : 'text-red-500';
  const label = name === 'Life Events' ? 'Life' : name;

  let icon: React.ReactNode = null;
  const lc = name.toLowerCase();
  if (lc === 'contact')                       icon = <Phone size={16} />;
  else if (lc === 'portfolio')                icon = <TrendingUp size={16} />;
  else if (lc === 'goals')                    icon = <Target size={16} />;
  else if (lc === 'household')                icon = <Users size={16} />;
  else if (lc.includes('life'))               icon = <Calendar size={16} />;

  if (!icon) return null;

  return (
    <div className="flex flex-col items-center gap-0.5" title={`${name}: ${score}/${maxScore}`}>
      <span className={colorClass}>{icon}</span>
      <span className={`text-[9px] ${colorClass}`}>{label}</span>
    </div>
  );
}

function NBAClientCard({
  client,
  nbaScore,
  onNavigate,
}: {
  client: Client;
  nbaScore: NBAScore;
  onNavigate: (path: string) => void;
}) {
  return (
    <Card className={`border-l-2 border-gray-200 hover:shadow-sm transition-shadow ${URGENCY_BORDER[nbaScore.urgencyLevel]}`}>
      <CardContent className="p-3">
        {/* Row 1: Name + Urgency badge */}
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <button
            className="text-sm font-semibold text-gray-900 leading-tight text-left hover:text-blue-600 transition-colors"
            onClick={() => onNavigate(`/clients/${client.id}`)}
          >
            {client.name}
          </button>
          <span
            className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0 ${URGENCY_STYLES[nbaScore.urgencyLevel]}`}
          >
            {nbaScore.urgencyLevel}
          </span>
        </div>

        {/* Row 2: AUM · Health badge · NBA score */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-gray-500">{formatAUM(client.aum)}</span>
          <span className="text-gray-200">·</span>
          <HealthBadge score={(client as Client & { healthScore: ReturnType<typeof calculateHealthScore> }).healthScore?.total ?? 0}
            color={(client as Client & { healthScore: ReturnType<typeof calculateHealthScore> }).healthScore?.color ?? 'green'}
            size="sm"
          />
          <span className="text-gray-200">·</span>
          <span className="text-xs text-gray-400 tabular-nums">
            Score <span className="font-semibold text-gray-600">{nbaScore.totalScore}</span>
          </span>
        </div>

        {/* Row 3: Primary action */}
        <div className={`flex items-start gap-1 mb-2.5 ${CATEGORY_COLORS[nbaScore.actionCategory]}`}>
          <Zap size={10} className="flex-shrink-0 mt-0.5" />
          <span className="text-xs font-medium leading-tight">{nbaScore.primaryAction}</span>
        </div>

        {/* Row 4: Signal icons — 5 icons colour-coded by score ratio */}
        <div className="flex items-start justify-between mb-2.5">
          {nbaScore.scoreBreakdown.map((factor, i) => (
            <SignalIcon
              key={i}
              name={factor.name}
              score={factor.score}
              maxScore={factor.maxScore}
            />
          ))}
        </div>

        {/* Row 5: Action buttons */}
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs px-2 flex-1"
            onClick={() => onNavigate(`/clients/${client.id}?tab=brief`)}
          >
            <Sparkles size={10} className="mr-1" />
            Start Brief
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs px-2"
            onClick={() => onNavigate(`/clients/${client.id}/call`)}
          >
            <Phone size={10} className="mr-1" />
            Call
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Dashboard News Card ──────────────────────────────────────────────────────

function DashboardNewsCard({
  item,
  clients,
  onDraft,
}: {
  item: NewsItem;
  clients: Client[];
  onDraft: (newsItem: NewsItem, clientId: string) => void;
}) {
  const affectedClients = clients.filter((c) => item.affectedClientIds.includes(c.id));
  const [selectedClientId, setSelectedClientId] = useState(affectedClients[0]?.id ?? '');

  function handleDraftClick() {
    const id = affectedClients.length === 1 ? affectedClients[0].id : selectedClientId;
    if (id) onDraft(item, id);
  }

  return (
    <Card className="border-gray-200 hover:shadow-sm transition-shadow">
      <CardContent className="p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${NEWS_CATEGORY_COLORS[item.category] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
              {item.category}
            </span>
            <span className="text-xs text-gray-400">{formatDate(item.date)}</span>
            <span className="text-xs text-gray-400">· {item.source}</span>
          </div>
          <h3 className="text-sm font-semibold text-gray-900 leading-snug mb-1.5">{item.headline}</h3>
          <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{item.summary}</p>

          {affectedClients.length > 0 && (
            <div className="flex items-center gap-2 mt-2.5 flex-wrap">
              <span className="text-xs text-gray-400 flex-shrink-0">Affects:</span>
              {affectedClients.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onDraft(item, c.id)}
                  className="text-xs bg-gray-100 hover:bg-blue-50 hover:text-blue-700 text-gray-600 rounded px-2 py-0.5 transition-colors border border-gray-200 hover:border-blue-200"
                  title={`Draft message for ${c.name}`}
                >
                  {c.name.split(' ')[0]}
                </button>
              ))}
              <div className="ml-auto flex items-center gap-1.5">
                {affectedClients.length > 1 && (
                  <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                    <SelectTrigger className="h-6 text-xs w-32">
                      <SelectValue placeholder="Select client" />
                    </SelectTrigger>
                    <SelectContent>
                      {affectedClients.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <button
                  onClick={handleDraftClick}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  <Sparkles size={11} />
                  Draft message
                </button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricCard({ icon, label, value, sub, accent, onClick }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  accent?: 'amber' | 'red';
  onClick?: () => void;
}) {
  const valueColor = accent === 'amber' ? 'text-amber-700' : accent === 'red' ? 'text-red-700' : 'text-gray-900';
  return (
    <Card
      className={`border-gray-200 transition-colors ${onClick ? 'cursor-pointer hover:bg-gray-50 hover:border-gray-300' : ''}`}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-2">
          {icon}
          <span className="text-xs text-gray-500 font-medium">{label}</span>
        </div>
        <div className={`text-2xl font-bold ${valueColor}`}>{value}</div>
        <div className="text-xs text-gray-400 mt-0.5">{sub}</div>
      </CardContent>
    </Card>
  );
}

function NudgeCard({ icon, label, sub, onClick }: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-start gap-2 p-2.5 rounded-lg border border-gray-200 hover:border-blue-200 hover:bg-blue-50/50 transition-colors"
    >
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <div>
        <div className="text-xs font-medium text-gray-800">{label}</div>
        <div className="text-xs text-gray-400">{sub}</div>
      </div>
    </button>
  );
}

function CalendarAlert({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-start gap-2 text-xs text-gray-600 p-2 rounded-lg bg-gray-50 border border-gray-100">
      <span>{icon}</span>
      <span>{text}</span>
    </div>
  );
}
