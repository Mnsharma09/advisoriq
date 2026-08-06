import { Sparkles } from 'lucide-react';

export function AiBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 font-medium">
      <Sparkles size={10} />
      AI generated — review before use
    </span>
  );
}
