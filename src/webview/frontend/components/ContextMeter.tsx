type ContextState = 'healthy' | 'busy' | 'heavy' | 'bloated';

interface ContextMeterProps {
  score: number;
  state: ContextState;
}

export function ContextMeter({ score, state }: ContextMeterProps) {
  const pct = Math.min(score, 100);
  const fillClass = state === 'bloated' ? 'danger' : state === 'heavy' ? 'warn' : 'ok';

  return (
    <div className="context-meter">
      <div className="usage-bar-label">
        <span>Context</span>
        <span className={`state-badge state-${state}`}>{state}</span>
      </div>
      <div className="usage-bar-track">
        <div
          className={`usage-bar-fill ${fillClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div style={{ fontSize: 11, color: 'var(--vscode-descriptionForeground)' }}>Score: {score}</div>
    </div>
  );
}
