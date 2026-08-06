import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Mic, MicOff, PhoneOff, Sparkles, RefreshCw,
  CheckCheck, ClipboardList, Zap, AlertTriangle,
} from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { extractMeetingNotes, generateBrief } from '@/lib/claudeClient';
import { AiBadge } from '@/components/ui/AiBadge';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from '@/hooks/use-toast';
import type { Interaction, ActionItem, ExtractedMeetingData } from '@/types';
import transcriptsRaw from '@/data/transcripts.json';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TranscriptTurn {
  speaker: 'FA' | 'Client';
  text: string;
  timestamp: string;
}

interface TranscriptRecord {
  id: string;
  clientId: string;
  date: string;
  durationEstimate: string;
  turns: TranscriptTurn[];
}

const transcripts = transcriptsRaw as TranscriptRecord[];

// Playback interval between turns (ms)
const TURN_INTERVAL = 1800;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CallSession() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const clients = useAppStore((s) => s.clients);
  const addInteraction = useAppStore((s) => s.addInteraction);
  const apiKey = useAppStore((s) => s.claudeApiKey);

  const client = clients.find((c) => c.id === id);
  const transcript = transcripts.find((t) => t.clientId === id) ?? transcripts[0];

  useEffect(() => {
    document.title = client
      ? `AdvisorIQ — Call · ${client.name}`
      : 'AdvisorIQ — Call Session';
  }, [client]);

  // ── Playback state ──
  const [visibleCount, setVisibleCount] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0); // seconds
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clockIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // ── AI Suggestions state ──
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  // ── Detected signals state ──
  const [signals, setSignals] = useState<string[]>([]);

  // ── End-of-session state ──
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedMeetingData | null>(null);
  const [extractError, setExtractError] = useState('');
  const [saved, setSaved] = useState(false);

  const fullTurns = transcript.turns;

  // Auto-scroll to bottom as turns appear
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleCount]);

  // Playback tick
  useEffect(() => {
    if (isPlaying) {
      playIntervalRef.current = setInterval(() => {
        setVisibleCount((c) => {
          if (c >= fullTurns.length) {
            setIsPlaying(false);
            return c;
          }
          return c + 1;
        });
      }, TURN_INTERVAL);
    } else {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    }
    return () => { if (playIntervalRef.current) clearInterval(playIntervalRef.current); };
  }, [isPlaying, fullTurns.length]);

  // Clock tick while playing
  useEffect(() => {
    if (isPlaying) {
      clockIntervalRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else {
      if (clockIntervalRef.current) clearInterval(clockIntervalRef.current);
    }
    return () => { if (clockIntervalRef.current) clearInterval(clockIntervalRef.current); };
  }, [isPlaying]);

  const formatElapsed = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Generate AI suggestions from visible turns so far
  const handleGenerateSuggestions = useCallback(async () => {
    if (!apiKey || visibleCount === 0) return;
    setSuggestionsLoading(true);
    try {
      const visibleText = fullTurns.slice(0, visibleCount)
        .map((t) => `${t.speaker}: ${t.text}`)
        .join('\n');
      const prompt = `You are AdvisorIQ, an AI assistant listening to a live financial advisor call. Based on the conversation so far, provide EXACTLY 3 concise suggestions for what the advisor should say or ask next. Return only a JSON array of 3 short strings (each under 20 words). No other text.

Conversation so far:
${visibleText}`;
      const raw = await generateBrief(prompt);
      // Parse JSON array from response
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]) as string[];
        setSuggestions(parsed.slice(0, 3));
      }
      // Detect signals from last few turns
      const lastTurns = fullTurns.slice(Math.max(0, visibleCount - 4), visibleCount)
        .filter((t) => t.speaker === 'Client')
        .map((t) => t.text);
      if (lastTurns.length > 0) {
        const signalPrompt = `Extract 2-3 short client signals or emotional cues from these statements (e.g. "Expressed anxiety about market", "Mentioned life event"). Return only a JSON array of short strings.

${lastTurns.join('\n')}`;
        const signalRaw = await generateBrief(signalPrompt);
        const signalMatch = signalRaw.match(/\[[\s\S]*\]/);
        if (signalMatch) {
          const parsedSignals = JSON.parse(signalMatch[0]) as string[];
          setSignals((prev) => {
            const merged = [...new Set([...prev, ...parsedSignals])];
            return merged.slice(0, 6);
          });
        }
      }
    } catch {
      // Silently fail for suggestions
    } finally {
      setSuggestionsLoading(false);
    }
  }, [apiKey, visibleCount, fullTurns]);

  function handleEndSession() {
    setIsPlaying(false);
    setSessionEnded(true);
    // Show all remaining turns
    setVisibleCount(fullTurns.length);
  }

  async function handleExtractNotes() {
    setExtracting(true);
    setExtractError('');
    try {
      const fullText = fullTurns
        .map((t) => `${t.speaker}: ${t.text}`)
        .join('\n');
      const raw = await extractMeetingNotes(fullText);
      const data = JSON.parse(raw) as ExtractedMeetingData;
      setExtracted(data);
    } catch {
      setExtractError('Unable to extract notes. Check your API key in Settings or try again.');
    } finally {
      setExtracting(false);
    }
  }

  function handleSaveInteraction() {
    if (!extracted || !client) return;
    const newInteraction: Interaction = {
      id: `hist-${client.id}-${Date.now()}`,
      date: new Date().toISOString().split('T')[0],
      type: 'call',
      summary: Array.isArray(extracted.summary)
        ? extracted.summary.join(' ')
        : String(extracted.summary),
      actionItems: extracted.actionItems.map((ai, i): ActionItem => ({
        id: `ai-call-${Date.now()}-${i}`,
        description: ai.description,
        assignedTo: ai.assignedTo,
        dueDate: ai.suggestedDueDate,
        completed: false,
      })),
    };
    addInteraction(client.id, newInteraction);
    setSaved(true);
    toast({ title: 'Call saved', description: 'Interaction added to client history.' });
  }

  // ─── Not found ───────────────────────────────────────────────────────────────
  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <AlertTriangle size={32} className="text-gray-300" />
        <p className="text-gray-500">Client not found</p>
        <Button variant="outline" onClick={() => navigate('/clients')}>
          <ArrowLeft size={14} className="mr-1.5" /> All Clients
        </Button>
      </div>
    );
  }

  const visibleTurns = fullTurns.slice(0, visibleCount);
  const progress = fullTurns.length > 0 ? (visibleCount / fullTurns.length) * 100 : 0;

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white">
      {/* ── Top bar ── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 bg-gray-900 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/clients/${client.id}`)}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            <ArrowLeft size={14} /> {client.name}
          </button>
          <span className="text-gray-600">·</span>
          <div className="flex items-center gap-2">
            {isPlaying && !sessionEnded && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-red-400">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                LIVE
              </span>
            )}
            {!isPlaying && !sessionEnded && visibleCount > 0 && (
              <span className="text-xs text-amber-400 font-medium">Paused</span>
            )}
            {sessionEnded && (
              <span className="text-xs text-gray-400 font-medium">Session Ended</span>
            )}
            {!isPlaying && visibleCount === 0 && (
              <span className="text-xs text-gray-500">Ready</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-mono text-gray-400 tabular-nums">{formatElapsed(elapsed)}</span>
          <Badge variant="outline" className="text-xs border-gray-700 text-gray-400">
            {transcript.durationEstimate} · {transcript.date}
          </Badge>
          {!sessionEnded && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-gray-400 hover:text-white hover:bg-gray-700"
                onClick={() => setMuted((m) => !m)}
              >
                {muted ? <MicOff size={14} /> : <Mic size={14} />}
              </Button>
              <Button
                size="sm"
                className="h-8 bg-red-600 hover:bg-red-700 text-white"
                onClick={handleEndSession}
              >
                <PhoneOff size={13} className="mr-1.5" /> End Session
              </Button>
            </>
          )}
          {sessionEnded && (
            <span className="text-xs text-emerald-400 font-medium">
              {saved ? '✓ Saved to history' : 'Session complete'}
            </span>
          )}
        </div>
      </div>

      {/* ── Progress bar ── */}
      <div className="h-0.5 bg-gray-800 flex-shrink-0">
        <div
          className="h-0.5 bg-blue-500 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* ── Main layout ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Transcript pane ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Playback controls */}
          {!sessionEnded && (
            <div className="flex items-center gap-2 px-5 py-2.5 border-b border-gray-800 bg-gray-900/60 flex-shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-gray-300 hover:text-white hover:bg-gray-700"
                onClick={() => setVisibleCount(0)}
                disabled={isPlaying || visibleCount === 0}
              >
                ↺ Reset
              </Button>
              <Button
                size="sm"
                className={`h-7 text-xs ${isPlaying ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'} text-white`}
                onClick={() => setIsPlaying((p) => !p)}
                disabled={visibleCount >= fullTurns.length}
              >
                {isPlaying ? '⏸ Pause' : visibleCount === 0 ? '▶ Start' : '▶ Resume'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-gray-300 hover:text-white hover:bg-gray-700"
                onClick={() => setVisibleCount(fullTurns.length)}
                disabled={isPlaying}
              >
                ⏭ Show All
              </Button>
              <span className="text-xs text-gray-500 ml-2 tabular-nums">
                {visibleCount} / {fullTurns.length} turns
              </span>
            </div>
          )}

          {/* Transcript scroll area */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {visibleCount === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                <div className="w-12 h-12 rounded-full bg-blue-900/40 flex items-center justify-center">
                  <Mic size={20} className="text-blue-400" />
                </div>
                <p className="text-sm text-gray-400">Press Start to begin the simulated call</p>
                <p className="text-xs text-gray-600">
                  This is a simulated session using a pre-recorded transcript.
                </p>
              </div>
            )}

            {visibleTurns.map((turn, i) => {
              const isFA = turn.speaker === 'FA';
              return (
                <div
                  key={i}
                  className={`flex gap-3 items-start animate-in fade-in slide-in-from-bottom-1 duration-300 ${isFA ? 'flex-row-reverse' : ''}`}
                >
                  {/* Avatar */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${isFA ? 'bg-blue-900/60 text-blue-300' : 'bg-gray-700 text-gray-300'}`}>
                    {isFA ? 'FA' : getInitials(client.name)}
                  </div>
                  {/* Bubble */}
                  <div className={`max-w-[72%] ${isFA ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                    <div className={`text-xs font-medium ${isFA ? 'text-blue-400 text-right' : 'text-gray-400'}`}>
                      {isFA ? 'You (FA)' : client.name} · {turn.timestamp}
                    </div>
                    <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                      isFA
                        ? 'bg-blue-700/50 text-blue-50 rounded-tr-sm'
                        : 'bg-gray-800 text-gray-200 rounded-tl-sm'
                    }`}>
                      {turn.text}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Typing indicator */}
            {isPlaying && visibleCount < fullTurns.length && (
              <div className="flex gap-3 items-start">
                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs text-gray-300">{getInitials(client.name)}</span>
                </div>
                <div className="px-3.5 py-3 bg-gray-800 rounded-2xl rounded-tl-sm">
                  <div className="flex gap-1 items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={transcriptEndRef} />
          </div>
        </div>

        {/* ── Right sidebar ── */}
        <div className="w-80 border-l border-gray-800 bg-gray-900 flex flex-col overflow-hidden flex-shrink-0">
          <div className="flex-1 overflow-y-auto">

            {/* AI Suggestions */}
            <div className="p-4 border-b border-gray-800">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  <Sparkles size={13} className="text-blue-400" />
                  <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Live Suggestions</span>
                </div>
                {!apiKey ? (
                  <button
                    onClick={() => navigate('/settings')}
                    className="text-xs text-blue-400 underline"
                  >
                    Add API key
                  </button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs px-2 text-gray-400 hover:text-white hover:bg-gray-700"
                    onClick={handleGenerateSuggestions}
                    disabled={suggestionsLoading || visibleCount === 0}
                  >
                    <RefreshCw size={11} className={`mr-1 ${suggestionsLoading ? 'animate-spin' : ''}`} />
                    {suggestions.length > 0 ? 'Refresh' : 'Generate'}
                  </Button>
                )}
              </div>

              {suggestionsLoading && (
                <div className="space-y-2">
                  <Skeleton className="h-3 w-full bg-gray-700" />
                  <Skeleton className="h-3 w-5/6 bg-gray-700" />
                  <Skeleton className="h-3 w-full bg-gray-700" />
                </div>
              )}
              {suggestions.length === 0 && !suggestionsLoading && (
                <p className="text-xs text-gray-600 italic">
                  {visibleCount === 0
                    ? 'Start the session to enable suggestions.'
                    : apiKey
                    ? 'Click Generate to get AI suggestions.'
                    : 'Add a Claude API key in Settings.'}
                </p>
              )}
              {suggestions.length > 0 && !suggestionsLoading && (
                <div className="space-y-2">
                  {suggestions.map((s, i) => (
                    <div
                      key={i}
                      className="flex gap-2 p-2.5 bg-blue-950/50 border border-blue-900/50 rounded-lg cursor-pointer hover:bg-blue-900/40 transition-colors"
                    >
                      <Zap size={11} className="text-blue-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-blue-200 leading-relaxed">{s}</p>
                    </div>
                  ))}
                  <AiBadge />
                </div>
              )}
            </div>

            {/* Detected Signals */}
            <div className="p-4 border-b border-gray-800">
              <div className="flex items-center gap-1.5 mb-3">
                <Zap size={13} className="text-amber-400" />
                <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Client Signals</span>
              </div>
              {signals.length === 0 ? (
                <p className="text-xs text-gray-600 italic">Signals appear as the conversation progresses.</p>
              ) : (
                <ul className="space-y-1.5">
                  {signals.map((s, i) => (
                    <li key={i} className="flex gap-2 text-xs text-amber-200">
                      <span className="text-amber-500 flex-shrink-0">⚡</span>
                      <span className="leading-relaxed">{s}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Action Items (live) */}
            <div className="p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <ClipboardList size={13} className="text-emerald-400" />
                <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
                  Action Items {extracted ? `(${extracted.actionItems.length})` : ''}
                </span>
              </div>
              {!extracted && !sessionEnded && (
                <p className="text-xs text-gray-600 italic">Available after session ends.</p>
              )}
              {!extracted && sessionEnded && (
                <p className="text-xs text-gray-600 italic">Extract notes below to populate action items.</p>
              )}
              {extracted && (
                <ul className="space-y-2">
                  {extracted.actionItems.map((ai, i) => (
                    <li key={i} className="flex gap-2 text-xs">
                      <span className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center mt-0.5 ${saved ? 'bg-emerald-900/40 border-emerald-700' : 'border-gray-600'}`}>
                        {saved && <CheckCheck size={9} className="text-emerald-400" />}
                      </span>
                      <div>
                        <p className="text-gray-200 leading-relaxed">{ai.description}</p>
                        <p className="text-gray-500 mt-0.5">{ai.assignedTo} · {ai.suggestedDueDate}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* ── End-of-session footer ── */}
          {sessionEnded && (
            <div className="border-t border-gray-800 p-4 space-y-3 flex-shrink-0 bg-gray-900">
              {!extracted && !extracting && !extractError && (
                <>
                  <p className="text-xs text-gray-400">
                    {apiKey ? 'Extract meeting notes with Claude, then save to the client\'s history.' : 'Add a Claude API key in Settings to extract notes.'}
                  </p>
                  <Button
                    className="w-full h-8 text-xs bg-blue-600 hover:bg-blue-700"
                    onClick={handleExtractNotes}
                    disabled={!apiKey}
                  >
                    <Sparkles size={12} className="mr-1.5" /> Extract & Review Notes
                  </Button>
                  {!apiKey && (
                    <button onClick={() => navigate('/settings')} className="text-xs text-blue-400 underline w-full text-center">
                      Go to Settings
                    </button>
                  )}
                </>
              )}

              {extracting && (
                <div className="space-y-2">
                  <Skeleton className="h-3 w-full bg-gray-700" />
                  <Skeleton className="h-3 w-4/5 bg-gray-700" />
                  <Skeleton className="h-3 w-full bg-gray-700" />
                </div>
              )}

              {extractError && (
                <Alert variant="destructive" className="text-xs">
                  <AlertDescription>{extractError}</AlertDescription>
                </Alert>
              )}

              {extracted && !saved && (
                <div className="space-y-2">
                  <div className="p-2.5 bg-gray-800 rounded-lg text-xs text-gray-300 leading-relaxed max-h-32 overflow-y-auto">
                    <p className="font-semibold text-gray-400 mb-1">Summary</p>
                    {(Array.isArray(extracted.summary) ? extracted.summary : [extracted.summary]).map((s, i) => (
                      <p key={i} className="mb-0.5">• {s}</p>
                    ))}
                  </div>
                  <Button
                    className="w-full h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                    onClick={handleSaveInteraction}
                  >
                    <CheckCheck size={12} className="mr-1.5" /> Save to {client.name}'s History
                  </Button>
                </div>
              )}

              {saved && (
                <div className="flex flex-col items-center gap-1.5 py-2 text-center">
                  <CheckCheck size={18} className="text-emerald-400" />
                  <p className="text-xs text-emerald-400 font-medium">Saved to client history</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-gray-400 hover:text-white hover:bg-gray-700 mt-1"
                    onClick={() => navigate(`/clients/${client.id}?tab=history`)}
                  >
                    View in History →
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
