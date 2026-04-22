import type { UsageEvent } from '../../../types';

interface EventListProps {
  events: UsageEvent[];
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

export function EventList({ events }: EventListProps) {
  if (events.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--vscode-descriptionForeground)', padding: '8px 0' }}>No events yet.</div>;
  }
  return (
    <div className="event-list">
      {events.map((e, i) => (
        <div className="event-row" key={i}>
          <span className="event-agent" style={{ color: e.agent === 'claude' ? 'var(--vscode-charts-purple)' : 'var(--vscode-charts-green)' }}>
            {e.agent === 'claude' ? 'Claude' : 'Codex'}
          </span>
          <span className="event-time">{relativeTime(e.timestamp)}</span>
        </div>
      ))}
    </div>
  );
}
