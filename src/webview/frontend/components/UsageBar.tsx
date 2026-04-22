interface UsageBarProps {
  label: string;
  value: number;
  max: number;
}

export function UsageBar({ label, value, max }: UsageBarProps) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const fillClass = pct >= 0.95 ? 'danger' : pct >= 0.80 ? 'warn' : 'ok';

  return (
    <div className="usage-bar-wrap">
      <div className="usage-bar-label">
        <span>{label}</span>
        <span>{value} / {max}</span>
      </div>
      <div className="usage-bar-track">
        <div
          className={`usage-bar-fill ${fillClass}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}
