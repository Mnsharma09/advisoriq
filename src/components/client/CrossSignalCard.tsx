import { useEffect, useState } from 'react';
import { GitMerge, Sparkles } from 'lucide-react';
import type { CrossSignalSynthesisResult } from '@/lib/claudeClient';
import { useAppStore } from '@/store/appStore';

interface Props {
  clientId: string;
}

export function CrossSignalCard({ clientId }: Props) {
  const callNotesResults = useAppStore((s) => s.callNotesResults);
  const [result, setResult] = useState<CrossSignalSynthesisResult | null>(null);

  useEffect(() => {
    if (!callNotesResults || callNotesResults.clientId !== clientId) return;
    setResult(callNotesResults.crossSignal ?? null);
  }, [callNotesResults, clientId]);

  if (!result) return null;

  return (
    <div className="rounded-lg border-2 border-violet-200 bg-violet-50/30 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-violet-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitMerge size={15} className="text-violet-600" />
          <span className="text-sm font-semibold text-gray-800">Cross-Signal View</span>
          <span className="text-[10px] font-semibold bg-violet-100 text-violet-700 border border-violet-200 px-1.5 py-0.5 rounded-full">
            V1 · Experimental
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Sparkles size={11} className="text-violet-400" />
          <span className="text-[10px] text-violet-500 font-medium">
            {result.activeSignals.length} signals synthesised
          </span>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Active signal pills */}
        <div className="flex flex-wrap gap-1.5">
          {result.activeSignals.map((sig, i) => (
            <span
              key={i}
              className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200"
            >
              {sig}
            </span>
          ))}
        </div>

        {/* Headline */}
        <p className="text-sm font-semibold text-gray-800 leading-snug">{result.headline}</p>

        {/* Synthesis */}
        <p className="text-sm text-gray-700 leading-relaxed">{result.synthesis}</p>

        {/* Prioritized recommendation */}
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-violet-200 bg-violet-50">
          <div className="w-1 h-5 rounded-full bg-violet-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-violet-500 mb-0.5">
              Prioritized recommendation
            </p>
            <p className="text-sm text-gray-800 font-medium leading-snug">
              {result.prioritizedRecommendation}
            </p>
          </div>
        </div>

        {/* Experimental disclaimer */}
        <p className="text-[10px] text-gray-400 leading-relaxed">
          Cross-Signal View is experimental and additive — it synthesises only the signals already produced by the four individual agents above. It does not perform independent analysis. Always review underlying agent evidence before acting.
        </p>
      </div>
    </div>
  );
}
