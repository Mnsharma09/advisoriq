import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { format } from 'date-fns';
import { useAppStore } from '@/store/appStore';
import { Button } from '@/components/ui/button';

export function TopBar() {
  const faName = useAppStore((s) => s.faName);
  const today = new Date();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatch — only render the toggle after mount
  useEffect(() => { setMounted(true); }, []);

  return (
    <header className="h-14 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-6 flex-shrink-0">
      <div>
        <span className="text-gray-500 dark:text-gray-400 text-sm">
          {format(today, 'EEEE, MMMM d, yyyy')}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          Good morning, <span className="text-blue-600 dark:text-blue-400">{faName}</span>
        </span>
        {mounted && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-gray-500 dark:text-gray-400"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </Button>
        )}
      </div>
    </header>
  );
}
