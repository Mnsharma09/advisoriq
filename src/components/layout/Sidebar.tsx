import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  BarChart2,
  Users,
  CalendarDays,
  Newspaper,
  Settings,
  TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/appStore';
import { isToday, parseISO } from 'date-fns';

export function Sidebar() {
  const clients = useAppStore((s) => s.clients);

  // Count meetings today across all clients
  const todayMeetingCount = clients.flatMap((c) =>
    c.upcomingMeetings.filter((m) => isToday(parseISO(m.date)))
  ).length;

  return (
    <aside className="fixed left-0 top-0 h-screen w-56 flex flex-col z-30" style={{ background: '#0f172a' }}>
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/10">
        <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0">
          <TrendingUp className="w-4.5 h-4.5 text-white" size={18} />
        </div>
        <div>
          <div className="text-white font-semibold text-sm leading-tight">AdvisorIQ</div>
          <div className="text-white/40 text-xs">AI-Powered Platform</div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150',
              isActive
                ? 'bg-white/10 text-white'
                : 'text-white/60 hover:text-white/90 hover:bg-white/06'
            )
          }
          style={({ isActive }) => ({ background: isActive ? 'rgba(255,255,255,0.1)' : undefined })}
        >
          <LayoutDashboard size={16} className="flex-shrink-0" />
          Dashboard
        </NavLink>

        <NavLink
          to="/practice"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150',
              isActive
                ? 'bg-white/10 text-white'
                : 'text-white/60 hover:text-white/90 hover:bg-white/06'
            )
          }
          style={({ isActive }) => ({ background: isActive ? 'rgba(255,255,255,0.1)' : undefined })}
        >
          <BarChart2 size={16} className="flex-shrink-0" />
          My Practice
        </NavLink>

        {/* Calendar with today's meeting badge */}
        <NavLink
          to="/calendar"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150',
              isActive
                ? 'bg-white/10 text-white'
                : 'text-white/60 hover:text-white/90 hover:bg-white/06'
            )
          }
          style={({ isActive }) => ({ background: isActive ? 'rgba(255,255,255,0.1)' : undefined })}
        >
          <CalendarDays size={16} className="flex-shrink-0" />
          <span className="flex-1">Calendar</span>
          {todayMeetingCount > 0 && (
            <span className="bg-blue-500 text-white text-xs font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
              {todayMeetingCount}
            </span>
          )}
        </NavLink>

        <NavLink
          to="/clients"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150',
              isActive
                ? 'bg-white/10 text-white'
                : 'text-white/60 hover:text-white/90 hover:bg-white/06'
            )
          }
          style={({ isActive }) => ({ background: isActive ? 'rgba(255,255,255,0.1)' : undefined })}
        >
          <Users size={16} className="flex-shrink-0" />
          Clients
        </NavLink>

        <NavLink
          to="/news"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150',
              isActive
                ? 'bg-white/10 text-white'
                : 'text-white/60 hover:text-white/90 hover:bg-white/06'
            )
          }
          style={({ isActive }) => ({ background: isActive ? 'rgba(255,255,255,0.1)' : undefined })}
        >
          <Newspaper size={16} className="flex-shrink-0" />
          News Feed
        </NavLink>

        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150',
              isActive
                ? 'bg-white/10 text-white'
                : 'text-white/60 hover:text-white/90 hover:bg-white/06'
            )
          }
          style={({ isActive }) => ({ background: isActive ? 'rgba(255,255,255,0.1)' : undefined })}
        >
          <Settings size={16} className="flex-shrink-0" />
          Settings
        </NavLink>
      </nav>

      <div className="px-4 py-4 border-t border-white/10">
        <div className="text-white/30 text-xs leading-relaxed">
          AI-generated content requires review before use.
        </div>
      </div>
    </aside>
  );
}
