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

export function App() {
  const [state, setState] = useState<SerializedState>(window.__initialState__);
  const [agentFilter, setAgentFilter] = useState<'all' | 'claude' | 'codex'>('all');

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

  const recentEvents = [...state.events]
    .reverse()
    .slice(0, 30)
    .filter(e => agentFilter === 'all' || e.agent === agentFilter);

  function handleReset(agent: 'claude' | 'codex') {
    vscode.postMessage({ type: 'resetSession', agent });
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
    </div>
  );
}
