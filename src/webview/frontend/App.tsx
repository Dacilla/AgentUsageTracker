import { useEffect, useState } from 'react';
import { AgentCard } from './components/AgentCard';
import { EventList } from './components/EventList';
import { UsageBar } from './components/UsageBar';
import type { SerializedState, Session } from '../../types';

// acquireVsCodeApi() must be called exactly once at module scope.
declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

declare global {
  interface Window {
    __initialState__: SerializedState;
  }
}

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function computeWindowStats(events: SerializedState['events'], windowMs: number) {
  const cutoff = Date.now() - windowMs;
  const filtered = events.filter(e => e.timestamp >= cutoff);
  return {
    total: filtered.length,
    claude: filtered.filter(e => e.agent === 'claude').length,
    codex: filtered.filter(e => e.agent === 'codex').length,
  };
}

function getActiveSession(state: SerializedState, agent: 'claude' | 'codex'): Session | undefined {
  const id = state.activeSessionIds[agent];
  if (!id) { return undefined; }
  return state.sessions.find(s => s.id === id);
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) { return 'just now'; }
  if (min < 60) { return `${min}m ago`; }
  const hr = Math.floor(min / 60);
  if (hr < 24) { return `${hr}h ago`; }
  return `${Math.floor(hr / 24)}d ago`;
}

export function App() {
  const [state, setState] = useState<SerializedState>(window.__initialState__);
  const [agentFilter, setAgentFilter] = useState<'all' | 'claude' | 'codex'>('all');
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();

  useEffect(() => {
    const handler = (e: MessageEvent<{ type: string; payload: SerializedState }>) => {
      if (e.data.type === 'stateUpdate') {
        setState(e.data.payload);
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'requestState' });
    return () => window.removeEventListener('message', handler);
  }, []);

  const stats5h = computeWindowStats(state.events, FIVE_HOURS_MS);
  const stats7d = computeWindowStats(state.events, SEVEN_DAYS_MS);
  const { max5h, max7d } = state.settings;

  const claudeSession = getActiveSession(state, 'claude');
  const codexSession = getActiveSession(state, 'codex');
  const filteredSessions = [...state.sessions]
    .filter(session => agentFilter === 'all' || session.agent === agentFilter)
    .sort((a, b) => b.lastActivity - a.lastActivity);
  const defaultSessionId =
    (agentFilter === 'claude' ? claudeSession?.id : undefined) ??
    (agentFilter === 'codex' ? codexSession?.id : undefined) ??
    claudeSession?.id ??
    codexSession?.id ??
    filteredSessions[0]?.id;
  const selectedSession = filteredSessions.find(session => session.id === selectedSessionId)
    ?? filteredSessions.find(session => session.id === defaultSessionId)
    ?? filteredSessions[0];
  const selectedSessionIsActive = selectedSession
    ? state.activeSessionIds[selectedSession.agent] === selectedSession.id
    : false;
  const selectedSessionIsSnoozed = selectedSession
    ? state.snoozedSessionIds.includes(selectedSession.id)
    : false;
  const selectedSessionCanSnooze = selectedSession?.contextState === 'heavy' || selectedSession?.contextState === 'bloated';

  const recentEvents = [...state.events]
    .reverse()
    .slice(0, 30)
    .filter(e => agentFilter === 'all' || e.agent === agentFilter);

  useEffect(() => {
    if (!selectedSession) {
      if (selectedSessionId !== undefined) {
        setSelectedSessionId(undefined);
      }
      return;
    }

    if (selectedSession.id !== selectedSessionId) {
      setSelectedSessionId(selectedSession.id);
    }
  }, [selectedSession, selectedSessionId]);

  function handleReset(agent: 'claude' | 'codex') {
    vscode.postMessage({ type: 'resetSession', agent });
  }

  function handleSnooze(sessionId: string) {
    vscode.postMessage({ type: 'snoozeWarning', sessionId });
  }

  return (
    <div className="dashboard">
      <div className="header">
        <h1>Agent Usage</h1>
        <div className="filter-group">
          {(['all', 'claude', 'codex'] as const).map(f => (
            <button
              key={f}
              className={`filter-btn${agentFilter === f ? ' active' : ''}`}
              onClick={() => setAgentFilter(f)}
            >
              {f === 'all' ? 'All' : f === 'claude' ? 'Claude' : 'Codex'}
            </button>
          ))}
        </div>
      </div>

      <div className="hero-row">
        <div className="card">
          <div className="card-title">5-Hour Window</div>
          <div className="card-value">{agentFilter === 'claude' ? stats5h.claude : agentFilter === 'codex' ? stats5h.codex : stats5h.total}</div>
          <UsageBar label="" value={agentFilter === 'claude' ? stats5h.claude : agentFilter === 'codex' ? stats5h.codex : stats5h.total} max={max5h} />
        </div>
        <div className="card">
          <div className="card-title">7-Day Window</div>
          <div className="card-value">{agentFilter === 'claude' ? stats7d.claude : agentFilter === 'codex' ? stats7d.codex : stats7d.total}</div>
          <UsageBar label="" value={agentFilter === 'claude' ? stats7d.claude : agentFilter === 'codex' ? stats7d.codex : stats7d.total} max={max7d} />
        </div>
        <div className="card">
          <div className="card-title">Context Health</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {claudeSession && (agentFilter === 'all' || agentFilter === 'claude') && (
              <span className={`state-badge state-${claudeSession.contextState}`}>Claude: {claudeSession.contextState}</span>
            )}
            {codexSession && (agentFilter === 'all' || agentFilter === 'codex') && (
              <span className={`state-badge state-${codexSession.contextState}`}>Codex: {codexSession.contextState}</span>
            )}
            {!claudeSession && !codexSession && (
              <span className="state-badge state-healthy">No active sessions</span>
            )}
          </div>
        </div>
      </div>

      {(agentFilter === 'all' || agentFilter === 'claude' || agentFilter === 'codex') && (
        <div className={agentFilter === 'all' ? 'agents-row' : ''}>
          {(agentFilter === 'all' || agentFilter === 'claude') && (
            <AgentCard
              name="Claude Code"
              count5h={stats5h.claude}
              max5h={max5h}
              count7d={stats7d.claude}
              max7d={max7d}
              session={claudeSession}
              onReset={() => handleReset('claude')}
            />
          )}
          {(agentFilter === 'all' || agentFilter === 'codex') && (
            <AgentCard
              name="Codex"
              count5h={stats5h.codex}
              max5h={max5h}
              count7d={stats7d.codex}
              max7d={max7d}
              session={codexSession}
              onReset={() => handleReset('codex')}
            />
          )}
        </div>
      )}

      <div>
        <div className="section-title">Recent Activity</div>
        <EventList events={recentEvents} />
      </div>

      <div>
        <div className="section-title">Session Inspector</div>
        {filteredSessions.length > 0 ? (
          <div className="session-inspector">
            <div className="session-selector">
              {filteredSessions.slice(0, 8).map(session => {
                const isActive = state.activeSessionIds[session.agent] === session.id;
                const isSelected = selectedSession?.id === session.id;
                const isSnoozed = state.snoozedSessionIds.includes(session.id);
                return (
                  <button
                    key={session.id}
                    className={`session-chip${isSelected ? ' selected' : ''}`}
                    onClick={() => setSelectedSessionId(session.id)}
                  >
                    <span>{session.agent === 'claude' ? 'Claude' : 'Codex'}</span>
                    <span>{session.contextState}</span>
                    <span>{relativeTime(session.lastActivity)}</span>
                    {isActive && <span>active</span>}
                    {isSnoozed && <span>snoozed</span>}
                  </button>
                );
              })}
            </div>

            {selectedSession && (
              <div className="card session-detail-card">
                <div className="session-detail-header">
                  <div>
                    <div className="card-title">Selected Session</div>
                    <div className="session-detail-title">
                      {selectedSession.agent === 'claude' ? 'Claude' : 'Codex'}
                      {selectedSessionIsActive && <span className="state-badge state-healthy">Active</span>}
                      {selectedSessionIsSnoozed && <span className="state-badge state-busy">Snoozed</span>}
                    </div>
                  </div>
                  <div className="session-actions">
                    {selectedSessionIsActive && (
                      <button className="action-btn secondary" onClick={() => handleReset(selectedSession.agent)}>
                        Reset Session
                      </button>
                    )}
                    {selectedSessionCanSnooze && (
                      <button className="action-btn" onClick={() => handleSnooze(selectedSession.id)}>
                        {selectedSessionIsSnoozed ? 'Restore Warning' : 'Snooze Warning'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="session-metrics">
                  <div><span>Workspace</span><strong>{selectedSession.workspace || 'Unknown workspace'}</strong></div>
                  <div><span>Started</span><strong>{relativeTime(selectedSession.startTime)}</strong></div>
                  <div><span>Last activity</span><strong>{relativeTime(selectedSession.lastActivity)}</strong></div>
                  <div><span>Prompts</span><strong>{selectedSession.promptCount}</strong></div>
                  <div><span>Turns</span><strong>{selectedSession.turns}</strong></div>
                  <div><span>Files touched</span><strong>{selectedSession.filesTouched}</strong></div>
                  <div><span>Retries</span><strong>{selectedSession.retries}</strong></div>
                  <div><span>Large inputs</span><strong>{selectedSession.largeInputs}</strong></div>
                </div>

                <div className="session-context-row">
                  <UsageBar label="Context score" value={selectedSession.contextScore} max={100} />
                  <span className={`state-badge state-${selectedSession.contextState}`}>
                    {selectedSession.contextState}
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="empty-note">No sessions available for this filter.</div>
        )}
      </div>
    </div>
  );
}
