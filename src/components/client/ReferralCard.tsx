import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Play, RefreshCw, AlertCircle, ChevronRight, Settings } from 'lucide-react';
import type { Client } from '@/types';
import {
  generateReferralAssessment,
  calculateReferralConfidence,
  type ReferralAssessment,
  type ReferralSignal,
} from '@/lib/claudeClient';
import { useAppStore } from '@/store/appStore';

// ── Color maps ────────────────────────────────────────────────────────────────

const SIGNAL_STYLES: Record<Exclude<ReferralSignal, 'none'>, {
  badge: string;
  bar: string;
  actionBox: string;
  label: string;
}> = {
  high: {
    badge:     'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200',
    bar:       'bg-emerald-500',
    actionBox: 'bg-emerald-50 border-emerald-200',
    label:     'High opportunity',
  },
  moderate: {
    badge:     'bg-amber-100 text-amber-800 ring-1 ring-amber-200',
    bar:       'bg-amber-500',
    actionBox: 'bg-amber-50 border-amber-200',
    label:     'Moderate opportunity',
  },
  low: {
    badge:     'bg-blue-100 text-blue-800 ring-1 ring-blue-200',
    bar:       'bg-blue-400',
    actionBox: 'bg-blue-50 border-blue-200',
    label:     'Low opportunity',
  },
};

const NONE_STYLE = {
  badge:     'bg-gray-100 text-gray-500 ring-1 ring-gray-200',
  bar:       'bg-gray-200',
  actionBox: 'bg-gray-50 border-gray-200',
  label:     'No signal detected',
};

const CONFIDENCE_BADGE: Record<ReferralAssessment['confidence'], string> = {
  high:   'bg-gray-100 text-gray-600',
  medium: 'bg-gray-100 text-gray-600',
  low:    'bg-gray-100 text-gray-500',
};

const CONFIDENCE_DOT: Record<ReferralAssessment['confidence'], string> = {
  high:   'bg-emerald-400',
  medium: 'bg-amber-400',
  low:    'bg-gray-400',
};

const TIER_BADGE: Record<'active' | 'historical' | 'none', string> = {
  active:     'bg-emerald-50 text-emerald-700 border border-emerald-200',
  historical: 'bg-gray-50 text-gray-600 border border-gray-200',
  none:       'bg-gray-50 text-gray-400 border border-gray-200',
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  client: Client;
}

export function ReferralCard({ client }: Props) {
  const apiKey = useAppStore((s) => s.claudeApiKey);
  const [status, setStatus]   = useState<'idle' | 'loading' | 'complete' | 'error'>('idle');
  const [result, setResult]   = useState<ReferralAssessment | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<Date | null>(null);

  const refs = client.referralHistory ?? [];
  const isCandidate = refs.length > 0;
  const { confidence: deterministicConfidence, recencyTier } = calculateReferralConfidence(refs);

  async function runAssessment() {
    setStatus('loading');
    setError(null);
    setResult(null);
    try {
      const assessment = await generateReferralAssessment(client);
      setResult(assessment);
      setLastRun(new Date());
      setStatus('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setStatus('error');
    }
  }

  const signalStyle = result
    ? (result.referralSignal !== 'none'
        ? SIGNAL_STYLES[result.referralSignal as Exclude<ReferralSignal, 'none'>]
        : NONE_STYLE)
    : null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={15} className="text-indigo-600" />
          <span className="text-sm font-semibold text-gray-800">Referral &amp; Acquisition</span>
          {isCandidate && (
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${TIER_BADGE[recencyTier]}`}>
              {refs.length} referral{refs.length !== 1 ? 's' : ''} · {recencyTier}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {lastRun && (
            <span className="text-[11px] text-gray-400">
              Last run: {lastRun.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          {(status === 'idle' || status === 'complete' || status === 'error') && apiKey && isCandidate && (
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
            {isCandidate ? (
              <p className="text-sm text-gray-500">
                Evaluates this client's referral and acquisition potential using their verified referral
                history and interaction signals — not inferred from topic tags or personality.
              </p>
            ) : (
              <p className="text-sm text-gray-400 italic">
                No verified referral history on file for this client. Assessment is only available
                for clients who have previously made referrals.
              </p>
            )}
            {!apiKey && isCandidate && (
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
            {isCandidate && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-400">Deterministic confidence:</span>
                <span className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${CONFIDENCE_BADGE[deterministicConfidence]}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${CONFIDENCE_DOT[deterministicConfidence]}`} />
                  {deterministicConfidence}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Loading */}
        {status === 'loading' && (
          <div className="py-4 flex items-center gap-3">
            <div className="w-5 h-5 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin flex-shrink-0" />
            <span className="text-sm text-gray-600">Analysing referral signals…</span>
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
        {status === 'complete' && result && signalStyle && (
          <div className="space-y-3">
            {/* Signal + confidence row */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <div className={`w-1 h-6 rounded-full flex-shrink-0 ${signalStyle.bar}`} />
                <span className={`text-sm font-semibold px-2.5 py-1 rounded-full ${signalStyle.badge}`}>
                  {signalStyle.label}
                </span>
              </div>
              <span className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${CONFIDENCE_BADGE[result.confidence]}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${CONFIDENCE_DOT[result.confidence]}`} />
                {result.confidence} confidence
              </span>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${TIER_BADGE[result.recencyTier]}`}>
                {result.recencyTier}
              </span>
            </div>

            {/* Evidence */}
            <p className="text-sm text-gray-700 leading-relaxed">{result.evidence}</p>

            {/* Conversion likelihood */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-gray-400 font-medium uppercase tracking-wide">Conversion likelihood:</span>
              <span className="text-[11px] font-semibold text-gray-700">{result.conversionLikelihood}</span>
            </div>

            {/* Suggested action */}
            <div className={`flex items-start gap-2 px-3 py-2.5 rounded-lg border ${signalStyle.actionBox}`}>
              <ChevronRight size={14} className="text-gray-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-0.5">
                  Suggested action
                </p>
                <p className="text-sm text-gray-800 font-medium leading-snug">{result.suggestedAction}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
