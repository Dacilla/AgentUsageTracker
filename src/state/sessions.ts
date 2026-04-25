import { randomUUID } from 'crypto';
import type { Agent, ContextState, Session } from '../types';
import type { Store } from './store';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeContextScore(session: Session): number {
  return clamp(
    session.turns * 2 +
    session.filesTouched * 3 +
    session.largeInputs * 5 +
    session.retries * 4,
    0,
    100
  );
}

export function contextStateFromScore(score: number, thresholds: { busy: number; heavy: number; bloated: number }): ContextState {
  if (score < thresholds.busy) { return 'healthy'; }
  if (score < thresholds.heavy) { return 'busy'; }
  if (score < thresholds.bloated) { return 'heavy'; }
  return 'bloated';
}

export function startSession(agent: Agent, workspace: string, store: Store): Session {
  const session: Session = {
    id: randomUUID(),
    agent,
    startTime: Date.now(),
    lastActivity: Date.now(),
    promptCount: 0,
    turns: 0,
    filesTouched: 0,
    largeInputs: 0,
    retries: 0,
    contextScore: 0,
    contextState: 'healthy',
    workspace,
  };
  store.setActiveSession(agent, session.id, false);
  store.upsertSession(session);
  return session;
}

export function recordPrompt(agent: Agent, store: Store, workspace = ''): void {
  maybeExpireSession(agent, store);

  let session = store.getActiveSession(agent);
  if (!session) {
    session = startSession(agent, workspace, store);
  }

  const now = Date.now();

  // Detect retries: two prompts within 30s
  const isRetry = now - session.lastActivity < 30_000 && session.turns > 0;

  const updated: Session = {
    ...session,
    lastActivity: now,
    promptCount: session.promptCount + 1,
    turns: session.turns + 1,
    retries: session.retries + (isRetry ? 1 : 0),
  };

  const score = computeContextScore(updated);
  updated.contextScore = score;
  updated.contextState = contextStateFromScore(score, store.settings.contextThresholds);

  store.upsertSession(updated);
  store.addEvent({ agent, timestamp: now, sessionId: updated.id });
}

export function maybeExpireSession(agent: Agent, store: Store): void {
  const session = store.getActiveSession(agent);
  if (!session) { return; }
  const timeoutMs = store.settings.inactivityTimeoutMinutes * 60 * 1000;
  if (Date.now() - session.lastActivity > timeoutMs) {
    store.setActiveSession(agent, undefined, false);
  }
}

export function resetSession(agent: Agent, store: Store, notify = true): void {
  store.setActiveSession(agent, undefined, notify);
}

export function startFreshSession(agent: Agent, workspace: string, store: Store): Session {
  resetSession(agent, store, false);
  return startSession(agent, workspace, store);
}

export function incrementFilesTouched(agent: Agent, store: Store): void {
  const session = store.getActiveSession(agent);
  if (!session) { return; }
  const updated = { ...session, filesTouched: session.filesTouched + 1 };
  updated.contextScore = computeContextScore(updated);
  updated.contextState = contextStateFromScore(updated.contextScore, store.settings.contextThresholds);
  store.upsertSession(updated);
}
