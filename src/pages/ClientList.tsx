import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Eye, FileText, Users } from 'lucide-react';
import { differenceInDays, parseISO, isToday, isThisWeek, startOfWeek, endOfWeek } from 'date-fns';
import { formatDistanceToNow } from 'date-fns';
import { useAppStore } from '@/store/appStore';
import { formatAUM } from '@/lib/healthScore';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { RiskProfile } from '@/types';

type ContactFilter = 'all' | 'week' | 'month' | 'over60';
type MeetingFilter = 'all' | 'thisWeek';
type SortKey = 'name' | 'aum' | 'lastContact' | 'openItems';

export function ClientList() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const clients = useAppStore((s) => s.clients);
  useEffect(() => { document.title = 'AdvisorIQ — Clients'; }, []);

  // Cross-Book Intelligence filter: pre-filter to specific client IDs
  const clientIdsParam = searchParams.get('clientIds');
  const filteredByIds = clientIdsParam ? clientIdsParam.split(',') : null;

  // Initialise filters from URL params (set by Dashboard metric card clicks)
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<RiskProfile | 'all'>('all');
  const [contactFilter, setContactFilter] = useState<ContactFilter>('all');
  const [meetingFilter, setMeetingFilter] = useState<MeetingFilter>(
    searchParams.get('meetings') === 'thisWeek' ? 'thisWeek' : 'all'
  );
  const [sortKey, setSortKey] = useState<SortKey>(
    searchParams.get('sort') === 'openItems' ? 'openItems' : 'aum'
  );

  // Sync if URL params change (e.g. navigating from Dashboard again)
  useEffect(() => {
    const m = searchParams.get('meetings');
    if (m === 'thisWeek') setMeetingFilter('thisWeek');
    const s = searchParams.get('sort');
    if (s === 'openItems') setSortKey('openItems');
  }, [searchParams]);

  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(today, { weekStartsOn: 1 });

  const scoredClients = useMemo(
    () => clients.map((c) => {
      const openItems = c.history.flatMap((h) => h.actionItems.filter((ai) => !ai.completed)).length;
      return { ...c, openItems };
    }),
    [clients]
  );

  const filtered = useMemo(() => {
    let result = scoredClients;

    // Cross-Book Intelligence ID filter — applied first
    if (filteredByIds && filteredByIds.length > 0) {
      result = result.filter((c) => filteredByIds.includes(c.id));
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => c.name.toLowerCase().includes(q));
    }

    if (riskFilter !== 'all') result = result.filter((c) => c.riskProfile === riskFilter);

    if (contactFilter === 'week') {
      result = result.filter((c) => differenceInDays(today, parseISO(c.lastContact)) <= 7);
    } else if (contactFilter === 'month') {
      result = result.filter((c) => differenceInDays(today, parseISO(c.lastContact)) <= 30);
    } else if (contactFilter === 'over60') {
      result = result.filter((c) => differenceInDays(today, parseISO(c.lastContact)) > 60);
    }

    if (meetingFilter === 'thisWeek') {
      result = result.filter((c) =>
        c.upcomingMeetings.some((m) => {
          const d = parseISO(m.date);
          return d >= weekStart && d <= weekEnd;
        })
      );
    }

    return [...result].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'aum') return b.aum - a.aum;
      if (sortKey === 'lastContact')
        return parseISO(b.lastContact).getTime() - parseISO(a.lastContact).getTime();
      if (sortKey === 'openItems') return b.openItems - a.openItems;
      return 0;
    });
  }, [scoredClients, search, riskFilter, contactFilter, meetingFilter, sortKey, weekStart, weekEnd, clientIdsParam]);

  function clearFilters() {
    setSearch('');
    setRiskFilter('all');
    setContactFilter('all');
    setMeetingFilter('all');
    setSortKey('aum');
  }

  function getInitials(name: string) {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  function getNextMeetingLabel(client: typeof scoredClients[0]) {
    if (!client.upcomingMeetings.length) return null;
    const sorted = [...client.upcomingMeetings].sort(
      (a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime()
    );
    const next = sorted.find((m) => differenceInDays(parseISO(m.date), today) >= 0);
    if (!next) return null;
    const d = parseISO(next.date);
    if (isToday(d)) return { label: 'Today', cls: 'bg-blue-50 text-blue-700 border-blue-200' };
    if (isThisWeek(d, { weekStartsOn: 1 }))
      return { label: 'This Week', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    return null;
  }

  const hasFilters =
    search.trim() !== '' ||
    riskFilter !== 'all' ||
    contactFilter !== 'all' ||
    meetingFilter !== 'all';

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Clients</h1>
        <p className="text-sm text-gray-500 mt-0.5">{clients.length} total relationships</p>
      </div>

      {/* Cross-Book Intelligence filter banner */}
      {clientIdsParam && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-blue-50 border border-blue-200 text-sm">
          <span className="text-blue-800 font-medium">
            Showing {filtered.length} client{filtered.length !== 1 ? 's' : ''} matching Cross-Book Intelligence filter
          </span>
          <button
            onClick={() => navigate('/clients')}
            className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors flex-shrink-0"
          >
            Clear filter ×
          </button>
        </div>
      )}

      {/* Search + Filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search clients by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select value={riskFilter} onValueChange={(v) => setRiskFilter(v as RiskProfile | 'all')}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue placeholder="Risk Profile" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Risk Profiles</SelectItem>
              <SelectItem value="Conservative">Conservative</SelectItem>
              <SelectItem value="Moderate">Moderate</SelectItem>
              <SelectItem value="Aggressive">Aggressive</SelectItem>
            </SelectContent>
          </Select>

          <Select value={contactFilter} onValueChange={(v) => setContactFilter(v as ContactFilter)}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue placeholder="Last Contact" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Last Contacts</SelectItem>
              <SelectItem value="week">This Week</SelectItem>
              <SelectItem value="month">This Month</SelectItem>
              <SelectItem value="over60">Over 60 Days</SelectItem>
            </SelectContent>
          </Select>

          <Select value={meetingFilter} onValueChange={(v) => setMeetingFilter(v as MeetingFilter)}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue placeholder="Meetings" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Meetings</SelectItem>
              <SelectItem value="thisWeek">Meeting This Week</SelectItem>
            </SelectContent>
          </Select>

          <div className="ml-auto">
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger className="w-48 h-8 text-xs">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Sort: Name</SelectItem>
                <SelectItem value="aum">Sort: AUM</SelectItem>
                <SelectItem value="lastContact">Sort: Last Contact</SelectItem>
                <SelectItem value="openItems">Sort: Open Action Items</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-xs text-gray-500">
          Showing <span className="font-medium text-gray-700">{filtered.length}</span> of{' '}
          <span className="font-medium text-gray-700">{clients.length}</span> clients
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="ml-2 text-blue-600 hover:underline"
            >
              Clear filters
            </button>
          )}
        </p>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users size={36} className="text-gray-200 mb-3" />
          <p className="text-sm font-medium text-gray-600">No clients match your filters</p>
          <p className="text-xs text-gray-400 mt-1 mb-4">Try adjusting your search or filter criteria</p>
          {hasFilters && (
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Client
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  AUM
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Risk
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Last Contact
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Next Meeting
                </th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((client) => {
                const meeting = getNextMeetingLabel(client);
                return (
                  <tr
                    key={client.id}
                    onClick={() => navigate(`/clients/${client.id}`)}
                    className="bg-white hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    {/* Name + initials */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                          {getInitials(client.name)}
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 leading-tight">{client.name}</div>
                          <div className="text-xs text-gray-400">{client.employment}</div>
                        </div>
                      </div>
                    </td>

                    {/* AUM */}
                    <td className="px-4 py-3 font-medium text-gray-800 tabular-nums">
                      {formatAUM(client.aum)}
                    </td>

                    {/* Risk */}
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-600">{client.riskProfile}</span>
                    </td>

                    {/* Last Contact */}
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {formatDistanceToNow(parseISO(client.lastContact), { addSuffix: true })}
                    </td>

                    {/* Next Meeting */}
                    <td className="px-4 py-3">
                      {meeting ? (
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${meeting.cls}`}>
                          {meeting.label}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-gray-400 hover:text-gray-700"
                          title="View Profile"
                          onClick={() => navigate(`/clients/${client.id}`)}
                        >
                          <Eye size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-gray-400 hover:text-blue-600"
                          title="Generate Brief"
                          onClick={() => navigate(`/clients/${client.id}?tab=brief`)}
                        >
                          <FileText size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
