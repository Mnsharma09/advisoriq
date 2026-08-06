import type { Client, HealthScore, HealthColor } from '../types';
import { differenceInDays, parseISO } from 'date-fns';

export function calculateHealthScore(client: Client): HealthScore {
  const today = new Date();

  // Recency (25pts)
  const daysSinceContact = differenceInDays(today, parseISO(client.lastContact));
  let recency = 0;
  if (daysSinceContact <= 30) recency = 25;
  else if (daysSinceContact <= 60) recency = 17;
  else if (daysSinceContact <= 90) recency = 8;
  else recency = 0;

  // Portfolio health (25pts) — max drift across all asset classes
  const maxDrift = Math.max(...client.allocation.map(a => Math.abs(a.current - a.target)));
  let portfolioHealth = 0;
  if (maxDrift <= 3) portfolioHealth = 25;
  else if (maxDrift <= 6) portfolioHealth = 17;
  else if (maxDrift <= 10) portfolioHealth = 8;
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
  if (overdueCount === 1) actionItemScore = 17;
  else if (overdueCount === 2) actionItemScore = 8;
  else if (overdueCount >= 3) actionItemScore = 0;

  const total = recency + portfolioHealth + goalProgress + actionItemScore;

  let color: HealthColor = 'green';
  if (total < 50) color = 'red';
  else if (total < 75) color = 'amber';

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
