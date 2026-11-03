import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Svg(props: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8.5l3.2 3L13 4.5" />
  </Svg>
);

export const MoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 9.5A5.5 5.5 0 016.5 3a5.5 5.5 0 106.5 6.5z" />
  </Svg>
);

export const SunIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2.8" />
    <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
  </Svg>
);

export const MonitorIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="2.5" width="12" height="8.5" rx="1.2" />
    <path d="M6 14h4M8 11v3" />
  </Svg>
);

export const PlanIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 3h4M5 3v4.5h4M9 7.5h4M9 7.5v5.5h4" />
  </Svg>
);

export const ResetIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8a5 5 0 109.1-2.9M12.5 2.5v3h-3" />
  </Svg>
);

export const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1.2" />
    <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
  </Svg>
);

export const FlameIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 14.5c2.6 0 4.5-1.8 4.5-4.3 0-2.9-2.4-4.4-3-7.2-1.6 1-2.4 2.6-2.4 4.1-.9-.4-1.4-1.2-1.6-2C4.3 6.4 3.5 7.9 3.5 10.2c0 2.5 1.9 4.3 4.5 4.3z" />
  </Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </Svg>
);
