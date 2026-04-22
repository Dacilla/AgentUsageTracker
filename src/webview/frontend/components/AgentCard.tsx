import { UsageBar } from './UsageBar';
import { ContextMeter } from './ContextMeter';
import type { Session } from '../../../types';

interface AgentCardProps {
  name: string;
  count5h: number;
  max5h: number;
  count7d: number;
  max7d: number;
  session: Session | undefined;
  onReset: () => void;
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

export function AgentCard({ name, count5h, max5h, count7d, max7d, session, onReset }: AgentCardProps) {
  return (
    <div className="card">
      <div className="card-title">{name}</div>
      <UsageBar label="5h" value={count5h} max={max5h} />
      <UsageBar label="7d" value={count7d} max={max7d} />
      {session ? (
        <>
          <ContextMeter score={session.contextScore} state={session.contextState} />
          <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>
            Last activity: {relativeTime(session.lastActivity)}
            {' · '}{session.turns} turns
          </div>
          <div>
            <button className="action-btn secondary" onClick={onReset}>Reset Session</button>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--vscode-descriptionForeground)' }}>No active session</div>
      )}
    </div>
  );
}
