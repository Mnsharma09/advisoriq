import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Play, RefreshCw, AlertCircle, ChevronRight, Info, Settings } from 'lucide-react';
import type { Client } from '@/types';
import {
  generateAttritionAssessment,
  getMatchedPatterns,
  type AttritionAssessment,
  type AttritionRiskCategory,
} from '@/lib/claudeClient';
import { useAppStore } from '@/store/appStore';

// ── Color maps ────────────────────────────────────────────────────────────────

const RISK_STYLES: Record<AttritionRiskCategory, {
  badge: string;
  bar: string;
  actionBox: string;
}> = {
  'no concern': {
    badge: 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200',
    bar: 'bg-emerald-500',
    actionBox: 'bg-emerald-50 border-emerald-200',
  },
  'busy but stable': {
    badge: 'bg-blue-100 text-blue-800 ring-1 ring-blue-200',
    bar: 'bg-blue-500',
    actionBox: 'bg-blue-50 border-blue-200',
  },
  'quiet disengagement': {
    badge: 'bg-amber-100 text-amber-800 ring-1 ring-amber-200',
    bar: 'bg-amber-500',
    actionBox: 'bg-amber-50 border-amber-200',
  },
  dissatisfaction: {
    badge: 'bg-red-100 text-red-800 ring-1 ring-red-200',
    bar: 'bg-red-500',
    actionBox: 'bg-red-50 border-red-200',
  },
};

const CONFIDENCE_BADGE: Record<AttritionAssessment['confidence'], string> = {
  high:   'bg-gray-100 text-gray-600',
  medium: 'bg-gray-100 text-gray-600',
  low:    'bg-gray-100 text-gray-500',
};

const CONFIDENCE_DOT: Record<AttritionAssessment['confidence'], string> = {
  high:   'bg-emerald-400',
  medium: 'bg-amber-400',
  low:    'bg-gray-400',
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  client: Client;
}

export function AttritionRiskCard({ client }: Props) {
  const confirmedPatterns  = useAppStore((s) => s.confirmedPatterns);
  const apiKey             = useAppStore((s) => s.claudeApiKey);
  const callNotesResults   = useAppStore((s) => s.callNotesResults);
  const [status, setStatus] = useState<'idle' | 'loading' | 'complete' | 'error'>('idle');
  const [result, setResult] = useState<AttritionAssessment | null>(null);
  const [matchedPatterns, setMatchedPatterns] = useState<ReturnType<typeof getMatchedPatterns>>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<Date | null>(null);

  // Sync with Call Notes panel results — keeps card display consistent with the banner
  useEffect(() => {
    if (!callNotesResults || callNotesResults.clientId !== client.id) return;
    if (!callNotesResults.attrition) return;
    setResult(callNotesResults.attrition);
    setMatchedPatterns(getMatchedPatterns(client, confirmedPatterns));
    setStatus('complete');
    setLastRun(new Date());
  }, [callNotesResults, client.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runAssessment() {
    setStatus('loading');
    setError(null);
    setResult(null);
    try {
      const assessment = await generateAttritionAssessment(client, confirmedPatterns);
      const matched = getMatchedPatterns(client, confirmedPatterns);
      setResult(assessment);
      setMatchedPatterns(matched);
      setLastRun(new Date());
      setStatus('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setStatus('error');
    }
  }

  const riskStyle = result ? (RISK_STYLES[result.riskCategory] ?? RISK_STYLES['quiet disengagement']) : null;
  const hasPatterns = confirmedPatterns.length > 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={15} className="text-indigo-600" />
          <span className="text-sm font-semibold text-gray-800">Attrition Risk Assessment</span>
        </div>
        <div className="flex items-center gap-3">
          {lastRun && (
            <span className="text-[11px] text-gray-400">
              Last run: {lastRun.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {(status === 'idle' || status === 'complete' || status === 'error') && apiKey && (
            <button
              onClick={runAssessment}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 px-3 py-1.5 rounded-md transition-colors"
            >
              {status === 'complete' || status === 'error'
                ? <RefreshCw size={12} />
                : <Play size={12} />}
              {status === 'complete' ? 'Re-run' : status === 'error' ? 'Retry' : 'Run Assessment'}
            </button>
          )}
        </div>
      </div>

      <div className="px-4 py-3">
        {/* Idle */}
        {status === 'idle' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              Evaluates this client's attrition risk using health score signals, interaction history, and validated cross-book patterns.
            </p>
            {!apiKey && (
              <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm text-amber-800">Add your Claude API key in Settings to enable AI features.</p>
                <Link
                  to="/settings"
                  className="flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-900 whitespace-nowrap ml-3"
                >
                  <Settings size={12} />
                  Go to Settings
                </Link>
              </div>
            )}
            {!hasPatterns && (
              <div className="flex items-start gap-1.5 text-xs text-gray-400">
                <Info size={12} className="mt-0.5 flex-shrink-0 text-gray-300" />
                <span>
                  Run Pattern Discovery on the Practice page first for pattern-aware assessment.
                  Assessment will still work without it.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Loading */}
        {status === 'loading' && (
          <div className="py-4 flex items-center gap-3">
            <div className="w-5 h-5 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin flex-shrink-0" />
            <span className="text-sm text-gray-600">Assessing attrition risk…</span>
          </div>
        )}

        {/* Error */}
        {status === 'error' && error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg">
            <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-red-700">{error}</p>
              {/api.?key|invalid.*key|authentication/i.test(error) && (
                <Link to="/settings" className="inline-flex items-center gap-1 mt-1.5 text-xs font-medium text-red-600 hover:text-red-800">
                  <Settings size={11} />
                  Go to Settings to update your API key
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Results */}
        {status === 'complete' && result && riskStyle && (
          <div className="space-y-3">
            {/* Risk category + confidence row */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Left accent bar + category badge */}
              <div className="flex items-center gap-2">
                <div className={`w-1 h-6 rounded-full flex-shrink-0 ${riskStyle.bar}`} />
                <span className={`text-sm font-semibold px-2.5 py-1 rounded-full ${riskStyle.badge}`}>
                  {result.riskCategory}
                </span>
              </div>
              {/* Confidence — visually secondary */}
              <span className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${CONFIDENCE_BADGE[result.confidence]}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${CONFIDENCE_DOT[result.confidence]}`} />
                {result.confidence} confidence
              </span>
            </div>

            {/* Key Drivers */}
            {result.drivers && result.drivers.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {result.drivers.map((d, i) => (
                  <span key={i} className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                    {d.label}: {d.value}
                  </span>
                ))}
              </div>
            )}

            {/* Reasoning */}
            <p className="text-sm text-gray-700 leading-relaxed">{result.reasoning}</p>

            {/* Suggested action */}
            <div className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border ${riskStyle.actionBox}`}>
              <ChevronRight size={14} className="text-gray-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-0.5">
                  Suggested action
                </p>
                <p className="text-sm text-gray-800 font-medium leading-snug">{result.suggestedAction}</p>
              </div>
            </div>

            {/* Matched cross-book patterns */}
            {matchedPatterns.length > 0 && (
              <div className="pt-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
                  Matched cross-book patterns
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {matchedPatterns.map((p, i) => (
                    <span
                      key={i}
                      title={`${p.matchPercentage}% vs ${p.comparisonBaselinePercentage}% baseline (n=${p.sampleSize})`}
                      className="text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 truncate max-w-[240px]"
                    >
                      {p.hypothesis.length > 55 ? p.hypothesis.slice(0, 52) + '…' : p.hypothesis}
                    </span>
                  ))}
                </div>
                {!hasPatterns && (
                  <p className="text-[11px] text-gray-400 mt-1.5 italic">
                    No patterns from Practice page yet — re-run after Pattern Discovery for full context.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
