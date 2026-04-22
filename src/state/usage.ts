import type { Agent } from '../types';
import type { Store } from './store';

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface WindowStats {
  total: number;
  byAgent: Record<Agent, number>;
}

export function getWindowStats(store: Store, windowMs: number): WindowStats {
  const events = store.getEventsInWindow(windowMs);
  const byAgent: Record<Agent, number> = { claude: 0, codex: 0 };
  for (const e of events) {
    byAgent[e.agent]++;
  }
  return { total: events.length, byAgent };
}

export function get5hStats(store: Store): WindowStats {
  return getWindowStats(store, FIVE_HOURS_MS);
}

export function get7dStats(store: Store): WindowStats {
  return getWindowStats(store, SEVEN_DAYS_MS);
}
