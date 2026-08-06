import { subMonths, parseISO, isAfter } from 'date-fns';
import type { Client, FamilyMember } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MemberEngagementStatusValue =
  | 'Engaged'
  | 'Not Recently Engaged'
  | 'Never Engaged';

export interface MemberEngagementStatus {
  member: FamilyMember;
  status: MemberEngagementStatusValue;
  lastMentionedDate?: string; // ISO date string of most recent mention
}

export interface HouseholdAlert {
  title: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
}

export interface HouseholdIntelligence {
  engagementScore: number;          // 0–100
  memberStatuses: MemberEngagementStatus[];
  alerts: HouseholdAlert[];         // max 4, only those triggered
  suggestedAction: string | null;   // one sentence, derived from highest-severity alert
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

/** Returns the first word of a full name. */
function firstName(fullName: string): string {
  return fullName.split(' ')[0];
}

/**
 * Case-insensitive check: does the family member's first name appear
 * as a substring anywhere in the given text?
 */
function isMentionedIn(memberName: string, text: string): boolean {
  return text.toLowerCase().includes(firstName(memberName).toLowerCase());
}

function isSpouseOrPartner(rel: string): boolean {
  return rel === 'Spouse' || rel === 'Partner';
}

/**
 * A family member qualifies as an "adult child" for heir-gap calculations
 * only when they have a known age > 18.
 */
function isAdultChild(m: FamilyMember): boolean {
  return (
    (m.relationship === 'Son' || m.relationship === 'Daughter') &&
    typeof m.age === 'number' &&
    m.age > 18
  );
}

// ─── Main Calculation ─────────────────────────────────────────────────────────

export function calculateHouseholdIntelligence(client: Client): HouseholdIntelligence {
  const now = new Date();
  const sixMonthsAgo = subMonths(now, 6);
  const ninetyDaysAgo = subMonths(now, 3);

  // ── Pre-compute: last mention date per family member ──────────────────────
  // Key = member.name, Value = ISO date string of most recent interaction
  // summary that contains their first name (case-insensitive), or undefined.
  const lastMentionMap = new Map<string, string | undefined>();

  for (const member of client.familyMembers) {
    let latestDate: string | undefined;
    for (const interaction of client.history) {
      if (isMentionedIn(member.name, interaction.summary)) {
        // ISO strings sort lexicographically, so plain string comparison works.
        if (!latestDate || interaction.date > latestDate) {
          latestDate = interaction.date;
        }
      }
    }
    lastMentionMap.set(member.name, latestDate);
  }

  // ── Member engagement statuses ────────────────────────────────────────────
  const memberStatuses: MemberEngagementStatus[] = client.familyMembers.map(
    (member) => {
      const lastDate = lastMentionMap.get(member.name);
      let status: MemberEngagementStatusValue;
      if (!lastDate) {
        status = 'Never Engaged';
      } else if (isAfter(parseISO(lastDate), sixMonthsAgo)) {
        status = 'Engaged';
      } else {
        status = 'Not Recently Engaged';
      }
      return { member, status, lastMentionedDate: lastDate };
    }
  );

  // ── Engagement score ──────────────────────────────────────────────────────
  let score = 100;

  // –20 if any Spouse/Partner not mentioned in the last 6 months
  const spouseOrPartner = client.familyMembers.find((m) =>
    isSpouseOrPartner(m.relationship)
  );
  if (spouseOrPartner) {
    const lastDate = lastMentionMap.get(spouseOrPartner.name);
    if (!lastDate || !isAfter(parseISO(lastDate), sixMonthsAgo)) {
      score -= 20;
    }
  }

  // –15 per adult child never mentioned anywhere in history (capped at –30)
  const adultChildren = client.familyMembers.filter(isAdultChild);
  let childDeduction = 0;
  for (const child of adultChildren) {
    if (!lastMentionMap.get(child.name)) {
      childDeduction += 15;
    }
  }
  score -= Math.min(childDeduction, 30);

  // –20 if client > 60 and any estate document is Missing or Needs Update
  if (client.age > 60 && client.estatePlan) {
    const hasProblematicDoc = client.estatePlan.documents.some(
      (d) => d.status === 'Missing' || d.status === 'Needs Update'
    );
    if (hasProblematicDoc) {
      score -= 20;
    }
  }

  // –15 if client > 60, at least one adult family member, and no upcoming
  //   meeting purpose mentions "family", "estate", or "transition"
  if (client.age > 60) {
    const hasAdultFamilyMember = client.familyMembers.some(
      (m) => typeof m.age === 'number' && m.age > 18
    );
    if (hasAdultFamilyMember) {
      const hasRelevantMeeting = client.upcomingMeetings.some((m) => {
        const p = m.purpose.toLowerCase();
        return (
          p.includes('family') ||
          p.includes('estate') ||
          p.includes('transition')
        );
      });
      if (!hasRelevantMeeting) {
        score -= 15;
      }
    }
  }

  score = Math.max(0, score);

  // ── Household risk alerts ─────────────────────────────────────────────────
  const alerts: HouseholdAlert[] = [];

  // HIGH: Heir Relationship Gap
  if (client.age > 60 && adultChildren.length > 0) {
    const neverMentioned = adultChildren.filter(
      (c) => !lastMentionMap.get(c.name)
    );
    if (neverMentioned.length > 0) {
      const nameList = neverMentioned.map((c) => c.name).join(', ');
      const verb = neverMentioned.length === 1 ? 'has' : 'have';
      alerts.push({
        title: 'Heir Relationship Gap',
        description: `${nameList} ${verb} never been mentioned in meeting history. At age ${client.age}, establishing heir relationships is critical for wealth transfer planning.`,
        severity: 'high',
      });
    }
  }

  // HIGH: Estate Documents Overdue (≥2 documents Missing or Needs Update)
  if (client.estatePlan) {
    const problemDocs = client.estatePlan.documents.filter(
      (d) => d.status === 'Missing' || d.status === 'Needs Update'
    );
    if (problemDocs.length >= 2) {
      const docList = problemDocs.map((d) => d.document).join(', ');
      alerts.push({
        title: 'Estate Documents Overdue',
        description: `${problemDocs.length} estate documents require immediate attention: ${docList}.`,
        severity: 'high',
      });
    }
  }

  // MEDIUM: Spouse/Partner not mentioned in last 90 days
  if (spouseOrPartner) {
    const lastDate = lastMentionMap.get(spouseOrPartner.name);
    if (!lastDate || !isAfter(parseISO(lastDate), ninetyDaysAgo)) {
      alerts.push({
        title: 'Spouse Not Recently Engaged',
        description: `${spouseOrPartner.name} (${spouseOrPartner.relationship}) has not been mentioned in any interaction in the last 90 days. Consider proactively involving them in upcoming conversations.`,
        severity: 'medium',
      });
    }
  }

  // MEDIUM: No multi-generational meeting scheduled (client > 58)
  if (client.age > 58) {
    const hasRelevantMeeting = client.upcomingMeetings.some((m) => {
      const p = m.purpose.toLowerCase();
      return (
        p.includes('family') ||
        p.includes('estate') ||
        p.includes('transition') ||
        p.includes('planning')
      );
    });
    if (!hasRelevantMeeting) {
      alerts.push({
        title: 'No Multi-Generational Meeting Scheduled',
        description: `No upcoming meeting addresses family, estate, or transition planning. Given ${firstName(client.name)}'s life stage, a multi-generational planning conversation is advisable.`,
        severity: 'medium',
      });
    }
  }

  // ── Suggested advisor action ───────────────────────────────────────────────
  // Derived from highest-severity triggered alert; no LLM call.
  let suggestedAction: string | null = null;

  const highAlerts = alerts.filter((a) => a.severity === 'high');
  const topAlert = highAlerts[0] ?? alerts[0] ?? null;

  if (topAlert) {
    if (topAlert.title === 'Heir Relationship Gap') {
      const neverMentioned = adultChildren.filter(
        (c) => !lastMentionMap.get(c.name)
      );
      const heirNames = neverMentioned
        .map((c) => firstName(c.name))
        .join(' and ');
      suggestedAction = `Schedule a dedicated wealth transfer conversation with ${firstName(client.name)} to introduce ${heirNames} into the planning process before the next annual review.`;
    } else if (topAlert.title === 'Estate Documents Overdue') {
      const count = client.estatePlan!.documents.filter(
        (d) => d.status === 'Missing' || d.status === 'Needs Update'
      ).length;
      suggestedAction = `Refer ${firstName(client.name)} to their estate attorney immediately to resolve ${count} outstanding estate documents before the next portfolio review meeting.`;
    } else if (topAlert.title === 'Spouse Not Recently Engaged') {
      suggestedAction = `Invite ${firstName(spouseOrPartner!.name)} to the next review meeting to ensure both household decision-makers are aligned on the financial plan and investment goals.`;
    } else if (topAlert.title === 'No Multi-Generational Meeting Scheduled') {
      const adultFamilyNames = client.familyMembers
        .filter(
          (m) =>
            typeof m.age === 'number' &&
            m.age > 18 &&
            !isSpouseOrPartner(m.relationship)
        )
        .map((m) => firstName(m.name))
        .slice(0, 2);
      const withNames =
        adultFamilyNames.length > 0
          ? ` and ${adultFamilyNames.join(', ')}`
          : '';
      suggestedAction = `Propose a family financial planning session with ${firstName(client.name)}${withNames} to align on estate, legacy, and wealth transition goals.`;
    }
  }

  return { engagementScore: score, memberStatuses, alerts, suggestedAction };
}

/**
 * Convenience export used by nbaEngine.ts.
 * Returns just the 0–100 household engagement score.
 */
export function calculateHouseholdEngagementScore(client: Client): number {
  return calculateHouseholdIntelligence(client).engagementScore;
}
