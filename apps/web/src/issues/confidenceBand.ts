import type { ConfidenceBand } from '../design/tokens.js';
import type { ConfidenceLabel } from '../api/types.js';

/**
 * MOD-19/MOD-20 give the UI its own three-tier vocabulary (inferred /
 * corroborated / verified) distinct from the API's generic `ConfidenceLabel`
 * (low / medium / high, the same three-tier shape other confidence-like
 * fields in the contract use). This is the one place that translation
 * happens — components consume `ConfidenceBand`, never `ConfidenceLabel`
 * directly.
 */
const LABEL_TO_BAND: Record<ConfidenceLabel, ConfidenceBand> = {
  low: 'inferred',
  medium: 'corroborated',
  high: 'verified',
};

export function confidenceLabelToBand(label: ConfidenceLabel): ConfidenceBand {
  return LABEL_TO_BAND[label];
}
