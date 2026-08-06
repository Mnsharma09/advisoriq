import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ClipboardList, Play, RefreshCw, AlertCircle, ChevronRight,
  TrendingUp, Wallet, AlertTriangle, CheckCircle, Info,
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import {
  runBookOfWorkBatch,
  BOOK_OF_WORK_CLIENT_IDS,
  type BookOfWorkClientResult,
  type BookOfWorkProgress,
  type AttritionRiskCategory,
  type WalletCaptureOpportunitySignal,
} from '@/lib/claudeClient';
import type { Client } from '@/types';

// ── Color maps ────────────────────────────────────────────────────────────────

const ATTRITION_BADGE: Record<AttritionRiskCategory, string> = {
  dissatisfaction:       'bg-red-100 text-red-700 ring-1 ring-red-200',
  'quiet disengagement': 'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
  'busy but stable':     'bg-blue-100 text-blue-700 ring-1 ring-blue-200',
  'no concern':          'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
};

const ATTRITION_ICON: Record<AttritionRiskCategory, string> = {
  dissatisfaction:       'text-red-500',
  'quiet disengagement': 'text-amber-500',
  'busy but stable':     'text-blue-500',
  'no concern':          'text-emerald-500',
};

const WALLET_BADGE: Record<WalletCaptureOpportunitySignal, string> = {
  strong:   'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200',
  moderate: 'bg-amber-100 text-amber-700 ring-1 ring-amber-200',
  none:     'bg-gray-100 text-gray-400 ring-1 ring-gray-200',
};

const PRIORITY_BAR: (score: number) => string = (score) => {
  if (score >= 55) return 'bg-red-500';
  if (score >= 30) return 'bg-amber-400';
  if (score >= 10) return 'bg-blue-400';
  return 'bg-gray-200';
};

const fmtCompact = (v: number): string => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${v}`;
};

// ── Sub-components ────────────────────────────────────────────────────────────

function AttritionBadge({ cat }: { cat: AttritionRiskCategory }) {
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${ATTRITION_BADGE[cat]}`}>
      {cat}
    </span>
  );
}

function WalletBadge({ sig }: { sig: WalletCaptureOpportunitySignal }) {
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${WALLET_BADGE[sig]}`}>
      {sig === 'none' ? 'no signal' : sig}
    </span>
  );
}

function RankRow({ result, onClick }: { result: BookOfWorkClientResult; onClick: () => void }) {
  const attrCat = result.attrition?.riskCategory;
  const walletSig = result.walletCapture?.opportunitySignal;
  const hasError = Boolean(result.error);

  return (
    <div
      className="group flex items-start gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors border-b border-gray-100 last:border-0"
      onClick={onClick}
    >
      {/* Rank number */}
      <div className="w-6 h-6 flex-shrink-0 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-500 mt-0.5">
        {result.rank}
      </div>

      {/* Priority bar */}
      <div className="flex-shrink-0 w-1 self-stretch rounded-full mt-0.5 mb-0.5">
        <div className={`w-1 h-full rounded-full ${PRIORITY_BAR(result.priorityScore)}`} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-sm font-semibold text-gray-900 leading-tight">{result.clientName}</span>
          <span className="text-xs text-gray-400">{fmtCompact(result.aum)}</span>
          {hasError && (
            <span className="flex items-center gap-1 text-[10px] text-red-500">
              <AlertCircle size={10} />
              partial
            </span>
          )}
        </div>

        {/* Assessment badges */}
        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
          {attrCat && (
            <div className={`flex items-center gap-1 ${ATTRITION_ICON[attrCat]}`}>
              <TrendingUp size={10} className="flex-shrink-0" />
              <AttritionBadge cat={attrCat} />
            </div>
          )}
          {walletSig && (
            <div className="flex items-center gap-1 text-indigo-400">
              <Wallet size={10} className="flex-shrink-0" />
              <WalletBadge sig={walletSig} />
            </div>
          )}
        </div>

        {/* Justification */}
        <p className="text-[11px] text-gray-500 leading-relaxed">{result.justification}</p>

        {/* Suggested actions (collapsed — show attrition first if exists) */}
        {(result.attrition?.suggestedAction || result.walletCapture?.suggestedAction) && (
          <div className="mt-1.5 space-y-1">
            {result.attrition?.suggestedAction && result.attrition.riskCategory !== 'no concern' && (
              <div className="flex items-start gap-1.5">
                <ChevronRight size={11} className="text-gray-300 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-gray-600 leading-relaxed">{result.attrition.suggestedAction}</p>
              </div>
            )}
            {result.walletCapture?.suggestedAction && result.walletCapture.opportunitySignal !== 'none' && (
              <div className="flex items-start gap-1.5">
                <ChevronRight size={11} className="text-indigo-300 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-indigo-700 leading-relaxed">{result.walletCapture.suggestedAction}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Priority score chip */}
      <div className="flex-shrink-0 text-right">
        <div className={`text-xs font-bold tabular-nums px-2 py-0.5 rounded ${
          result.priorityScore >= 55 ? 'bg-red-50 text-red-600' :
          result.priorityScore >= 30 ? 'bg-amber-50 text-amber-600' :
          result.priorityScore >= 10 ? 'bg-blue-50 text-blue-600' :
          'bg-gray-50 text-gray-400'
        }`}>
          {result.priorityScore}
        </div>
        <div className="text-[9px] text-gray-300 mt-0.5 text-right">priority</div>
      </div>

      <ChevronRight size={13} className="flex-shrink-0 text-gray-300 group-hover:text-gray-500 transition-colors mt-1" />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  clients: Client[];
}

export function BookOfWorkCard({ clients }: Props) {
  const navigate = useNavigate();
  const confirmedPatterns = useAppStore((s) => s.confirmedPatterns);
  const bookOfWorkResults = useAppStore((s) => s.bookOfWorkResults);
  const setBookOfWorkResults = useAppStore((s) => s.setBookOfWorkResults);

  const [status, setStatus] = useState<'idle' | 'running' | 'complete' | 'error'>(
    bookOfWorkResults ? 'complete' : 'idle',
  );
  const [progress, setProgress] = useState<BookOfWorkProgress>({ completed: 0, total: 20 });
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<Date | null>(null);

  async function startBatch() {
    setStatus('running');
    setError(null);
    setProgress({ completed: 0, total: BOOK_OF_WORK_CLIENT_IDS.length });
    try {
      const results = await runBookOfWorkBatch(clients, confirmedPatterns, setProgress);
      setBookOfWorkResults(results);
      setLastRun(new Date());
      setStatus('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error during batch.');
      setStatus('error');
    }
  }

  const results = bookOfWorkResults ?? [];
  const errorCount = results.filter(r => r.error).length;
  const highPriorityCount = results.filter(r => r.priorityScore >= 30).length;
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList size={15} className="text-indigo-600" />
          <span className="text-sm font-semibold text-gray-800">Book of Work</span>
          <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full font-medium">
            {BOOK_OF_WORK_CLIENT_IDS.length} clients
          </span>
        </div>
        <div className="flex items-center gap-3">
          {lastRun && (
            <span className="text-[11px] text-gray-400">
              Last run: {lastRun.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {status !== 'running' && (
            <button
              onClick={startBatch}
              className="flex items-center gap-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 px-3 py-1.5 rounded-md transition-colors"
            >
              {status === 'complete' || status === 'error'
                ? <RefreshCw size={12} />
                : <Play size={12} />}
              {status === 'complete' ? 'Re-run Analysis' : status === 'error' ? 'Retry' : 'Run Analysis'}
            </button>
          )}
        </div>
      </div>

      <div className="px-4 py-3">
        {/* ── Idle ── */}
        {status === 'idle' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              Runs Attrition Risk and Wallet Capture assessments across {BOOK_OF_WORK_CLIENT_IDS.length} curated clients
              — a representative mix of risk profiles, AUM tiers, and life stages — then ranks them by combined
              priority score so the highest-value actions surface first.
            </p>
            <div className="flex items-start gap-1.5 text-xs text-gray-400">
              <Info size={12} className="mt-0.5 flex-shrink-0 text-gray-300" />
              <span>
                Runs {BOOK_OF_WORK_CLIENT_IDS.length * 2} Claude calls (~{Math.ceil(BOOK_OF_WORK_CLIENT_IDS.length / 5)} batches
                of 5). Results are cached in this session.
                {confirmedPatterns.length > 0
                  ? ` ${confirmedPatterns.length} confirmed pattern${confirmedPatterns.length > 1 ? 's' : ''} from Pattern Discovery will be applied.`
                  : ' Run Pattern Discovery first for pattern-aware rankings.'}
              </span>
            </div>
          </div>
        )}

        {/* ── Running ── */}
        {status === 'running' && (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin flex-shrink-0" />
              <span className="text-sm text-gray-700 font-medium">
                Assessing {progress.completed} of {progress.total} clients…
                {progress.currentClientName && (
                  <span className="font-normal text-gray-500"> · {progress.currentClientName}</span>
                )}
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-[11px] text-gray-400">{pct}% complete · {progress.total - progress.completed} remaining</p>
          </div>
        )}

        {/* ── Error ── */}
        {status === 'error' && error && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg">
            <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* ── Complete ── */}
        {status === 'complete' && results.length > 0 && (
          <div className="space-y-3">
            {/* Summary bar */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
                <CheckCircle size={13} className="text-emerald-500" />
                {results.length} clients assessed
              </div>
              {highPriorityCount > 0 && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">
                  <AlertTriangle size={11} />
                  {highPriorityCount} high priority
                </div>
              )}
              {errorCount > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-100">
                  <AlertCircle size={11} />
                  {errorCount} partial failure{errorCount > 1 ? 's' : ''}
                </div>
              )}
              <div className="ml-auto flex items-center gap-1 text-[10px] text-gray-400">
                <span className="font-semibold">Priority score</span> = attrition severity + wallet signal, weighted by confidence
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 text-[10px] text-gray-400 pb-1 border-b border-gray-100">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                <span>≥55 critical</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <span>30–54 high</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-400" />
                <span>10–29 medium</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-gray-200" />
                <span>&lt;10 low</span>
              </div>
            </div>

            {/* Ranked list */}
            <div className="-mx-4">
              {results.map(r => (
                <RankRow
                  key={r.clientId}
                  result={r}
                  onClick={() => navigate(`/clients/${r.clientId}`)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
