import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Client, NewsItem, AISuggestion, Interaction, ActionItem, SavedScenario, UpcomingMeeting } from '../types';
import type {
  ConfirmedPatternWithSpec,
  BookOfWorkClientResult,
  AttritionAssessment,
  WalletCaptureAssessment,
  CrossSellAssessment,
  ReferralAssessment,
  CrossSignalSynthesisResult,
} from '../lib/claudeClient';

export interface CallNotesSnapshot {
  clientId: string;
  attrition:    AttritionAssessment    | null;
  walletCapture: WalletCaptureAssessment | null;
  crossSell:    CrossSellAssessment    | null;
  referral:     ReferralAssessment     | null;
  crossSignal:  CrossSignalSynthesisResult | null;
}
import newsData from '../data/news.json';
import { loadSyntheticClients, enrichClientsWithHistory } from '../lib/syntheticDataLoader';

interface AppState {
  faName: string;
  clients: Client[];
  news: NewsItem[];
  claudeApiKey: string;
  isLoadingClients: boolean;
  // Session-only — not persisted. Populated when Pattern Discovery completes.
  confirmedPatterns: ConfirmedPatternWithSpec[];
  // Session-only — not persisted. Populated when Book of Work analysis runs.
  bookOfWorkResults: BookOfWorkClientResult[] | null;
  // Session-only — not persisted. Most recent Call Notes run result, used to sync card displays.
  callNotesResults: CallNotesSnapshot | null;

  setFaName: (name: string) => void;
  setClaudeApiKey: (key: string) => void;
  setConfirmedPatterns: (patterns: ConfirmedPatternWithSpec[]) => void;
  setBookOfWorkResults: (results: BookOfWorkClientResult[] | null) => void;
  setCallNotesResults: (results: CallNotesSnapshot | null) => void;
  loadSyntheticData: () => Promise<void>;
  updateClientSuggestions: (clientId: string, suggestions: AISuggestion[]) => void;
  addInteraction: (clientId: string, interaction: Interaction) => void;
  toggleActionItem: (clientId: string, historyId: string, actionItemId: string) => void;
  resetToSeedData: () => void;
  updateActionItemCompletion: (clientId: string, historyId: string, itemId: string, completed: boolean) => void;
  addActionItemToInteraction: (clientId: string, historyId: string, item: ActionItem) => void;
  updateClientSavedScenarios: (clientId: string, scenarios: SavedScenario[]) => void;
  addUpcomingMeeting: (clientId: string, meeting: UpcomingMeeting) => void;
}

const seedNews = newsData as NewsItem[];

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      faName: 'Alex Morgan',
      clients: [],
      news: seedNews,
      claudeApiKey: '',
      isLoadingClients: false,
      confirmedPatterns: [],
      bookOfWorkResults: null,
      callNotesResults: null,

      setFaName: (name) => set({ faName: name }),
      setConfirmedPatterns: (patterns) => set({ confirmedPatterns: patterns }),
      setBookOfWorkResults: (results) => set({ bookOfWorkResults: results }),
      setCallNotesResults: (results) => set({ callNotesResults: results }),

      setClaudeApiKey: (key) => {
        localStorage.setItem('claudeApiKey', key);
        set({ claudeApiKey: key });
      },

      loadSyntheticData: async () => {
        // Skip if clients are loaded AND at least some have history/lifeEvents populated.
        // If every cached client has both empty (API-mode shaped), fall through to re-fetch
        // and supplement from JSON files so AI assessments have real data to work from.
        const cached = get().clients;
        if (cached.length > 0) {
          const sample = cached.slice(0, 10);
          const hasRealData = sample.some(c => c.history.length > 0 || c.lifeEvents.length > 0);
          if (hasRealData) {
            // Clients may have been cached before productHoldings or referralHistory were
            // added to the schema. Enrich in-place without a full reload.
            const hasHoldings  = sample.some(c => (c.productHoldings ?? []).length > 0);
            // referralHistory=undefined means pre-schema; []=valid empty (client has no referrals)
            const hasReferrals = sample.every(c => c.referralHistory !== undefined);
            // Check if meeting seed has been applied (any seeded client has meetings)
            const SEEDED_IDS = ['C0001','C0008','C0027'];
            const hasMeetings = SEEDED_IDS.some(id => {
              const c = cached.find(cl => cl.id === id);
              return c && c.upcomingMeetings.length > 0;
            });
            if (!hasHoldings || !hasReferrals || !hasMeetings) {
              console.info('[AdvisorIQ] Cached clients missing productHoldings, referralHistory, or meeting seed — supplementing from JSON.');
              const enriched = await enrichClientsWithHistory(cached);
              set({ clients: enriched });
            }
            return;
          }
          console.warn('[AdvisorIQ] Cached clients missing history/lifeEvents — re-fetching and supplementing from JSON.');
        }
        set({ isLoadingClients: true });
        try {
          const clients = await loadSyntheticClients();
          // enrichClientsWithHistory fetches interactions.json + life_events.json and
          // fills in any empty history/lifeEvents arrays (no-op if already populated).
          const enriched = await enrichClientsWithHistory(clients);
          set({ clients: enriched, isLoadingClients: false });
        } catch (err) {
          console.error('[AdvisorIQ] Failed to load synthetic clients:', err);
          set({ isLoadingClients: false });
        }
      },

      updateClientSuggestions: (clientId, suggestions) =>
        set((state) => ({
          clients: state.clients.map((c) =>
            c.id === clientId ? { ...c, aiSuggestions: suggestions } : c
          ),
        })),

      addInteraction: (clientId, interaction) =>
        set((state) => ({
          clients: state.clients.map((c) =>
            c.id === clientId
              ? { ...c, history: [interaction, ...c.history], lastContact: interaction.date }
              : c
          ),
        })),

      toggleActionItem: (clientId, historyId, actionItemId) =>
        set((state) => ({
          clients: state.clients.map((c) =>
            c.id !== clientId
              ? c
              : {
                  ...c,
                  history: c.history.map((h) =>
                    h.id !== historyId
                      ? h
                      : {
                          ...h,
                          actionItems: h.actionItems.map((ai) =>
                            ai.id === actionItemId ? { ...ai, completed: !ai.completed } : ai
                          ),
                        }
                  ),
                }
          ),
        })),

      updateActionItemCompletion: (clientId, historyId, itemId, completed) =>
        set((state) => ({
          clients: state.clients.map((c) =>
            c.id !== clientId
              ? c
              : {
                  ...c,
                  history: c.history.map((h) =>
                    h.id !== historyId
                      ? h
                      : {
                          ...h,
                          actionItems: h.actionItems.map((ai) =>
                            ai.id === itemId ? { ...ai, completed } : ai
                          ),
                        }
                  ),
                }
          ),
        })),

      addActionItemToInteraction: (clientId, historyId, item) =>
        set((state) => ({
          clients: state.clients.map((c) =>
            c.id !== clientId
              ? c
              : {
                  ...c,
                  history: c.history.map((h) =>
                    h.id !== historyId
                      ? h
                      : { ...h, actionItems: [...h.actionItems, item] }
                  ),
                }
          ),
        })),

      updateClientSavedScenarios: (clientId, scenarios) =>
        set((state) => ({
          clients: state.clients.map((c) =>
            c.id === clientId ? { ...c, savedScenarios: scenarios } : c
          ),
        })),

      addUpcomingMeeting: (clientId, meeting) =>
        set((state) => ({
          clients: state.clients.map((c) =>
            c.id === clientId
              ? { ...c, upcomingMeetings: [...c.upcomingMeetings, meeting] }
              : c
          ),
        })),

      resetToSeedData: () => {
        // Clear clients so loadSyntheticData will re-fetch on next call
        set({ faName: 'Alex Morgan', clients: [], news: seedNews, claudeApiKey: '' });
        get().loadSyntheticData();
      },
    }),
    {
      name: 'advisoriq-store',
      // Version 9: recompute lastContact from days_since_last_contact × DEMO_ANCHOR_DATE
      // instead of using raw last_contact_date (stale June 2026 generation dates).
      version: 9,
      migrate: (persistedState, fromVersion) => {
        const old = persistedState as {
          faName?: string;
          claudeApiKey?: string;
          clients?: Array<Record<string, unknown>>;
        };

        let clients: Client[];
        if (fromVersion >= 3 && fromVersion < 6) {
          // v3–v5: keep clients only if at least some have real history/lifeEvents.
          // If every cached client is API-mode-shaped (empty arrays), clear the cache
          // so loadSyntheticData will do a fresh JSON load on next mount.
          const raw = old.clients ?? [];
          const hasRealData = raw.some(
            (c) =>
              Array.isArray(c.history)    && (c.history    as unknown[]).length > 0 ||
              Array.isArray(c.lifeEvents) && (c.lifeEvents as unknown[]).length > 0,
          );
          clients = hasRealData
            ? raw.map((c) => ({ ...c, aum: Number(c.aum ?? 0), performanceData: [] } as unknown as Client))
            : []; // force re-fetch
        } else if (fromVersion === 6) {
          // v6→v7: clear clients so loadSyntheticData does a fresh JSON load that
          // correctly populates familyMembers (households.json) and performanceData
          // (18 monthly snapshots). The v6 migration had zeroed performanceData and
          // household loading was not yet part of the enrichment path.
          clients = [];
        } else if (fromVersion === 7 || fromVersion === 8) {
          // v7→v8: clear so lastContact is computed via DEMO_ANCHOR_DATE.
          // v8→v9: clear again — v8 still used raw last_contact_date (stale June 2026 dates).
          clients = [];
        } else if (fromVersion >= 9) {
          // Already on v9+ — keep as-is (coerce aum for safety).
          clients = (old.clients ?? []).map(
            (c) => ({ ...c, aum: Number(c.aum ?? 0) } as unknown as Client),
          );
        } else {
          // v0–v2: incompatible shape — clear and re-fetch.
          clients = [];
        }

        return {
          faName: old.faName ?? 'Alex Morgan',
          clients,
          news: seedNews,
          claudeApiKey: old.claudeApiKey ?? '',
          isLoadingClients: false,
        };
      },
      partialize: (state) => ({
        faName: state.faName,
        clients: state.clients,
        claudeApiKey: state.claudeApiKey,
      }),
    }
  )
);
