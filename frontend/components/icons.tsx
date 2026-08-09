/**
 * LevelFlip glyph set — hand-drawn stroke icons, deliberately NOT the
 * default emoji set. Every marker in the UI is a custom mark so the product
 * never reads as "stock emojis" (the telltale AI-slop red flag).
 */

interface IconProps {
  className?: string;
}

export function BoltIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M13.2 2 3.4 14h6.4L8.8 22l9.8-12h-6.4l1-8Z" />
    </svg>
  );
}

export function WallIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 6.5h6.5v4H3z M11.5 6.5H21v4H11.5z" />
      <path d="M3 13.5h7.5v4H3z M12.5 13.5H21v4H12.5z" />
    </svg>
  );
}

export function FlipIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M20 6.5H5.5 M5.5 6.5l3-3 M5.5 6.5l3 3" />
      <path d="M4 17.5h14.5 M18.5 17.5l-3-3 M18.5 17.5l-3 3" />
    </svg>
  );
}

export function PinIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 21.5s-6.7-5.7-6.7-11.3a6.7 6.7 0 0 1 13.4 0c0 5.6-6.7 11.3-6.7 11.3Z" />
      <circle cx="12" cy="10" r="2.4" />
    </svg>
  );
}

export function RadarIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5.5" />
      <circle cx="12" cy="12" r="1.8" />
      <path d="M12 12 17.5 6.5" />
    </svg>
  );
}

export function ShieldUpIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3l7 2.6V11c0 4.9-3.3 8.4-7 9.7-3.7-1.3-7-4.8-7-9.7V5.6L12 3Z" />
      <path d="M12 8.2v5.2 M12 13.4 9.9 11.2 M12 13.4l2.1-2.2" />
    </svg>
  );
}

export function ShieldDownIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3l7 2.6V11c0 4.9-3.3 8.4-7 9.7-3.7-1.3-7-4.8-7-9.7V5.6L12 3Z" />
      <path d="M12 13.4V8.2 M12 8.2l-2.1 2.2 M12 8.2l2.1 2.2" />
    </svg>
  );
}

export function CopyIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M5.5 14.5h-1A2.5 2.5 0 0 1 2 12V5.5A2.5 2.5 0 0 1 4.5 3H12a2.5 2.5 0 0 1 2.5 2.5v1" />
    </svg>
  );
}
