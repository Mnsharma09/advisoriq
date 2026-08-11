import { useMemo, useState } from 'react';
import { Brain, Play, RefreshCw, AlertCircle, ChevronRight, ShieldCheck } from 'lucide-react';
import { differenceInDays, parseISO } from 'date-fns';
import type { Client } from '@/types';
import {
  generatePatternHypotheses,
  validatePatternHypotheses,
  synthesizePatternFindings,
  type SynthesisResult,
  type SynthesisFinding,
  type ConfirmedPatternWithSpec,
} from '@/lib/claudeClient';
import { useAppStore } from '@/store/appStore';
import {
  CORE_CHECK_CONTACT_GAP_DAYS,
  CORE_CHECK_OPEN_ITEMS_OVERLOAD,
  CORE_CHECK_CASH_DRAG_PCT,
  DEMO_ANCHOR_DATE,
} from '@/lib/signalThresholds';

type Step = 'generating' | 'validating' | 'synthesizing';
type Status = 'idle' | 'loading' | 'complete' | 'error';

const STEP_LABELS: Record<Step, string> = {
  generating: 'Generating hypotheses…',
  validating: 'Validating against your book…',
  synthesizing: 'Synthesizing findings…',
};

const STEP_ORDER: Step[] = ['generating', 'validating', 'synthesizing'];

const CONFIDENCE_BAR: Record<SynthesisFinding['confidence'], string> = {
  high: 'bg-emerald-500',
  medium: 'bg-amber-400',
  low: 'bg-gray-400',
};

const CONFIDENCE_BADGE: Record<SynthesisFinding['confidence'], string> = {
  high: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-gray-100 text-gray-600',
};

interface Props {
  clients: Client[];
}

interface CoreCheck {
  label: string;
  count: number;
  detail: string;
  severity: 'high' | 'medium' | 'ok';
}

function useCoreChecks(clients: Client[]): CoreCheck[] {
  return useMemo(() => {
    const now = DEMO_ANCHOR_DATE;

    const engagementGap = clients.filter((c) =>
      differenceInDays(now, parseISO(c.lastContact)) >= CORE_CHECK_CONTACT_GAP_DAYS
    ).length;

    const actionBacklog = clients.filter((c) => {
      const open = c.history.flatMap((h) => h.actionItems.filter((ai) => !ai.completed)).length;
      return open >= CORE_CHECK_OPEN_ITEMS_OVERLOAD;
    }).length;

    const goalsOffTrack = clients.filter((c) =>
      c.goals.length > 0 && c.goals.some((g) => !g.onTrack)
    ).length;

    const cashDrag = clients.filter((c) => {
      const cash = c.allocation.find((a) => a.assetClass === 'Cash');
      return cash && cash.current > CORE_CHECK_CASH_DRAG_PCT;
    }).length;

    const estateGap = clients.filter((c) =>
      c.productHoldings?.some((h) => h.productType === 'estate_plan' && h.flaggedAsGap)
    ).length;

    return [
      {
        label: 'Engagement Gap',
        count: engagementGap,
        detail: `${CORE_CHECK_CONTACT_GAP_DAYS}+ days since last contact`,
        severity: engagementGap > 20 ? 'high' : engagementGap > 5 ? 'medium' : 'ok',
      },
      {
        label: 'Action Item Backlog',
        count: actionBacklog,
        detail: `${CORE_CHECK_OPEN_ITEMS_OVERLOAD}+ open items`,
        severity: actionBacklog > 15 ? 'high' : actionBacklog > 5 ? 'medium' : 'ok',
      },
      {
        label: 'Goals Off-Track',
        count: goalsOffTrack,
        detail: 'at least one goal behind target',
        severity: goalsOffTrack > 30 ? 'high' : goalsOffTrack > 10 ? 'medium' : 'ok',
      },
      {
        label: 'Cash Drag',
        count: cashDrag,
        detail: `>${CORE_CHECK_CASH_DRAG_PCT}% cash allocation`,
        severity: cashDrag > 15 ? 'high' : cashDrag > 5 ? 'medium' : 'ok',
      },
      {
        label: 'Estate Plan Gap',
        count: estateGap,
        detail: 'flagged as gap in holdings',
        severity: estateGap > 10 ? 'high' : estateGap > 3 ? 'medium' : 'ok',
      },
    ];
  }, [clients]);
}

const CORE_SEVERITY_DOT: Record<CoreCheck['severity'], string> = {
  high:   'bg-red-500',
  medium: 'bg-amber-400',
  ok:     'bg-emerald-400',
};

const CORE_SEVERITY_TEXT: Record<CoreCheck['severity'], string> = {
  high:   'text-red-700',
  medium: 'text-amber-700',
  ok:     'text-emerald-700',
};

export function PatternDiscoveryCard({ clients }: Props) {
  const setConfirmedPatterns = useAppStore((s) => s.setConfirmedPatterns);
  const [status, setStatus] = useState<Status>('idle');
  const [currentStep, setCurrentStep] = useState<Step>('generating');
  const [result, setResult] = useState<SynthesisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const coreChecks = useCoreChecks(clients);

  async function runAnalysis() {
    setStatus('loading');
    setError(null);
    setResult(null);

    try {
      setCurrentStep('generating');
      const hypotheses = await generatePatternHypotheses(clients);

      setCurrentStep('validating');
      const validationResults = validatePatternHypotheses(hypotheses, clients);

      setCurrentStep('synthesizing');
      const synthesis = await synthesizePatternFindings(hypotheses, validationResults);

      // Persist confirmed patterns to store so AttritionRiskCard can use them
      const confirmed: ConfirmedPatternWithSpec[] = validationResults
        .filter((r) => r.verdict === 'confirmed')
        .map((r) => {
          const hyp = hypotheses.find((h) => h.hypothesis === r.hypothesis);
          return {
            hypothesis: r.hypothesis,
            matchPercentage: r.matchPercentage,
            comparisonBaselinePercentage: r.comparisonBaselinePercentage,
            sampleSize: r.sampleSize,
            filterSpec: hyp?.filterSpec,
          };
        });
      setConfirmedPatterns(confirmed);

      setResult(synthesis);
      setLastRun(new Date());
      setStatus('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setStatus('error');
    }
  }

  const stepIndex = STEP_ORDER.indexOf(currentStep);

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={16} className="text-purple-600" />
          <span className="text-sm font-semibold text-gray-800">Pattern Discovery</span>
        </div>
        <div className="flex items-center gap-3">
          {lastRun && (
            <span className="text-[11px] text-gray-400">
              Last run: {lastRun.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {status === 'idle' || status === 'complete' || status === 'error' ? (
            <button
              onClick={runAnalysis}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-purple-600 hover:bg-purple-700 active:bg-purple-800 px-3 py-1.5 rounded-md transition-colors"
            >
              {status === 'complete' || status === 'error' ? (
                <RefreshCw size={12} />
              ) : (
                <Play size={12} />
              )}
              {status === 'complete' ? 'Re-run' : status === 'error' ? 'Retry' : 'Run Analysis'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="px-4 py-3 space-y-4">

        {/* ── Core Checks (always-on deterministic) ──────────────────────── */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <ShieldCheck size={13} className="text-gray-500" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              Core Checks
            </span>
            <span className="text-[10px] text-gray-400 ml-1">always-on · deterministic</span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {coreChecks.map((check) => (
              <div
                key={check.label}
                className="rounded-md border border-gray-100 bg-gray-50 px-2.5 py-2 text-center"
              >
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${CORE_SEVERITY_DOT[check.severity]}`} />
                  <span className={`text-lg font-bold tabular-nums ${CORE_SEVERITY_TEXT[check.severity]}`}>
                    {check.count}
                  </span>
                </div>
                <div className="text-[10px] font-medium text-gray-700 leading-tight">{check.label}</div>
                <div className="text-[9px] text-gray-400 leading-tight mt-0.5">{check.detail}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── AI-Suggested Exploratory Patterns ─────────────────────────── */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Brain size={13} className="text-purple-500" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              AI-Suggested Exploratory Patterns
            </span>
            <span className="text-[10px] text-gray-400 ml-1">requires analysis run</span>
          </div>

        {/* Description (idle only) */}
        {status === 'idle' && (
          <p className="text-sm text-gray-500">
            Uses AI to surface hidden patterns across your full client book — correlations between
            life stage, portfolio behaviour, and engagement that are invisible at the individual level.
          </p>
        )}

        {/* Loading state */}
        {status === 'loading' && (
          <div className="py-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-5 h-5 rounded-full border-2 border-purple-200 border-t-purple-600 animate-spin flex-shrink-0" />
              <span className="text-sm text-gray-700">{STEP_LABELS[currentStep]}</span>
            </div>
            <div className="flex gap-1.5">
              {STEP_ORDER.map((step, i) => (
                <div
                  key={step}
                  className={`h-1 flex-1 rounded-full transition-colors duration-500 ${
                    i < stepIndex
                      ? 'bg-purple-500'
                      : i === stepIndex
                      ? 'bg-purple-300'
                      : 'bg-gray-100'
                  }`}
                />
              ))}
            </div>
            <div className="flex gap-1.5 mt-1">
              {STEP_ORDER.map((step, i) => (
                <span
                  key={step}
                  className={`text-[10px] flex-1 ${
                    i === stepIndex ? 'text-purple-600 font-medium' : 'text-gray-400'
                  }`}
                >
                  {i === 0 ? 'Generate' : i === 1 ? 'Validate' : 'Synthesize'}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Error state */}
        {status === 'error' && error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg">
            <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Results */}
        {status === 'complete' && result && (
          <div className="space-y-4">
            {/* Headline */}
            <p className="text-sm font-medium text-gray-800">{result.headline}</p>

            {/* Confirmed findings */}
            {result.findings.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-sm text-gray-500">No statistically significant patterns confirmed in this run.</p>
                <p className="text-xs text-gray-400 mt-1">Try running again — the model may surface different hypotheses.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {result.findings.map((finding, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-gray-200 overflow-hidden flex"
                  >
                    {/* Left accent bar */}
                    <div className={`w-1.5 flex-shrink-0 ${CONFIDENCE_BAR[finding.confidence] ?? 'bg-gray-400'}`} />
                    <div className="flex-1 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="text-sm font-medium text-gray-800 leading-snug">{finding.title}</span>
                        <span
                          className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded flex-shrink-0 ${
                            CONFIDENCE_BADGE[finding.confidence] ?? 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {finding.confidence}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mb-1.5">{finding.evidence}</p>
                      <div className="flex items-center gap-1 text-xs text-purple-700 font-medium">
                        <ChevronRight size={11} />
                        <span>{finding.suggestedAction}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Watchlist */}
            {result.watchlist.length > 0 && (
              <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-600 mb-1.5">Watch</p>
                <ul className="space-y-1">
                  {result.watchlist.map((item, i) => (
                    <li key={i} className="text-xs text-blue-800 flex items-start gap-1.5">
                      <span className="mt-1 w-1 h-1 rounded-full bg-blue-400 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Summary */}
            <p className="text-xs text-gray-500 border-t border-gray-100 pt-3">{result.summary}</p>
          </div>
        )}
        </div>{/* end AI section */}

      </div>
    </div>
  );
}
