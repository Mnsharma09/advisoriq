import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/store/appStore';
import { formatAUM, formatDate } from '@/lib/healthScore';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Users, Calendar, SquareCheck as CheckSquare, ArrowRight, Clock, Gift, Bell,
  Sparkles, FileText, Phone, ListOrdered,
} from 'lucide-react';
import { differenceInDays, parseISO, format, isToday, isTomorrow, startOfWeek, endOfWeek } from 'date-fns';
import type { Client, NewsItem } from '@/types';
import { NewsDraftModal } from '@/components/feed/NewsDraftModal';
import type { BookOfWorkClientResult } from '@/lib/claudeClient';

const NEWS_CATEGORY_COLORS: Record<string, string> = {
  Fed: 'bg-blue-50 text-blue-700 border-blue-200',
  Markets: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Tax: 'bg-orange-50 text-orange-700 border-orange-200',
  Sector: 'bg-gray-100 text-gray-700 border-gray-200',
  Regulation: 'bg-red-50 text-red-700 border-red-200',
};

const ATTRITION_STYLES: Record<string, string> = {
  'dissatisfaction':      'text-red-700 bg-red-50 border-red-200',
  'quiet disengagement':  'text-orange-700 bg-orange-50 border-orange-200',
  'busy but stable':      'text-amber-700 bg-amber-50 border-amber-200',
  'no concern':           'text-emerald-700 bg-emerald-50 border-emerald-200',
};

const WALLET_STYLES: Record<string, string> = {
  strong:   'text-emerald-700 bg-emerald-50 border-emerald-200',
  moderate: 'text-amber-700 bg-amber-50 border-amber-200',
};

export function Dashboard() {
  const navigate = useNavigate();
  const clients = useAppStore((s) => s.clients);
  const bookOfWorkResults = useAppStore((s) => s.bookOfWorkResults);
  useEffect(() => { document.title = 'AdvisorIQ — Dashboard'; }, []);
  const news = useAppStore((s) => s.news);
  const [draftModal, setDraftModal] = useState<{ newsItem: NewsItem; clientId: string } | null>(null);

  const totalOpenItems = clients.flatMap((c) =>
    c.history.flatMap((h) => h.actionItems.filter((ai) => !ai.completed))
  ).length;

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

  const longOverdueClients = clients.filter((c) =>
    differenceInDays(today, parseISO(c.lastContact)) >= 60
  );

  const sortedNews = [...news].sort((a, b) => {
    const dateSort = parseISO(b.date).getTime() - parseISO(a.date).getTime();
    if (dateSort !== 0) return dateSort;
    return b.affectedClientIds.length - a.affectedClientIds.length;
  });

  const priorityCount = bookOfWorkResults !== null
    ? bookOfWorkResults.filter((r) => r.priorityScore >= 30).length
    : null;

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
            icon={<ListOrdered size={18} className="text-amber-600" />}
            label="Priority Clients"
            value={priorityCount !== null ? priorityCount.toString() : '–'}
            sub={priorityCount !== null ? 'Book of Work score ≥ 30' : 'Run Book of Work first'}
            accent={priorityCount !== null && priorityCount > 0 ? 'amber' : undefined}
            onClick={() => navigate('/practice')}
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
        {/* Left: Book of Work Queue */}
        <div className="col-span-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
              <ListOrdered size={14} className="text-blue-500" />
              Book of Work Queue
            </h2>
            <button
              onClick={() => navigate('/practice')}
              className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 transition-colors"
            >
              Run analysis <ArrowRight size={11} />
            </button>
          </div>

          {bookOfWorkResults === null ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center">
                <ListOrdered size={20} className="text-gray-300 mx-auto mb-2" />
                <div className="text-gray-500 font-medium text-sm">No Book of Work run yet</div>
                <div className="text-gray-400 text-xs mt-1 mb-3">
                  Go to My Practice to run the analysis and see your prioritised client queue here.
                </div>
                <Button size="sm" variant="outline" onClick={() => navigate('/practice')}>
                  Go to My Practice
                  <ArrowRight size={12} className="ml-1" />
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {bookOfWorkResults.slice(0, 6).map((result) => (
                <BookOfWorkClientCard key={result.clientId} result={result} onNavigate={navigate} />
              ))}
              {bookOfWorkResults.length > 6 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-blue-600 hover:text-blue-700"
                  onClick={() => navigate('/practice')}
                >
                  View all {bookOfWorkResults.length} results
                  <ArrowRight size={12} className="ml-1" />
                </Button>
              )}
            </div>
          )}
        </div>

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
                const label = isToday(parseISO(m.date))
                  ? 'Today'
                  : isTomorrow(parseISO(m.date))
                  ? 'Tomorrow'
                  : format(parseISO(m.date), 'EEE MMM d');
                return (
                  <Card key={m.id} className="border-gray-200">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-1 mb-1">
                        <span className="text-xs font-semibold text-gray-900 leading-tight">{m.client.name}</span>
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${isToday(parseISO(m.date)) ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                          {label}
                        </span>
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

// ─── Book of Work Client Card ──────────────────────────────────────────────────

function BookOfWorkClientCard({
  result,
  onNavigate,
}: {
  result: BookOfWorkClientResult;
  onNavigate: (path: string) => void;
}) {
  const attrStyle = result.attrition
    ? (ATTRITION_STYLES[result.attrition.riskCategory] ?? 'text-gray-500 bg-gray-50 border-gray-200')
    : null;
  const walletStyle = result.walletCapture && result.walletCapture.opportunitySignal !== 'none'
    ? (WALLET_STYLES[result.walletCapture.opportunitySignal] ?? null)
    : null;

  return (
    <Card className="border-gray-200 hover:shadow-sm transition-shadow">
      <CardContent className="p-3">
        {/* Row 1: rank + name + priority score */}
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <button
            className="text-sm font-semibold text-gray-900 leading-tight text-left hover:text-blue-600 transition-colors"
            onClick={() => onNavigate(`/clients/${result.clientId}`)}
          >
            <span className="text-gray-400 text-xs mr-1.5">#{result.rank}</span>
            {result.clientName}
          </button>
          <span className="text-xs font-bold text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded tabular-nums flex-shrink-0">
            {result.priorityScore}pts
          </span>
        </div>

        {/* Row 2: AUM + signal badges */}
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <span className="text-xs text-gray-400">{formatAUM(result.aum)}</span>
          {attrStyle && (
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${attrStyle}`}>
              {result.attrition!.riskCategory}
            </span>
          )}
          {walletStyle && (
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${walletStyle}`}>
              wallet: {result.walletCapture!.opportunitySignal}
            </span>
          )}
        </div>

        {/* Row 3: Justification */}
        {result.justification && (
          <p className="text-xs text-gray-500 leading-tight line-clamp-2 mb-2">{result.justification}</p>
        )}

        {/* Row 4: Action buttons */}
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs px-2 flex-1"
            onClick={() => onNavigate(`/clients/${result.clientId}?tab=brief`)}
          >
            <Sparkles size={10} className="mr-1" />
            Brief
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-xs px-2"
            onClick={() => onNavigate(`/clients/${result.clientId}/call`)}
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
