import type { Client, HealthScore, HealthColor } from '../types';
import { differenceInDays, parseISO } from 'date-fns';
import {
  HEALTH_CONTACT_GOOD_DAYS, HEALTH_CONTACT_OK_DAYS, HEALTH_CONTACT_POOR_DAYS,
  HEALTH_DRIFT_GOOD, HEALTH_DRIFT_OK, HEALTH_DRIFT_POOR,
  HEALTH_AI_OVERDUE_WARN, HEALTH_AI_OVERDUE_ALERT, HEALTH_AI_OVERDUE_CRITICAL,
  HEALTH_COLOR_RED_THRESHOLD, HEALTH_COLOR_AMBER_THRESHOLD,
} from './signalThresholds';

export function calculateHealthScore(client: Client): HealthScore {
  const today = new Date();

  // Recency (25pts)
  const daysSinceContact = differenceInDays(today, parseISO(client.lastContact));
  let recency = 0;
  if (daysSinceContact <= HEALTH_CONTACT_GOOD_DAYS) recency = 25;
  else if (daysSinceContact <= HEALTH_CONTACT_OK_DAYS) recency = 17;
  else if (daysSinceContact <= HEALTH_CONTACT_POOR_DAYS) recency = 8;
  else recency = 0;

  // Portfolio health (25pts) — max drift across all asset classes
  const maxDrift = Math.max(...client.allocation.map(a => Math.abs(a.current - a.target)));
  let portfolioHealth = 0;
  if (maxDrift <= HEALTH_DRIFT_GOOD) portfolioHealth = 25;
  else if (maxDrift <= HEALTH_DRIFT_OK) portfolioHealth = 17;
  else if (maxDrift <= HEALTH_DRIFT_POOR) portfolioHealth = 8;
  else portfolioHealth = 0;

  // Goal progress (25pts)
  const onTrackCount = client.goals.filter(g => g.onTrack).length;
  const goalProgress = client.goals.length > 0
    ? Math.round((onTrackCount / client.goals.length) * 25)
    : 25;

  // Action items (25pts) — use history when loaded (JSON mode / profile detail),
  // fall back to pre-computed count from the API list endpoint when history is empty.
  const overdueCount = client.history.length > 0
    ? client.history.flatMap(h =>
        h.actionItems.filter(ai => !ai.completed && differenceInDays(today, parseISO(ai.dueDate)) > 0)
      ).length
    : (client.contactStats?.openOverdueCommitments ?? 0);
  let actionItemScore = 25;
  if (overdueCount >= HEALTH_AI_OVERDUE_CRITICAL) actionItemScore = 0;
  else if (overdueCount >= HEALTH_AI_OVERDUE_ALERT) actionItemScore = 8;
  else if (overdueCount >= HEALTH_AI_OVERDUE_WARN) actionItemScore = 17;

  const total = recency + portfolioHealth + goalProgress + actionItemScore;

  let color: HealthColor = 'green';
  if (total < HEALTH_COLOR_RED_THRESHOLD) color = 'red';
  else if (total < HEALTH_COLOR_AMBER_THRESHOLD) color = 'amber';

  return { total, recency, portfolioHealth, goalProgress, actionItems: actionItemScore, color };
}

export function formatAUM(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  return `$${(value / 1000).toFixed(0)}K`;
}

export function formatDate(dateStr: string): string {
  const d = parseISO(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
