import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Wallet, Play, RefreshCw, AlertCircle, ChevronRight, Info,
  Settings, Copy, Check, Send,
} from 'lucide-react';
import type { Client } from '@/types';
import {
  generateWalletCaptureAssessment,
  getMatchedPatterns,
  type WalletCaptureAssessment,
  type WalletCaptureOpportunitySignal,
} from '@/lib/claudeClient';
import { useAppStore } from '@/store/appStore';

// ── Color maps ────────────────────────────────────────────────────────────────

const SIGNAL_STYLES: Record<WalletCaptureOpportunitySignal, {
  badge: string;
  bar: string;
  actionBox: string;
  label: string;
}> = {
  strong: {
    badge:     'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200',
    bar:       'bg-emerald-500',
    actionBox: 'bg-emerald-50 border-emerald-200',
    label:     'Strong opportunity',
  },
  moderate: {
    badge:     'bg-amber-100 text-amber-800 ring-1 ring-amber-200',
    bar:       'bg-amber-500',
    actionBox: 'bg-amber-50 border-amber-200',
    label:     'Moderate opportunity',
  },
  none: {
    badge:     'bg-gray-100 text-gray-500 ring-1 ring-gray-200',
    bar:       'bg-gray-200',
    actionBox: 'bg-gray-50 border-gray-200',
    label:     'No signal detected',
  },
};

const CONFIDENCE_BADGE: Record<WalletCaptureAssessment['confidence'], string> = {
  high:   'bg-gray-100 text-gray-600',
  medium: 'bg-gray-100 text-gray-600',
  low:    'bg-gray-100 text-gray-500',
};

const CONFIDENCE_DOT: Record<WalletCaptureAssessment['confidence'], string> = {
  high:   'bg-emerald-400',
  medium: 'bg-amber-400',
  low:    'bg-gray-400',
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  client: Client;
}

export function WalletCaptureCard({ client }: Props) {
  const confirmedPatterns = useAppStore((s) => s.confirmedPatterns);
  const apiKey            = useAppStore((s) => s.claudeApiKey);
  const callNotesResults  = useAppStore((s) => s.callNotesResults);

  const [status, setStatus]               = useState<'idle' | 'loading' | 'complete' | 'error'>('idle');
  const [result, setResult]               = useState<WalletCaptureAssessment | null>(null);
  const [matchedPatterns, setMatchedPatterns] = useState<ReturnType<typeof getMatchedPatterns>>([]);
  const [error, setError]                 = useState<string | null>(null);
  const [lastRun, setLastRun]             = useState<Date | null>(null);

  // Sync with Call Notes panel results — keeps card display consistent with the banner
  useEffect(() => {
    if (!callNotesResults || callNotesResults.clientId !== client.id) return;
    if (!callNotesResults.walletCapture) return;
    setResult(callNotesResults.walletCapture);
    setMatchedPatterns(getMatchedPatterns(client, confirmedPatterns));
    setDraftText(callNotesResults.walletCapture.suggestedAction);
    setStatus('complete');
    setLastRun(new Date());
  }, [callNotesResults, client.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draft follow-up state
  const [draftText, setDraftText]   = useState('');
  const [draftCopied, setDraftCopied] = useState(false);
  const [draftSent, setDraftSent]   = useState(false);

  // ── Core assessment logic ─────────────────────────────────────────────────

  async function runAssessment() {
    setStatus('loading');
    setError(null);
    setResult(null);
    setDraftSent(false);
    try {
      const assessment = await generateWalletCaptureAssessment(client, confirmedPatterns);
      const matched    = getMatchedPatterns(client, confirmedPatterns);
      setResult(assessment);
      setMatchedPatterns(matched);
      setLastRun(new Date());
      setStatus('complete');
      setDraftText(assessment.suggestedAction);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setStatus('error');
    }
  }

  // ── Draft follow-up handlers ──────────────────────────────────────────────

  async function handleCopyDraft() {
    try {
      await navigator.clipboard.writeText(draftText);
      setDraftCopied(true);
      setTimeout(() => setDraftCopied(false), 2000);
    } catch { /* Clipboard unavailable */ }
  }

  const signalStyle = result ? (SIGNAL_STYLES[result.opportunitySignal] ?? SIGNAL_STYLES.none) : null;
  const hasPatterns = confirmedPatterns.length > 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wallet size={15} className="text-indigo-600" />
          <span className="text-sm font-semibold text-gray-800">Wallet Capture Opportunity</span>
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
              Scans interaction notes and life events for signals that the client may hold meaningful
              assets outside this firm — such as pending rollovers, inheritance proceeds, or business
              sale events.
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
            <span className="text-sm text-gray-600">Scanning for wallet capture signals…</span>
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

            {/* Evidence */}
            {result.opportunitySignal !== 'none' && (
              <p className="text-sm text-gray-700 leading-relaxed">{result.evidence}</p>
            )}

            {/* "none" clean state */}
            {result.opportunitySignal === 'none' && (
              <p className="text-sm text-gray-500 leading-relaxed">
                No explicit signals of externally-held assets found in interaction notes or life events.
                This is a normal outcome for clients whose documented activity does not reference outside accounts.
              </p>
            )}

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

            {/* Draft follow-up — always shown in complete state */}
            <div className="border-t border-gray-100 pt-3">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-xs font-semibold text-gray-700">Draft Follow-Up</span>
                <span className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded font-medium">
                  Draft only — no message will be sent
                </span>
              </div>

              {draftSent ? (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <Check size={14} className="text-emerald-600 flex-shrink-0" />
                  <p className="text-sm text-emerald-700 font-medium">Logged as sent by advisor.</p>
                </div>
              ) : (
                <>
                  <textarea
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    rows={3}
                    className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 resize-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-300 outline-none leading-relaxed"
                    placeholder="Suggested follow-up text…"
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleCopyDraft}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition-colors"
                    >
                      {draftCopied
                        ? <><Check size={12} className="text-emerald-500" /> Copied</>
                        : <><Copy size={12} /> Copy</>}
                    </button>
                    <button
                      onClick={() => setDraftSent(true)}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition-colors"
                    >
                      <Send size={12} />
                      Mark as Sent by Advisor
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1.5">
                    This is a draft only. No message will be sent automatically — the advisor takes the final action.
                  </p>
                </>
              )}
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
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
