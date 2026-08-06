import { useEffect, useMemo, useState } from 'react';
import { format, isToday, isThisWeek, isThisMonth, parseISO, formatDistanceToNow } from 'date-fns';
import { Newspaper, AlertCircle } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { calculateHealthScore } from '@/lib/healthScore';
import { NewsDraftModal } from '@/components/feed/NewsDraftModal';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import type { NewsItem, Client } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_COLOR: Record<string, string> = {
  Fed: 'bg-blue-50 text-blue-700 border-blue-200',
  Markets: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Tax: 'bg-orange-50 text-orange-700 border-orange-200',
  Sector: 'bg-gray-100 text-gray-600 border-gray-200',
  Regulation: 'bg-red-50 text-red-700 border-red-200',
};

const CATEGORY_DISPLAY: Record<string, string> = {
  Fed: 'Fed & Rates',
  Markets: 'Markets',
  Tax: 'Tax & Regulation',
  Sector: 'Sector News',
  Regulation: 'Regulation',
};

type DateFilter = 'all' | 'today' | 'week' | 'month';
type CategoryFilter = 'all' | string;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function NewsFeed() {
  const news = useAppStore((s) => s.news);
  const clients = useAppStore((s) => s.clients);
  useEffect(() => { document.title = 'AdvisorIQ — News Feed'; }, []);

  const [draftState, setDraftState] = useState<{ newsItem: NewsItem; clientId: string } | null>(null);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Market & News Feed</h1>
        <p className="text-sm text-gray-500 mt-0.5">{format(new Date(), 'EEEE, MMMM d, yyyy')}</p>
      </div>

      <Tabs defaultValue="all">
        <TabsList className="w-full justify-start h-auto p-1">
          <TabsTrigger value="all">All News</TabsTrigger>
          <TabsTrigger value="alerts">Client Alerts</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <AllNewsTab
            news={news}
            clients={clients}
            onDraft={(newsItem, clientId) => setDraftState({ newsItem, clientId })}
          />
        </TabsContent>

        <TabsContent value="alerts" className="mt-4">
          <ClientAlertsTab
            news={news}
            clients={clients}
            onDraft={(newsItem, clientId) => setDraftState({ newsItem, clientId })}
          />
        </TabsContent>
      </Tabs>

      {draftState && (
        <NewsDraftModal
          newsItem={draftState.newsItem}
          clientId={draftState.clientId}
          clients={clients}
          onClose={() => setDraftState(null)}
        />
      )}
    </div>
  );
}

// ─── All News Tab ─────────────────────────────────────────────────────────────

function AllNewsTab({
  news,
  clients,
  onDraft,
}: {
  news: NewsItem[];
  clients: Client[];
  onDraft: (newsItem: NewsItem, clientId: string) => void;
}) {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');

  const filtered = useMemo(() => {
    let result = [...news];

    if (categoryFilter !== 'all') {
      result = result.filter((n) => n.category === categoryFilter);
    }

    if (dateFilter === 'today') result = result.filter((n) => isToday(parseISO(n.date)));
    else if (dateFilter === 'week') result = result.filter((n) => isThisWeek(parseISO(n.date), { weekStartsOn: 1 }));
    else if (dateFilter === 'month') result = result.filter((n) => isThisMonth(parseISO(n.date)));

    return result.sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime());
  }, [news, categoryFilter, dateFilter]);

  const hasFilters = categoryFilter !== 'all' || dateFilter !== 'all';

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-2">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44 h-8 text-xs">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {Object.entries(CATEGORY_DISPLAY).map(([val, label]) => (
              <SelectItem key={val} value={val}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)}>
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue placeholder="All Dates" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Dates</SelectItem>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="week">This Week</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Cards */}
      {filtered.length === 0 ? (
        <EmptyState
          message="No news items match your filters"
          showClear={hasFilters}
          onClear={() => { setCategoryFilter('all'); setDateFilter('all'); }}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((item) => (
            <NewsCard
              key={item.id}
              item={item}
              clients={clients}
              onDraft={onDraft}
              showUrgencyBorder={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Client Alerts Tab ────────────────────────────────────────────────────────

function ClientAlertsTab({
  news,
  clients,
  onDraft,
}: {
  news: NewsItem[];
  clients: Client[];
  onDraft: (newsItem: NewsItem, clientId: string) => void;
}) {
  const scoredClients = useMemo(
    () => new Map(clients.map((c) => [c.id, calculateHealthScore(c)])),
    [clients]
  );

  const alertItems = useMemo(() => {
    return news
      .filter((n) => n.affectedClientIds.length > 0)
      .sort((a, b) => {
        // Items with red-health clients first
        const aHasRed = a.affectedClientIds.some((id) => scoredClients.get(id)?.color === 'red');
        const bHasRed = b.affectedClientIds.some((id) => scoredClients.get(id)?.color === 'red');
        if (aHasRed !== bHasRed) return aHasRed ? -1 : 1;
        return b.affectedClientIds.length - a.affectedClientIds.length;
      });
  }, [news, scoredClients]);

  if (alertItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertCircle size={32} className="text-gray-200 mb-3" />
        <p className="text-sm font-medium text-gray-600">No market events are currently flagged for your clients</p>
        <p className="text-xs text-gray-400 mt-1">Your clients are not directly affected by any tracked news items</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {alertItems.map((item) => {
        const hasRedClient = item.affectedClientIds.some(
          (id) => scoredClients.get(id)?.color === 'red'
        );
        return (
          <div key={item.id} className={hasRedClient ? 'border-l-4 border-l-red-400 rounded-lg' : ''}>
            <NewsCard
              item={item}
              clients={clients}
              onDraft={onDraft}
              showUrgencyBorder={false}
              extraBadge={
                <span className="text-xs font-medium text-gray-600">
                  Affects <span className="font-bold text-gray-900">{item.affectedClientIds.length}</span>{' '}
                  {item.affectedClientIds.length === 1 ? 'client' : 'clients'} in your book
                </span>
              }
            />
          </div>
        );
      })}
    </div>
  );
}

// ─── News Card ────────────────────────────────────────────────────────────────

function NewsCard({
  item,
  clients,
  onDraft,
  showUrgencyBorder,
  extraBadge,
}: {
  item: NewsItem;
  clients: Client[];
  onDraft: (newsItem: NewsItem, clientId: string) => void;
  showUrgencyBorder: boolean;
  extraBadge?: React.ReactNode;
}) {
  const affectedClients = clients.filter((c) => item.affectedClientIds.includes(c.id));
  // Per-card client selection state for multi-client draft picker
  const [selectedClientId, setSelectedClientId] = useState(affectedClients[0]?.id ?? '');

  function handleDraftClick() {
    if (affectedClients.length === 1) {
      onDraft(item, affectedClients[0].id);
    } else if (affectedClients.length > 1 && selectedClientId) {
      onDraft(item, selectedClientId);
    }
  }

  return (
    <Card className={`border-gray-200 hover:shadow-sm transition-shadow ${showUrgencyBorder ? 'border-l-4 border-l-red-400' : ''}`}>
      <CardContent className="p-4 space-y-3">
        {/* Top row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${CATEGORY_COLOR[item.category] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
            {CATEGORY_DISPLAY[item.category] ?? item.category}
          </span>
          <span className="text-xs text-gray-400">{formatDistanceToNow(parseISO(item.date), { addSuffix: true })}</span>
          <span className="text-xs text-gray-400">· {item.source}</span>
          {extraBadge && <span className="ml-auto">{extraBadge}</span>}
        </div>

        {/* Headline + Summary */}
        <div>
          <h3 className="text-sm font-semibold text-gray-900 leading-snug mb-1">{item.headline}</h3>
          <p className="text-xs text-gray-500 leading-relaxed line-clamp-3">{item.summary}</p>
        </div>

        {/* Clients Affected */}
        <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-gray-100">
          <span className="text-xs text-gray-400 flex-shrink-0">Clients affected:</span>
          {affectedClients.length === 0 ? (
            <span className="text-xs text-gray-300">No clients directly affected</span>
          ) : (
            <TooltipProvider>
              <div className="flex items-center gap-1.5 flex-wrap flex-1">
                {affectedClients.map((c) => (
                  <Tooltip key={c.id}>
                    <TooltipTrigger asChild>
                      <div className="h-7 w-7 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold flex items-center justify-center cursor-default flex-shrink-0">
                        {getInitials(c.name)}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>{c.name}</TooltipContent>
                  </Tooltip>
                ))}

                {/* Draft controls */}
                <div className="ml-auto flex items-center gap-2">
                  {affectedClients.length > 1 && (
                    <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                      <SelectTrigger className="h-7 text-xs w-36">
                        <SelectValue placeholder="Select client" />
                      </SelectTrigger>
                      <SelectContent>
                        {affectedClients.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={handleDraftClick}
                    disabled={affectedClients.length === 0}
                  >
                    Draft Client Message
                  </Button>
                </div>
              </div>
            </TooltipProvider>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({
  message,
  showClear,
  onClear,
}: {
  message: string;
  showClear: boolean;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Newspaper size={32} className="text-gray-200 mb-3" />
      <p className="text-sm font-medium text-gray-600">{message}</p>
      {showClear && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onClear}>
          Clear filters
        </Button>
      )}
    </div>
  );
}
