import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Monitor } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function Layout() {
  const [showMobileBanner, setShowMobileBanner] = useState(false);

  useEffect(() => {
    function check() { setShowMobileBanner(window.innerWidth < 1024); }
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  return (
    <div className="flex flex-col min-h-screen">
      <div className="flex flex-1 bg-gray-50 dark:bg-gray-950">
        <Sidebar />
        <div className="flex-1 flex flex-col ml-56">
          {showMobileBanner && (
            <div className="flex items-center justify-center gap-2 bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-700 text-amber-800 dark:text-amber-200 text-xs px-4 py-2 text-center">
              <Monitor size={13} className="flex-shrink-0" />
              AdvisorIQ is optimised for desktop. For the best experience please use a larger screen.
            </div>
          )}
          <TopBar />
          <main className="flex-1 overflow-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
