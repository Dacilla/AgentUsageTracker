export type Agent = 'claude' | 'codex';

export type ContextState = 'healthy' | 'busy' | 'heavy' | 'bloated';

export interface Session {
  id: string;
  agent: Agent;
  startTime: number;
  lastActivity: number;
  promptCount: number;
  turns: number;
  filesTouched: number;
  largeInputs: number;
  retries: number;
  contextScore: number;
  contextState: ContextState;
  workspace: string;
}

export interface UsageEvent {
  agent: Agent;
  timestamp: number;
  sessionId: string;
}

export interface Settings {
  max5h: number;
  max7d: number;
  contextThresholds: {
    busy: number;
    heavy: number;
    bloated: number;
  };
  inactivityTimeoutMinutes: number;
}

export const DEFAULT_SETTINGS: Settings = {
  max5h: 40,
  max7d: 200,
  contextThresholds: { busy: 50, heavy: 70, bloated: 85 },
  inactivityTimeoutMinutes: 30,
};

export interface SerializedState {
  events: UsageEvent[];
  sessions: Session[];
  activeSessionIds: Partial<Record<Agent, string>>;
  snoozedSessionIds: string[];
  settings: Settings;
}
