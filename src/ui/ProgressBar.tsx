interface ProgressBarProps {
  value: number;
  label: string;
  tone?: 'ok' | 'amber' | 'nav';
  className?: string;
}

const fills = { ok: 'bg-ok', amber: 'bg-amber', nav: 'bg-nav' };

export function ProgressBar({ value, label, tone = 'amber', className = '' }: ProgressBarProps) {
  const percent = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`h-1.5 w-full overflow-hidden rounded-full bg-line ${className}`}
    >
      <div className={`h-full rounded-full transition-[width] duration-500 ${fills[tone]}`} style={{ width: `${percent}%` }} />
    </div>
  );
}
