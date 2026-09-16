/**
 * Numeric mirror of tokens.css, for the handful of places JS needs an actual
 * number rather than a CSS custom-property string — virtualized-list row
 * height math (`DataTable`, UI-48) being the main one. This file is NOT the
 * source of truth for values; tokens.css is. Keep them in sync by hand until
 * 3.1 adds a build-time check that generates one from the other, or a
 * visual-regression test would have caught them drifting.
 *
 * Everything that can stay a CSS variable string (colour, radius, shadow)
 * does — only true numeric-in-JS needs live here.
 */

export const rowHeight = {
  compact: 32,
  comfortable: 40,
} as const;

export const spacingPx = {
  1: 2,
  2: 4,
  3: 6,
  4: 8,
  5: 12,
  6: 16,
  7: 24,
  8: 32,
  9: 48,
} as const;

export const durationMs = {
  state: 120,
  overlay: 200,
  fade: 150,
} as const;

/** UI-17: risk bands ordered most-to-least severe, for sort and legend order. */
export const riskBandOrder = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type RiskBand = (typeof riskBandOrder)[number];

/** UI-46: confidence bands ordered least-to-most certain, matching MOD-19/MOD-20 vocabulary. */
export const confidenceBandOrder = ['inferred', 'corroborated', 'verified'] as const;
export type ConfidenceBand = (typeof confidenceBandOrder)[number];
