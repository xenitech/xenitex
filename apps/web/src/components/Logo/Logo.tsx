import { useId } from 'react';
import styles from './Logo.module.css';

export interface LogoProps {
  /**
   * `mark` — the hexagon icon plus wordmark, sized for the persistent top
   * bar (UI-10: no glow/gradient on functional chrome is the rule for
   * data-dense screens; the icon itself still carries its two-stop cyan
   * gradient since it is a small, static brand mark, not chrome).
   * `lockup` — the same icon at full size, wordmark, and the "SCANNER
   * PLATFORM" kicker beneath it, for the pre-authentication screens
   * (sign-in, setup, MFA) where a fuller brand moment is appropriate and
   * nothing data-dense competes with it.
   */
  readonly variant?: 'mark' | 'lockup';
  readonly className?: string;
}

/**
 * Inline SVG, not an <img>/asset file: stays crisp at any size, needs no
 * network request (P1-26 — the appliance is air-gapped, so even a same-
 * origin asset fetch is a cost worth avoiding for something this small),
 * and never risks the empty-alt/broken-image flash a raster logo has before
 * it loads.
 *
 * The hexagon-and-target motif reads as "scan" (a targeting reticle) inside
 * "boundary" (the hexagon a scope defines) — deliberately literal for a
 * product whose entire pitch is "we observe your perimeter and report what
 * we see," never touch it.
 */
function HexagonMark({ size, gradientId }: { readonly size: number; readonly gradientId: string }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} role="img" aria-label="Xenitex">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#5fd4f5" />
          <stop offset="100%" stopColor="#1f7fb8" />
        </linearGradient>
      </defs>
      <path
        d="M24 2 44 13v22L24 46 4 35V13z"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="24" r="10" fill="none" stroke={`url(#${gradientId})`} strokeWidth="3" />
      <circle cx="24" cy="24" r="3.5" fill={`url(#${gradientId})`} />
    </svg>
  );
}

/** The letters share a wordmark styling across both variants — one gradient never applied twice to overlapping DOM, since each render gets its own SVG defs via `useId`. */
function Wordmark({ size }: { readonly size: 'sm' | 'lg' }) {
  return (
    <span className={size === 'lg' ? styles.wordmarkLarge : styles.wordmark}>
      XENITE<span className={styles.wordmarkAccentLetter}>X</span>
    </span>
  );
}

export function Logo({ variant = 'mark', className }: LogoProps) {
  // React's useId(), not a literal string: two Logos on one page (e.g. a
  // Storybook page rendering both variants together) must not collide on
  // the same SVG <linearGradient> id, which would make the second one
  // silently render the first one's gradient — or nothing, in browsers that
  // de-duplicate id references strictly.
  const gradientId = `xenitex-logo-gradient-${useId()}`;

  if (variant === 'lockup') {
    return (
      <div className={[styles.lockupFull, className].filter(Boolean).join(' ')}>
        <HexagonMark size={56} gradientId={gradientId} />
        <Wordmark size="lg" />
        <span className={styles.kicker}>SCANNER PLATFORM</span>
      </div>
    );
  }

  return (
    <span className={[styles.lockupInline, className].filter(Boolean).join(' ')}>
      <HexagonMark size={28} gradientId={gradientId} />
      <Wordmark size="sm" />
    </span>
  );
}
