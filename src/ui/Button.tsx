import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'run' | 'check' | 'ghost';

const variants: Record<Variant, string> = {
  run: 'border border-nav/50 bg-nav/10 text-nav hover:bg-nav/20',
  check: 'border border-ok bg-ok text-on-accent hover:brightness-110',
  ghost: 'border border-transparent text-dim hover:bg-raised hover:text-fg',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  icon?: ReactNode;
  shortcut?: string;
}

export function Button({ variant = 'ghost', icon, shortcut, children, className = '', ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[13px] font-medium transition disabled:pointer-events-none disabled:opacity-40 ${variants[variant]} ${className}`}
      {...rest}
    >
      {icon}
      {/* Inside a narrow panel buttons collapse to icons; the label stays as the accessible name. */}
      {children && <span className={icon ? '@max-[24rem]:sr-only' : undefined}>{children}</span>}
      {shortcut && <Kbd className="@max-[38rem]:hidden">{shortcut}</Kbd>}
    </button>
  );
}

export function Kbd({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={`rounded-sm border border-current/25 px-1 font-mono text-[10px] leading-4 font-normal opacity-75 ${className}`}>
      {children}
    </kbd>
  );
}
