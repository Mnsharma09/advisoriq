import { useState } from 'react';
import {
  ClipboardList, Loader2, Copy, Check, ArrowRight,
  ChevronRight, AlertCircle, CheckCircle2, Minus,
} from 'lucide-react';
import type { Client } from '@/types';
import {
  generateAttritionAssessment,
  generateWalletCaptureAssessment,
  generateCrossSellAssessment,
  generateReferralAssessment,
  generateCrossSignalSynthesis,
  detectCrossSellGaps,
  rankBookOfWork,
  BOOK_OF_WORK_CLIENT_IDS,
  type AttritionAssessment,
  type WalletCaptureAssessment,
  type CrossSellAssessment,
  type ReferralAssessment,
  type CrossSignalSynthesisResult,
  type BookOfWorkClientResult,
} from '@/lib/claudeClient';
import { useAppStore } from '@/store/appStore';
import type { CallNotesSnapshot } from '@/store/appStore';

// ── Dollar-amount sanity check helpers ───────────────────────────────────────

/**
 * Extracts the largest dollar-like amount from free text.
 * Handles: $80M, $2.5M, $500K, $80,000,000, "$80 million", "80 million dollars".
 * Returns the raw number (not formatted), or null if none found.
 */
function extractLargestDollarAmount(text: string): number | null {
  const found: number[] = [];

  // Matches $80M, $2.5M, $500K, $1.2B, $80,000,000
  const dollarPattern = /\$\s*([\d,]+(?:\.\d+)?)\s*(trillion|billion|million|k|m|b|t)?/gi;
  let m: RegExpExecArray | null;
  while ((m = dollarPattern.exec(text)) !== null) {
    const raw = parseFloat(m[1].replace(/,/g, ''));
    if (isNaN(raw)) continue;
    const sfx = (m[2] ?? '').toLowerCase();
    const mult = sfx === 't' || sfx === 'trillion' ? 1e12
               : sfx === 'b' || sfx === 'billion'  ? 1e9
               : sfx === 'm' || sfx === 'million'  ? 1e6
               : sfx === 'k'                        ? 1e3
               : 1;
    found.push(raw * mult);
  }

  // Matches "80 million dollars", "1.5 billion dollars" without leading $
  const wordPattern = /\b([\d,]+(?:\.\d+)?)\s*(million|billion|trillion)\s*(?:dollars?)?/gi;
  while ((m = wordPattern.exec(text)) !== null) {
    const raw = parseFloat(m[1].replace(/,/g, ''));
    if (isNaN(raw)) continue;
    const sfx = m[2].toLowerCase();
    const mult = sfx === 'trillion' ? 1e12 : sfx === 'billion' ? 1e9 : 1e6;
    found.push(raw * mult);
  }

  return found.length > 0 ? Math.max(...found) : null;
}

function formatAmount(n: number): string {
  if (n >= 1e9) return `$${+(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${+(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

const AUM_CHECK_MIN = 50_000; // ignore amounts below $50K (e.g. "$500 lunch" mentions)

// ── Quick-fill texts ──────────────────────────────────────────────────────────

const QUICK_FILLS = [
  {
    label: 'Inheritance signal',
    text: "Client mentioned inheriting his father's investment portfolio, currently held at Schwab, hasn't decided what to do with it yet.",
  },
  {
    label: 'Vacation mention',
    text: "Client mentioned he's planning a nice vacation next month.",
  },
  {
    label: 'Spouse assets — no action',
    text: "Discussed consolidation of external assets with client. Client confirmed those are his wife's assets and she does not want them consolidated. No action wanted.",
  },
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

type AgentKey = 'attrition' | 'walletCapture' | 'crossSell' | 'referral';
type AgentStatus = 'pending' | 'running' | 'complete' | 'skipped' | 'error';

type AnyAssessment = AttritionAssessment | WalletCaptureAssessment | CrossSellAssessment | ReferralAssessment;

interface AgentSlot {
  status: AgentStatus;
  label: string;
  result: AnyAssessment | null;
  error: string | null;
}

type AllSlots = Record<AgentKey, AgentSlot>;

interface ChangeItem {
  agent: string;
  from: string | null;
  to: string;
  suggestedAction: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const AGENT_LABELS: Record<AgentKey, string> = {
  attrition:    'Attrition Risk',
  walletCapture: 'Wallet Capture',
  crossSell:    'Cross-Sell',
  referral:     'Referral',
};

const INITIAL_SLOTS: AllSlots = {
  attrition:    { status: 'pending', label: '', result: null, error: null },
  walletCapture: { status: 'pending', label: '', result: null, error: null },
  crossSell:    { status: 'pending', label: '', result: null, error: null },
  referral:     { status: 'pending', label: '', result: null, error: null },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function resultLabel(key: AgentKey, result: AnyAssessment): string {
  if (key === 'attrition') {
    const r = result as AttritionAssessment;
    return `${r.riskCategory} · ${r.confidence} confidence`;
  }
  if (key === 'walletCapture') {
    const r = result as WalletCaptureAssessment;
    return `${r.opportunitySignal} signal · ${r.confidence} confidence`;
  }
  if (key === 'crossSell') {
    const r = result as CrossSellAssessment;
    return `${r.opportunitySignal} signal · ${r.confidence} confidence`;
  }
  // referral
  const r = result as ReferralAssessment;
  return `${r.referralSignal} signal · ${r.confidence} confidence`;
}

function beforeLabelFromCache(
  key: AgentKey,
  cached: BookOfWorkClientResult | undefined,
): string | null {
  if (!cached) return null;
  if (key === 'attrition' && cached.attrition) {
    const a = cached.attrition;
    return `${a.riskCategory} · ${a.confidence} confidence`;
  }
  if (key === 'walletCapture' && cached.walletCapture) {
    const w = cached.walletCapture;
    return `${w.opportunitySignal} signal · ${w.confidence} confidence`;
  }
  return null;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  client: Client;
}

export function CallNotesPanel({ client }: Props) {
  const confirmedPatterns    = useAppStore((s) => s.confirmedPatterns);
  const apiKey               = useAppStore((s) => s.claudeApiKey);
  const addInteraction       = useAppStore((s) => s.addInteraction);
  const bookOfWorkResults    = useAppStore((s) => s.bookOfWorkResults);
  const setBookOfWorkResults = useAppStore((s) => s.setBookOfWorkResults);
  const setCallNotesResults  = useAppStore((s) => s.setCallNotesResults);

  const [notes, setNotes]           = useState('');
  const [phase, setPhase]           = useState<'idle' | 'processing' | 'done'>('idle');
  const [slots, setSlots]           = useState<AllSlots>(INITIAL_SLOTS);
  const [changes, setChanges]       = useState<ChangeItem[]>([]);
  const [draftText, setDraftText]   = useState('');
  const [draftCopied, setDraftCopied] = useState(false);
  const [draftSent, setDraftSent]   = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ noteAmount: number } | null>(null);

  const isBookOfWorkClient = BOOK_OF_WORK_CLIENT_IDS.includes(client.id);
  const canProcess = !!apiKey && notes.trim().length > 0 && phase !== 'processing';

  function patchSlot(key: AgentKey, patch: Partial<AgentSlot>) {
    setSlots(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function handleProcessClick() {
    if (!canProcess) return;
    const noteAmount = extractLargestDollarAmount(notes);
    if (noteAmount !== null && noteAmount >= AUM_CHECK_MIN) {
      const ratio = noteAmount / client.aum;
      if (ratio > 3 || ratio < 1 / 3) {
        setConfirmModal({ noteAmount });
        return;
      }
    }
    void processCallNotes();
  }

  async function processCallNotes() {
    if (!canProcess) return;

    const newInteraction = {
      id: `call-notes-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      type: 'call' as const,
      summary: notes.trim(),
      actionItems: [] as never[],
    };
    addInteraction(client.id, newInteraction);
    const updatedClient: Client = {
      ...client,
      history: [newInteraction, ...client.history],
    };

    const cached = bookOfWorkResults?.find(r => r.clientId === client.id);
    const hasCrossSellGaps   = detectCrossSellGaps(updatedClient).length > 0;
    const hasReferralHistory = (updatedClient.referralHistory ?? []).length > 0;

    setPhase('processing');
    setDraftSent(false);
    setChanges([]);
    setSlots({
      attrition:    { status: 'running',  label: 'Analyzing…',  result: null, error: null },
      walletCapture: { status: 'running', label: 'Analyzing…',  result: null, error: null },
      crossSell:    hasCrossSellGaps
        ? { status: 'running',  label: 'Analyzing…',                      result: null, error: null }
        : { status: 'skipped', label: 'No product gaps — skipped LLM',    result: null, error: null },
      referral:     hasReferralHistory
        ? { status: 'running',  label: 'Analyzing…',                      result: null, error: null }
        : { status: 'skipped', label: 'No referral history — skipped LLM', result: null, error: null },
    });

    const gathered: Partial<Record<AgentKey, AnyAssessment>> = {};

    async function runAgent<T extends AnyAssessment>(
      key: AgentKey,
      fn: () => Promise<T>,
    ): Promise<T | null> {
      if (key === 'crossSell'  && !hasCrossSellGaps)   return null;
      if (key === 'referral'   && !hasReferralHistory)  return null;
      try {
        const result = await fn();
        gathered[key] = result;
        patchSlot(key, { status: 'complete', result, label: resultLabel(key, result) });
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unexpected error';
        patchSlot(key, { status: 'error', error: msg, label: msg });
        return null;
      }
    }

    const [attritionResult, walletResult] = await Promise.all([
      runAgent('attrition',    () => generateAttritionAssessment(updatedClient, confirmedPatterns)),
      runAgent('walletCapture', () => generateWalletCaptureAssessment(updatedClient, confirmedPatterns)),
      runAgent('crossSell',    () => generateCrossSellAssessment(updatedClient)),
      runAgent('referral',     () => generateReferralAssessment(updatedClient)),
    ]);

    // ── Compute diff ──────────────────────────────────────────────────────────
    const computedChanges: ChangeItem[] = [];
    const agentKeys: AgentKey[] = ['attrition', 'walletCapture', 'crossSell', 'referral'];
    for (const key of agentKeys) {
      const r = gathered[key];
      if (!r) continue;
      const afterLabel  = resultLabel(key, r);
      const beforeLabel = beforeLabelFromCache(key, cached);
      // Include if: (a) before exists and differs, or (b) no before baseline (new result)
      if (beforeLabel === null || beforeLabel !== afterLabel) {
        computedChanges.push({
          agent: AGENT_LABELS[key],
          from:  beforeLabel,
          to:    afterLabel,
          suggestedAction: (r as { suggestedAction: string }).suggestedAction ?? '',
        });
      }
    }
    setChanges(computedChanges);

    // ── Draft follow-up — highest-signal agent ────────────────────────────────
    const draftPriority: AgentKey[] = ['walletCapture', 'attrition', 'crossSell', 'referral'];
    for (const key of draftPriority) {
      const r = gathered[key];
      if (r) {
        const action = (r as { suggestedAction: string }).suggestedAction;
        if (action) { setDraftText(action); break; }
      }
    }

    // ── Cross-signal synthesis (additive — runs after all 4 agents) ──────────
    const attrResult    = (gathered.attrition    as AttritionAssessment    | undefined) ?? null;
    const walletResult2 = (gathered.walletCapture as WalletCaptureAssessment | undefined) ?? null;
    const csResult      = (gathered.crossSell    as CrossSellAssessment    | undefined) ?? null;
    const refResult     = (gathered.referral     as ReferralAssessment     | undefined) ?? null;

    let crossSignalResult: CrossSignalSynthesisResult | null = null;
    try {
      crossSignalResult = await generateCrossSignalSynthesis(attrResult, walletResult2, csResult, refResult);
    } catch {
      // Synthesis failure is non-fatal — main agent results are already stored
    }

    // ── Sync individual agent cards via store ────────────────────────────────
    const snapshot: CallNotesSnapshot = {
      clientId:     updatedClient.id,
      attrition:    attrResult,
      walletCapture: walletResult2,
      crossSell:    csResult,
      referral:     refResult,
      crossSignal:  crossSignalResult,
    };
    setCallNotesResults(snapshot);

    // ── Book of Work patch ────────────────────────────────────────────────────
    if (
      isBookOfWorkClient &&
      bookOfWorkResults &&
      bookOfWorkResults.length > 0 &&
      (attritionResult || walletResult)
    ) {
      const patched = bookOfWorkResults.map(r => {
        if (r.clientId !== updatedClient.id) return r;
        return {
          ...r,
          ...(attritionResult ? { attrition: attritionResult } : {}),
          ...(walletResult    ? { walletCapture: walletResult } : {}),
        };
      });
      setBookOfWorkResults(rankBookOfWork(patched));
    }

    setPhase('done');
  }

  async function handleCopyDraft() {
    try {
      await navigator.clipboard.writeText(draftText);
      setDraftCopied(true);
      setTimeout(() => setDraftCopied(false), 2000);
    } catch { /* clipboard unavailable */ }
  }

  function handleReset() {
    setNotes('');
    setPhase('idle');
    setSlots(INITIAL_SLOTS);
    setChanges([]);
    setDraftText('');
    setDraftSent(false);
    setDraftCopied(false);
    setConfirmModal(null);
  }

  if (!apiKey) return null;

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/20 overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-indigo-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList size={15} className="text-indigo-600" />
          <span className="text-sm font-semibold text-gray-800">Call Notes</span>
          <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-medium">
            re-runs all 4 agents
          </span>
        </div>
        {phase === 'done' && (
          <button
            onClick={handleReset}
            className="text-[11px] text-indigo-600 hover:text-indigo-800 font-medium"
          >
            Process another
          </button>
        )}
      </div>

      {/* ── Input section ──────────────────────────────────────────────────── */}
      <div className="px-4 py-3 space-y-3">
        {/* Quick-fill buttons */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
            Quick fill (populates only — does not submit)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_FILLS.map((qf) => (
              <button
                key={qf.label}
                disabled={phase === 'processing'}
                onClick={() => setNotes(qf.text)}
                className="text-[11px] px-2.5 py-1 rounded-md border border-indigo-200 bg-white hover:bg-indigo-50 text-indigo-700 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {qf.label}
              </button>
            ))}
          </div>
        </div>

        {/* Textarea */}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={phase === 'processing'}
          rows={4}
          placeholder="Enter call notes — what did the client say? Life events, asset mentions, concerns, referral opportunities…"
          className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 resize-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-300 outline-none leading-relaxed bg-white disabled:bg-gray-50 disabled:text-gray-400"
        />

        {/* Process button */}
        <div className="flex items-center gap-3">
          <button
            disabled={!canProcess}
            onClick={handleProcessClick}
            className="flex items-center gap-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 px-3 py-1.5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {phase === 'processing'
              ? <Loader2 size={12} className="animate-spin" />
              : <ChevronRight size={12} />}
            {phase === 'processing' ? 'Processing…' : 'Process Call Notes'}
          </button>
          {isBookOfWorkClient && phase !== 'processing' && (
            <span className="text-[10px] text-indigo-500">
              ✓ Book of Work will update automatically
            </span>
          )}
        </div>
      </div>

      {/* ── Per-agent status ───────────────────────────────────────────────── */}
      {phase !== 'idle' && (
        <div className="border-t border-indigo-100 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
            Agent status
          </p>
          <div className="space-y-1.5">
            {(Object.entries(slots) as [AgentKey, AgentSlot][]).map(([key, slot]) => (
              <div key={key} className="flex items-center gap-2">
                <div className="w-4 flex-shrink-0 flex items-center justify-center">
                  {slot.status === 'running'  && <Loader2 size={13} className="text-indigo-500 animate-spin" />}
                  {slot.status === 'complete' && <CheckCircle2 size={13} className="text-emerald-500" />}
                  {slot.status === 'skipped'  && <Minus size={13} className="text-gray-400" />}
                  {slot.status === 'error'    && <AlertCircle size={13} className="text-red-400" />}
                  {slot.status === 'pending'  && <div className="w-3 h-3 rounded-full border border-gray-300" />}
                </div>
                <span className="text-xs font-medium text-gray-700 w-28 flex-shrink-0">
                  {AGENT_LABELS[key]}
                </span>
                <span className={`text-xs truncate ${
                  slot.status === 'running'  ? 'text-indigo-500' :
                  slot.status === 'complete' ? 'text-gray-600' :
                  slot.status === 'skipped'  ? 'text-gray-400 italic' :
                  slot.status === 'error'    ? 'text-red-500' : 'text-gray-400'
                }`}>
                  {slot.error ?? slot.label ?? '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── What Changed banner ────────────────────────────────────────────── */}
      {phase === 'done' && (
        <div className="border-t border-indigo-100 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
            What changed
          </p>
          {changes.length === 0 ? (
            <p className="text-xs text-gray-500 italic">
              No signal changes detected — all 4 agents returned the same assessment as before.
            </p>
          ) : (
            <div className="space-y-2">
              {changes.map((c, i) => (
                <div
                  key={i}
                  className="px-3 py-2 bg-white rounded-lg border border-indigo-100"
                >
                  <p className="text-xs font-semibold text-gray-700 mb-0.5">{c.agent}</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {c.from !== null ? (
                      <>
                        <span className="text-[11px] text-gray-400">{c.from}</span>
                        <ArrowRight size={11} className="text-gray-400 flex-shrink-0" />
                        <span className="text-[11px] font-semibold text-indigo-700">{c.to}</span>
                      </>
                    ) : (
                      <span className="text-[11px] font-semibold text-indigo-700">
                        {c.to}
                        <span className="font-normal text-gray-400 ml-1">(no prior baseline)</span>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── AUM sanity-check confirmation modal ───────────────────────────── */}
      {confirmModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-xl p-5 max-w-sm w-full mx-4 border border-amber-200">
            <div className="flex items-start gap-3 mb-4">
              <AlertCircle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-gray-800 mb-1.5">Dollar amount discrepancy</p>
                <p className="text-sm text-gray-600 leading-relaxed">
                  This note mentions{' '}
                  <span className="font-semibold text-gray-800">{formatAmount(confirmModal.noteAmount)}</span>
                  {' '}— this client's on-file AUM is{' '}
                  <span className="font-semibold text-gray-800">{formatAmount(client.aum)}</span>.
                  These differ by more than 3×.
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  The agents will flag any discrepancy in their evidence text. Continue anyway?
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmModal(null)}
                className="px-3 py-1.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setConfirmModal(null); void processCallNotes(); }}
                className="px-3 py-1.5 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors"
              >
                Continue anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Draft follow-up ────────────────────────────────────────────────── */}
      {phase === 'done' && draftText && (
        <div className="border-t border-indigo-100 px-4 py-3">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-xs font-semibold text-gray-700">Suggested Next Steps</span>
            <span className="text-[10px] bg-gray-100 text-gray-600 border border-gray-200 px-1.5 py-0.5 rounded font-medium">
              Internal — not client-facing
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
                className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 resize-none focus:ring-1 focus:ring-indigo-400 focus:border-indigo-300 outline-none leading-relaxed bg-white"
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
                  <Check size={12} />
                  Mark Complete
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1.5">
                Internal advisor action note. Review and edit before sharing anything with the client.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
