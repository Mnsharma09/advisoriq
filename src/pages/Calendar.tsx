import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  format,
  addWeeks,
  subWeeks,
  startOfWeek,
  addDays,
  isSameDay,
  isToday,
  parseISO,
  differenceInDays,
  isBefore,
  startOfDay,
  addMonths,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, FileText, Users } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseHour(timeStr: string): number {
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return 9;
  const hour = parseInt(match[1]);
  const min = parseInt(match[2]);
  const period = match[3].toUpperCase();
  let h = hour;
  if (period === 'PM' && hour !== 12) h += 12;
  if (period === 'AM' && hour === 12) h = 0;
  return h + min / 60;
}

const HOUR_START = 8;
const HOUR_END = 18; // 6 PM
const TOTAL_HOURS = HOUR_END - HOUR_START;
const CELL_HEIGHT = 64; // px per hour

const DAY_COLORS: Record<number, string> = {
  0: 'bg-blue-500',
  1: 'bg-violet-500',
  2: 'bg-emerald-500',
  3: 'bg-amber-500',
  4: 'bg-pink-500',
  5: 'bg-teal-500',
  6: 'bg-orange-500',
  7: 'bg-cyan-500',
  8: 'bg-indigo-500',
  9: 'bg-rose-500',
  10: 'bg-lime-600',
  11: 'bg-purple-500',
};

// ─── Calendar Component ──────────────────────────────────────────────────────

export function CalendarPage() {
  const navigate = useNavigate();
  const clients = useAppStore((s) => s.clients);
  useEffect(() => { document.title = 'AdvisorIQ — Calendar'; }, []);

  const [weekOffset, setWeekOffset] = useState(0);

  const weekStart = useMemo(() => {
    const base = startOfWeek(new Date(), { weekStartsOn: 1 });
    if (weekOffset === 0) return base;
    if (weekOffset > 0) return addWeeks(base, weekOffset);
    return subWeeks(base, -weekOffset);
  }, [weekOffset]);

  // Mon–Fri only
  const weekDays = useMemo(
    () => Array.from({ length: 5 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  // Collect all client meetings with client reference
  const allMeetings = useMemo(
    () =>
      clients.flatMap((c, idx) =>
        c.upcomingMeetings.map((m) => ({ ...m, client: c, colorIdx: idx % 12 }))
      ),
    [clients]
  );

  // Meetings in this week
  const weekMeetings = useMemo(
    () =>
      allMeetings.filter((m) =>
        weekDays.some((day) => isSameDay(parseISO(m.date), day))
      ),
    [allMeetings, weekDays]
  );

  // Today's meetings (always today regardless of week offset)
  const todayMeetings = useMemo(
    () =>
      allMeetings
        .filter((m) => isToday(parseISO(m.date)))
        .sort((a, b) => parseHour(a.time) - parseHour(b.time)),
    [allMeetings]
  );

  // Upcoming 30 days
  const upcoming30 = useMemo(() => {
    const now = startOfDay(new Date());
    const end = addMonths(now, 1);
    const meetings = allMeetings
      .filter((m) => {
        const d = parseISO(m.date);
        return !isBefore(d, now) && isBefore(d, end);
      })
      .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime());

    // Group by date
    const grouped: Record<string, typeof meetings> = {};
    for (const m of meetings) {
      const key = m.date;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(m);
    }
    return grouped;
  }, [allMeetings]);

  const weekLabel = useMemo(() => {
    const end = addDays(weekStart, 4);
    if (format(weekStart, 'MMM') === format(end, 'MMM')) {
      return `${format(weekStart, 'MMM d')} – ${format(end, 'd, yyyy')}`;
    }
    return `${format(weekStart, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
  }, [weekStart]);

  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => HOUR_START + i);

  function getMeetingsForDayHour(day: Date, hour: number) {
    return weekMeetings.filter((m) => {
      if (!isSameDay(parseISO(m.date), day)) return false;
      const h = parseHour(m.time);
      return Math.floor(h) === hour;
    });
  }

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Calendar</h1>
        <p className="text-sm text-gray-500 mt-0.5">Scheduled meetings across all clients</p>
      </div>

      <div className="flex gap-5 items-start">
        {/* ── Left: Weekly Grid ─────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-5">
          {/* Week navigation */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3"
                onClick={() => setWeekOffset((w) => w - 1)}
              >
                <ChevronLeft size={14} className="mr-1" />
                Previous Week
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3"
                onClick={() => setWeekOffset((w) => w + 1)}
              >
                Next Week
                <ChevronRight size={14} className="ml-1" />
              </Button>
              {weekOffset !== 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-3 text-blue-600"
                  onClick={() => setWeekOffset(0)}
                >
                  Today
                </Button>
              )}
            </div>
            <span className="text-sm font-semibold text-gray-800">{weekLabel}</span>
          </div>

          {/* Calendar grid */}
          <Card className="border-gray-200 overflow-hidden">
            <div
              className="grid"
              style={{ gridTemplateColumns: '52px repeat(5, 1fr)' }}
            >
              {/* Header row */}
              <div className="border-b border-r border-gray-200 bg-gray-50" />
              {weekDays.map((day) => (
                <div
                  key={day.toISOString()}
                  className={`border-b border-r border-gray-200 text-center py-2.5 ${
                    isToday(day) ? 'bg-blue-50' : 'bg-gray-50'
                  }`}
                >
                  <div className={`text-xs font-medium ${isToday(day) ? 'text-blue-700' : 'text-gray-500'}`}>
                    {format(day, 'EEE')}
                  </div>
                  <div
                    className={`text-sm font-bold mx-auto mt-0.5 w-7 h-7 flex items-center justify-center rounded-full ${
                      isToday(day)
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-900'
                    }`}
                  >
                    {format(day, 'd')}
                  </div>
                </div>
              ))}

              {/* Hour rows */}
              {hours.map((hour) => (
                <>
                  {/* Time label */}
                  <div
                    key={`time-${hour}`}
                    className="border-b border-r border-gray-100 text-right pr-2 pt-1"
                    style={{ height: CELL_HEIGHT }}
                  >
                    <span className="text-xs text-gray-400">
                      {hour === 12 ? '12pm' : hour < 12 ? `${hour}am` : `${hour - 12}pm`}
                    </span>
                  </div>

                  {/* Day cells */}
                  {weekDays.map((day) => {
                    const cellMeetings = getMeetingsForDayHour(day, hour);
                    return (
                      <div
                        key={`${day.toISOString()}-${hour}`}
                        className={`border-b border-r border-gray-100 relative ${
                          isToday(day) ? 'bg-blue-50/30' : ''
                        }`}
                        style={{ height: CELL_HEIGHT }}
                      >
                        {cellMeetings.map((m) => {
                          const h = parseHour(m.time);
                          const topPct = ((h - Math.floor(h)) * CELL_HEIGHT);
                          return (
                            <div
                              key={m.id}
                              className={`absolute left-1 right-1 rounded px-1.5 py-1 cursor-pointer hover:opacity-90 transition-opacity z-10 ${DAY_COLORS[m.colorIdx]}`}
                              style={{
                                top: topPct,
                                minHeight: 40,
                              }}
                              onClick={() => navigate(`/clients/${m.client.id}?tab=history`)}
                              title={`${m.client.name} — ${m.purpose}`}
                            >
                              <div className="text-white text-xs font-semibold leading-tight truncate">
                                {m.client.name.split(' ')[0]}
                              </div>
                              <div className="text-white/80 text-xs leading-tight truncate">
                                {m.time}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </>
              ))}
            </div>

            {/* Empty state */}
            {weekMeetings.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center border-t border-gray-100">
                <CalendarIcon size={28} className="text-gray-200 mb-3" />
                <p className="text-sm font-medium text-gray-500">No meetings scheduled this week</p>
                <p className="text-xs text-gray-400 mt-1">Add upcoming meetings from a client profile to see them here</p>
              </div>
            )}
          </Card>

          {/* ── Upcoming 30 days ───────────────────────────────────────────── */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">Upcoming — Next 30 Days</h2>

            {Object.keys(upcoming30).length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-8 text-center">
                  <Users size={20} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">No meetings in the next 30 days</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {Object.entries(upcoming30).map(([dateStr, meetings]) => {
                  const d = parseISO(dateStr);
                  const isNow = isToday(d);
                  const daysAway = differenceInDays(d, startOfDay(new Date()));
                  return (
                    <div key={dateStr}>
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`text-xs font-semibold px-2 py-0.5 rounded ${
                          isNow
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {isNow ? 'Today' : format(d, 'EEE, MMM d')}
                        </div>
                        <span className="text-xs text-gray-400">
                          {isNow ? '' : daysAway === 1 ? 'Tomorrow' : `${daysAway} days away`}
                        </span>
                        <div className="flex-1 h-px bg-gray-100" />
                      </div>
                      <div className="space-y-2 pl-1">
                        {meetings.map((m) => (
                          <div
                            key={m.id}
                            className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-blue-200 hover:bg-blue-50/30 cursor-pointer transition-colors"
                            onClick={() => navigate(`/clients/${m.client.id}?tab=history`)}
                          >
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${DAY_COLORS[m.colorIdx]}`} />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-900">{m.client.name}</div>
                              <div className="text-xs text-gray-500 truncate">{m.purpose}</div>
                            </div>
                            <div className="flex items-center gap-1 text-xs text-gray-400 flex-shrink-0">
                              <Clock size={11} />
                              {m.time}
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700 flex-shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/clients/${m.client.id}?tab=brief`);
                              }}
                            >
                              <FileText size={11} className="mr-1" />
                              Brief
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Today's Agenda ─────────────────────────────────────────── */}
        <div className="w-72 flex-shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Today's Agenda</h2>
            <span className="text-xs text-gray-400">{format(new Date(), 'EEE, MMM d')}</span>
          </div>

          {todayMeetings.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center">
                <CalendarIcon size={20} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-500">Day is clear</p>
                <p className="text-xs text-gray-400 mt-1">No meetings scheduled for today</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {todayMeetings.map((m) => (
                <Card
                  key={m.id}
                  className="border-gray-200 cursor-pointer hover:border-blue-200 transition-colors"
                  onClick={() => navigate(`/clients/${m.client.id}?tab=history`)}
                >
                  <CardContent className="p-3.5">
                    <div className="flex items-start gap-2 mb-2">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ${DAY_COLORS[m.colorIdx]}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-900 leading-tight">{m.client.name}</div>
                        <div className="text-xs text-gray-500 mt-0.5 leading-tight">{m.purpose}</div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between pl-4">
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <Clock size={11} />
                        {m.time}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs px-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/clients/${m.client.id}?tab=brief`);
                        }}
                      >
                        <FileText size={11} className="mr-1" />
                        Generate Brief
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Mini legend */}
          {todayMeetings.length > 0 && (
            <p className="text-xs text-gray-400 px-1">
              Click any meeting to view the client's history tab.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
