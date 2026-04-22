import type { Agent, Session, SerializedState, Settings, UsageEvent } from '../types';
import { DEFAULT_SETTINGS } from '../types';

const MAX_EVENTS = 5000;
const MAX_SESSIONS = 100;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export class Store {
  private events: UsageEvent[] = [];
  private sessions: Map<string, Session> = new Map();
  private activeSessionIds: Partial<Record<Agent, string>> = {};
  private listeners: Array<() => void> = [];

  settings: Settings = { ...DEFAULT_SETTINGS };

  onDidChange(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify(): void {
    for (const l of this.listeners) {
      l();
    }
  }

  addEvent(event: UsageEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.shift();
    }
    this.notify();
  }

  getEventsInWindow(windowMs: number): UsageEvent[] {
    const cutoff = Date.now() - windowMs;
    return this.events.filter(e => e.timestamp >= cutoff);
  }

  upsertSession(session: Session): void {
    this.sessions.set(session.id, session);
    if (this.sessions.size > MAX_SESSIONS) {
      const oldest = [...this.sessions.values()].sort((a, b) => a.startTime - b.startTime)[0];
      this.sessions.delete(oldest.id);
    }
    this.notify();
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  getActiveSession(agent: Agent): Session | undefined {
    const id = this.activeSessionIds[agent];
    return id ? this.sessions.get(id) : undefined;
  }

  setActiveSession(agent: Agent, sessionId: string | undefined): void {
    if (sessionId === undefined) {
      delete this.activeSessionIds[agent];
    } else {
      this.activeSessionIds[agent] = sessionId;
    }
  }

  getAllSessions(): Session[] {
    return [...this.sessions.values()];
  }

  getRecentEvents(count: number): UsageEvent[] {
    return this.events.slice(-count).reverse();
  }

  serialize(): string {
    return JSON.stringify({
      events: this.events,
      sessions: [...this.sessions.values()],
      activeSessionIds: this.activeSessionIds,
      settings: this.settings,
    } satisfies SerializedState);
  }

  hydrate(json: string): void {
    if (!json) {
      return;
    }
    try {
      const data: SerializedState = JSON.parse(json);
      const cutoff = Date.now() - SEVEN_DAYS_MS;
      this.events = (data.events ?? []).filter(e => e.timestamp >= cutoff);
      this.sessions = new Map(
        (data.sessions ?? []).map(s => [s.id, s])
      );
      this.activeSessionIds = data.activeSessionIds ?? {};
      if (data.settings) {
        this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
      }
    } catch {
      // corrupted state — start fresh
    }
  }
}
