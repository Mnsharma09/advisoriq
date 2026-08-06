import { cn } from '@/lib/utils';
import type { HealthColor } from '@/types';

interface Props {
  score: number;
  color: HealthColor;
  size?: 'sm' | 'md' | 'lg';
}

const colorMap: Record<HealthColor, string> = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
};

const sizeMap = {
  sm: 'text-xs px-1.5 py-0.5',
  md: 'text-sm px-2 py-0.5',
  lg: 'text-base px-2.5 py-1',
};

export function HealthBadge({ score, color, size = 'md' }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-semibold rounded border tabular-nums',
        colorMap[color],
        sizeMap[size]
      )}
    >
      {score}
    </span>
  );
}
