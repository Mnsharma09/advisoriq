import { differenceInDays, parseISO } from 'date-fns';
import type { Client } from '@/types';
import { calculateHouseholdEngagementScore } from './householdIntelligence';
import { calculateNBAScore } from './nbaEngine';

// ─── Public Types ─────────────────────────────────────────────────────────────

export type InsightSeverity = 'high' | 'medium' | 'info';

// ── 1. Cash Concentration ─────────────────────────────────────────────────────

export interface CashConcentrationClient {
  id: string;
  name: string;
  aum: number;
  cashPct: number;
  cashAmount: number;
}

export interface CashConcentrationAnalysis {
  clientsWithExcessCash: number;
  totalAUMWithExcessCash: number;
  totalCashIdle: number;
  headline: string;
  supportingDetail: string;
  topClients: CashConcentrationClient[];
  affectedClientIds: string[];
  severity: InsightSeverity;
}

// ── 2. Contact Gaps ───────────────────────────────────────────────────────────

export interface ContactGapTier {
  tier: string;
  clientCount: number;
  avgDaysSinceContact: number;
  flagged: boolean;
}

export interface ContactGapAnalysis {
  tiers: ContactGapTier[];
  flaggedTiers: ContactGapTier[];
  headline: string;
  supportingDetail: string;
  affectedClientIds: string[];
  severity: InsightSeverity;
}

// ── 3. Household Engagement Gap ───────────────────────────────────────────────

export interface HouseholdGapClient {
  id: string;
  name: string;
  aum: number;
  householdScore: number;
}

export interface HouseholdGapAnalysis {
  lowEngagementCount: number;
  totalAUMAtRisk: number;
  headline: string;
  supportingDetail: string;
  topClients: HouseholdGapClient[];
  affectedClientIds: string[];
  severity: InsightSeverity;
}

// ── 4. Estate Document Overdue ────────────────────────────────────────────────

export interface EstateDocumentOverdueType {
  documentName: string;
  overdueCount: number;
  affectedClientNames: string[];
  affectedClientIds: string[];
}

export interface EstateOverdueAnalysis {
  totalOverdueDocuments: number;
  byDocumentType: EstateDocumentOverdueType[];
  mostCommonType: EstateDocumentOverdueType | null;
  headline: string;
  supportingDetail: string;
  affectedClientIds: string[];
  severity: InsightSeverity;
}

// ── 5. Action Item Age ────────────────────────────────────────────────────────

export interface ActionItemAgeGroup {
  label: string;
  count: number;
}

export interface OverdueActionClient {
  id: string;
  name: string;
  overdueCount: number;
}

export interface ActionItemAgeAnalysis {
  groups: ActionItemAgeGroup[];
  overdueCount: number;        // items overdue > 30 days
  overdueClientCount: number;  // distinct clients with any >30d item
  headline: string;
  supportingDetail: string;
  topClients: OverdueActionClient[];
  affectedClientIds: string[];
  severity: InsightSeverity;
}

// ── 6. NBA Score Distribution ─────────────────────────────────────────────────

export interface NBADistributionBand {
  name: string;
  value: number;
  fill: string;
}

export interface NBADistributionAnalysis {
  bands: NBADistributionBand[];
  dominantUrgencyDriver: string;     // signal category name
  dominantDriverDescription: string; // human-readable insight sentence
  headline: string;
  supportingDetail: string;
  affectedClientIds: string[];       // Critical + High urgency client IDs
  severity: InsightSeverity;
}

// ── Root ──────────────────────────────────────────────────────────────────────

export interface CrossBookAnalysis {
  cashConcentration: CashConcentrationAnalysis;
  contactGaps: ContactGapAnalysis;
  householdGap: HouseholdGapAnalysis;
  estateOverdue: EstateOverdueAnalysis;
  actionItemAge: ActionItemAgeAnalysis;
  nbaDistribution: NBADistributionAnalysis;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtCompact(v: number): string {
  const abs = Math.abs(v);
  const prefix = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${prefix}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${prefix}$${Math.round(abs / 1_000)}K`;
  return `${prefix}$${Math.round(abs)}`;
}

// ─── Main Analysis ────────────────────────────────────────────────────────────

export function analyseBook(clients: Client[]): CrossBookAnalysis {
  const now = new Date();

  // ── 1. Cash Concentration ─────────────────────────────────────────────────
  const EXCESS_CASH_THRESHOLD = 15; // percent

  const cashScoredClients: CashConcentrationClient[] = clients.map((c) => {
    const cashAlloc = c.allocation.find((a) => a.assetClass === 'Cash');
    const cashPct = cashAlloc ? cashAlloc.current : 0;
    return { id: c.id, name: c.name, aum: c.aum, cashPct, cashAmount: c.aum * (cashPct / 100) };
  });

  const excessCashClients = cashScoredClients
    .filter((c) => c.cashPct > EXCESS_CASH_THRESHOLD)
    .sort((a, b) => b.cashAmount - a.cashAmount);

  const totalCashIdle = excessCashClients.reduce((s, c) => s + c.cashAmount, 0);
  const totalAUMWithExcessCash = excessCashClients.reduce((s, c) => s + Number(c.aum), 0);

  let cashHeadline: string;
  let cashDetail: string;
  let cashSeverity: InsightSeverity;

  if (excessCashClients.length === 0) {
    cashHeadline = 'No clients have excess cash concentration.';
    cashDetail = `All clients have cash allocations at or below ${EXCESS_CASH_THRESHOLD}%. No idle capital drag detected across the book.`;
    cashSeverity = 'info';
  } else {
    cashHeadline = `${excessCashClients.length} client${excessCashClients.length > 1 ? 's have' : ' has'} excess cash concentration. ${fmtCompact(totalCashIdle)} sitting idle across your book.`;
    cashDetail = `${excessCashClients.length} client${excessCashClients.length > 1 ? 's carry' : ' carries'} cash allocations above ${EXCESS_CASH_THRESHOLD}%, representing a total of ${fmtCompact(totalCashIdle)} in uninvested capital from ${fmtCompact(totalAUMWithExcessCash)} AUM.`;
    cashSeverity = excessCashClients.length >= 3 ? 'high' : 'medium';
  }

  const cashConcentration: CashConcentrationAnalysis = {
    clientsWithExcessCash: excessCashClients.length,
    totalAUMWithExcessCash,
    totalCashIdle,
    headline: cashHeadline,
    supportingDetail: cashDetail,
    topClients: excessCashClients.slice(0, 3),
    affectedClientIds: excessCashClients.map((c) => c.id),
    severity: cashSeverity,
  };

  // ── 2. Systematic Contact Gaps by Segment ─────────────────────────────────
  const CONTACT_THRESHOLD_DAYS = 45;

  const aumTiers: Array<{ label: string; min: number; max: number }> = [
    { label: 'Under $500K', min: 0, max: 500_000 },
    { label: '$500K–$1M',   min: 500_000, max: 1_000_000 },
    { label: 'Over $1M',    min: 1_000_000, max: Infinity },
  ];

  const contactTiers: ContactGapTier[] = aumTiers
    .map(({ label, min, max }) => {
      const tierClients = clients.filter((c) => c.aum >= min && c.aum < max);
      if (tierClients.length === 0) return null;
      const avgDays = Math.round(
        tierClients.reduce((s, c) => s + differenceInDays(now, parseISO(c.lastContact)), 0) /
          tierClients.length
      );
      return {
        tier: label,
        clientCount: tierClients.length,
        avgDaysSinceContact: avgDays,
        flagged: avgDays > CONTACT_THRESHOLD_DAYS,
      };
    })
    .filter((t): t is ContactGapTier => t !== null);

  const flaggedTiers = contactTiers.filter((t) => t.flagged);

  let contactHeadline: string;
  let contactDetail: string;
  let contactSeverity: InsightSeverity;

  if (flaggedTiers.length === 0) {
    contactHeadline = 'All AUM segments are within the 45-day contact cadence target.';
    contactDetail = 'No segments are averaging more than 45 days between contacts. Engagement is healthy across the book.';
    contactSeverity = 'info';
  } else {
    const worstFlagged = flaggedTiers.sort((a, b) => b.avgDaysSinceContact - a.avgDaysSinceContact)[0];
    contactHeadline = `Your ${worstFlagged.tier} clients have not been contacted in an average of ${worstFlagged.avgDaysSinceContact} days.`;
    contactDetail = `${flaggedTiers.length} AUM segment${flaggedTiers.length > 1 ? 's are' : ' is'} averaging more than ${CONTACT_THRESHOLD_DAYS} days between contacts: ${flaggedTiers.map((t) => `${t.tier} (${t.avgDaysSinceContact}d avg)`).join(', ')}.`;
    contactSeverity = worstFlagged.avgDaysSinceContact > 70 ? 'high' : 'medium';
  }

  // Collect IDs of clients in flagged tiers
  const flaggedTierLabels = new Set(flaggedTiers.map((t) => t.tier));
  const contactAffectedClientIds = clients
    .filter((c) => {
      const tier = aumTiers.find((t) => c.aum >= t.min && c.aum < t.max);
      return tier ? flaggedTierLabels.has(tier.label) : false;
    })
    .map((c) => c.id);

  const contactGaps: ContactGapAnalysis = {
    tiers: contactTiers,
    flaggedTiers,
    headline: contactHeadline,
    supportingDetail: contactDetail,
    affectedClientIds: contactAffectedClientIds,
    severity: contactSeverity,
  };

  // ── 3. Household Engagement Gap ───────────────────────────────────────────
  const HH_THRESHOLD = 50;

  const hhScoredClients: HouseholdGapClient[] = clients.map((c) => ({
    id: c.id,
    name: c.name,
    aum: c.aum,
    householdScore: calculateHouseholdEngagementScore(c),
  }));

  const lowHHClients = hhScoredClients
    .filter((c) => c.householdScore < HH_THRESHOLD)
    .sort((a, b) => b.aum - a.aum);

  const totalHHAUMAtRisk = lowHHClients.reduce((s, c) => s + Number(c.aum), 0);

  const householdGap: HouseholdGapAnalysis = {
    lowEngagementCount: lowHHClients.length,
    totalAUMAtRisk: totalHHAUMAtRisk,
    headline:
      lowHHClients.length === 0
        ? 'Household engagement is strong across your book.'
        : `${lowHHClients.length} client${lowHHClients.length > 1 ? 's have' : ' has'} low household engagement scores, representing ${fmtCompact(totalHHAUMAtRisk)} in AUM with elevated relationship continuity risk.`,
    supportingDetail:
      lowHHClients.length === 0
        ? 'No clients scored below 50 on the household engagement index. Family member relationships are well maintained.'
        : `Clients below the ${HH_THRESHOLD}/100 household engagement threshold have spouses, adult children, or estate documents that have not been actively engaged. These households are at higher risk of assets moving at a life transition event.`,
    topClients: lowHHClients.slice(0, 3),
    affectedClientIds: lowHHClients.map((c) => c.id),
    severity: lowHHClients.length >= 3 ? 'high' : lowHHClients.length > 0 ? 'medium' : 'info',
  };

  // ── 4. Estate Document Overdue Clustering ─────────────────────────────────
  // documentName → array of {id, name}
  const docOverdueMap = new Map<string, Array<{ id: string; name: string }>>();
  const estateAffectedIdSet = new Set<string>();

  for (const c of clients) {
    if (!c.estatePlan?.documents) continue;
    for (const doc of c.estatePlan.documents) {
      if (doc.status === 'Missing' || doc.status === 'Needs Update') {
        if (!docOverdueMap.has(doc.document)) docOverdueMap.set(doc.document, []);
        docOverdueMap.get(doc.document)!.push({ id: c.id, name: c.name });
        estateAffectedIdSet.add(c.id);
      }
    }
  }

  const byDocumentType: EstateDocumentOverdueType[] = [...docOverdueMap.entries()]
    .map(([documentName, clients]) => ({
      documentName,
      overdueCount: clients.length,
      affectedClientNames: clients.map((c) => c.name),
      affectedClientIds: clients.map((c) => c.id),
    }))
    .sort((a, b) => b.overdueCount - a.overdueCount);

  const mostCommonType = byDocumentType[0] ?? null;
  const totalOverdueDocs = byDocumentType.reduce((s, d) => s + d.overdueCount, 0);

  const estateOverdue: EstateOverdueAnalysis = {
    totalOverdueDocuments: totalOverdueDocs,
    byDocumentType,
    mostCommonType,
    headline:
      mostCommonType === null
        ? 'All estate documents are in place across your book.'
        : `The most commonly overdue document across your book is ${mostCommonType.documentName}, overdue for ${mostCommonType.overdueCount} client${mostCommonType.overdueCount > 1 ? 's' : ''}.`,
    supportingDetail:
      totalOverdueDocs === 0
        ? 'No missing or outdated estate documents detected. Estate planning is current across all clients.'
        : `${totalOverdueDocs} estate document${totalOverdueDocs > 1 ? 's' : ''} across ${byDocumentType.filter((d) => d.overdueCount > 0).length} document types are Missing or Needs Update. Rather than working through each client individually, you can batch outreach by document type for efficiency.`,
    affectedClientIds: [...estateAffectedIdSet],
    severity: totalOverdueDocs > 15 ? 'high' : totalOverdueDocs > 5 ? 'medium' : 'info',
  };

  // ── 5. Open Action Item Age Distribution ──────────────────────────────────
  let upcoming = 0;
  let within7 = 0;
  let days7to30 = 0;
  let over30 = 0;

  const clientOverdueMap = new Map<string, { id: string; name: string; count: number }>();

  for (const c of clients) {
    let clientOver30 = 0;
    for (const h of c.history) {
      for (const ai of h.actionItems) {
        if (ai.completed) continue;
        const daysOverdue = differenceInDays(now, parseISO(ai.dueDate));
        if (daysOverdue < 0) upcoming++;
        else if (daysOverdue <= 7) within7++;
        else if (daysOverdue <= 30) days7to30++;
        else { over30++; clientOver30++; }
      }
    }
    if (clientOver30 > 0) {
      clientOverdueMap.set(c.id, { id: c.id, name: c.name, count: clientOver30 });
    }
  }

  const overdueClients: OverdueActionClient[] = [...clientOverdueMap.values()]
    .sort((a, b) => b.count - a.count)
    .map((c) => ({ id: c.id, name: c.name, overdueCount: c.count }));

  const actionItemAge: ActionItemAgeAnalysis = {
    groups: [
      { label: 'Upcoming (not yet due)', count: upcoming },
      { label: '0–7 days overdue', count: within7 },
      { label: '7–30 days overdue', count: days7to30 },
      { label: '30+ days overdue', count: over30 },
    ],
    overdueCount: over30,
    overdueClientCount: overdueClients.length,
    headline:
      over30 === 0
        ? 'No action items are overdue by more than 30 days.'
        : `You have ${over30} action item${over30 > 1 ? 's' : ''} overdue by more than 30 days across ${overdueClients.length} client${overdueClients.length > 1 ? 's' : ''}.`,
    supportingDetail:
      over30 === 0
        ? 'All action items are being completed within 30 days of their due dates.'
        : `${over30} action item${over30 > 1 ? 's are' : ' is'} more than 30 days past their due date. These represent commitments made to clients that have not been fulfilled — each one is a relationship risk. ${overdueClients.length} clients are affected.`,
    topClients: overdueClients.slice(0, 3),
    affectedClientIds: overdueClients.map((c) => c.id),
    severity: over30 > 10 ? 'high' : over30 > 3 ? 'medium' : 'info',
  };

  // ── 6. NBA Score Distribution ─────────────────────────────────────────────
  type SignalKey = 'contact' | 'portfolio' | 'goals' | 'household' | 'lifeEvent';

  interface SignalMeta {
    key: SignalKey;
    maxScore: number;
    label: string;
    description: string;
  }

  const SIGNAL_META: SignalMeta[] = [
    { key: 'contact',   maxScore: 25, label: 'Contact',     description: 'contact frequency gaps' },
    { key: 'portfolio', maxScore: 20, label: 'Portfolio',   description: 'portfolio drift' },
    { key: 'goals',     maxScore: 20, label: 'Goals',       description: 'goal progress gaps' },
    { key: 'household', maxScore: 20, label: 'Household',   description: 'household engagement gaps' },
    { key: 'lifeEvent', maxScore: 15, label: 'Life Events', description: 'unaddressed life events' },
  ];

  // Accumulate average deficit per signal category
  const deficitAccum: Record<SignalKey, number> = {
    contact: 0, portfolio: 0, goals: 0, household: 0, lifeEvent: 0,
  };

  let criticalCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;
  const nbaPriorityClientIds: string[] = [];

  for (const client of clients) {
    const nba = calculateNBAScore(client);

    // Extract individual signal scores from the breakdown
    const breakdown = nba.scoreBreakdown;
    for (const factor of breakdown) {
      const sig = SIGNAL_META.find((s) => s.label === factor.name);
      if (sig) {
        deficitAccum[sig.key] += sig.maxScore - factor.score;
      }
    }

    if (nba.urgencyLevel === 'Critical') { criticalCount++; nbaPriorityClientIds.push(client.id); }
    else if (nba.urgencyLevel === 'High') { highCount++; nbaPriorityClientIds.push(client.id); }
    else if (nba.urgencyLevel === 'Medium') mediumCount++;
    else lowCount++;
  }

  // Find signal with highest average deficit
  const n = clients.length || 1;
  const avgDeficits = SIGNAL_META.map((s) => ({
    ...s,
    avgDeficit: deficitAccum[s.key] / n,
  })).sort((a, b) => b.avgDeficit - a.avgDeficit);

  const topDriver = avgDeficits[0];

  const nbaBands: NBADistributionBand[] = [
    { name: 'Critical', value: criticalCount, fill: '#ef4444' },
    { name: 'High',     value: highCount,     fill: '#f97316' },
    { name: 'Medium',   value: mediumCount,   fill: '#f59e0b' },
    { name: 'Low',      value: lowCount,      fill: '#22c55e' },
  ].filter((b) => b.value > 0);

  const criticalOrHigh = criticalCount + highCount;

  const nbaDistribution: NBADistributionAnalysis = {
    bands: nbaBands,
    dominantUrgencyDriver: topDriver.label,
    dominantDriverDescription: `Your most common urgency driver across the book is ${topDriver.description} (avg deficit ${topDriver.avgDeficit.toFixed(1)} pts from ${topDriver.maxScore}-pt max).`,
    headline: `${criticalOrHigh} client${criticalOrHigh !== 1 ? 's' : ''} require immediate or high-priority attention by the NBA engine.`,
    supportingDetail: `NBA urgency distribution: ${criticalCount} Critical, ${highCount} High, ${mediumCount} Medium, ${lowCount} Low. The dominant driver of low scores across your book is ${topDriver.description}.`,
    affectedClientIds: nbaPriorityClientIds,
    severity: criticalCount > 1 ? 'high' : criticalOrHigh > 2 ? 'medium' : 'info',
  };

  return {
    cashConcentration,
    contactGaps,
    householdGap,
    estateOverdue,
    actionItemAge,
    nbaDistribution,
  };
}
