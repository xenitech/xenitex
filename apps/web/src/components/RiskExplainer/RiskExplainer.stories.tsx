import type { Meta, StoryObj } from '@storybook/react';
import { RiskExplainer } from './RiskExplainer.js';

const meta: Meta<typeof RiskExplainer> = {
  title: 'Data display/RiskExplainer',
  component: RiskExplainer,
};
export default meta;

type Story = StoryObj<typeof RiskExplainer>;

// Real content per UI-01 — matches docs/issues-scoring-dashboard-spec.md
// SCORE 2.2's worked model (Log4Shell: CVSS 10.0 v3.1, known-exploited,
// exposure external, criticality high, confidence verified).
export const Log4ShellBreakdown: Story = {
  args: {
    scoringPolicyVersion: 2,
    factors: [
      { factor: 'cvssBaseScore', inputDescription: '10.0 (3.1)', multiplier: 1, runningScore: 100 },
      {
        factor: 'knownExploited',
        inputDescription: 'known-exploited',
        multiplier: 1.5,
        runningScore: 150,
      },
      {
        factor: 'exposureClassification',
        inputDescription: 'external',
        multiplier: 1.3,
        runningScore: 195,
      },
      {
        factor: 'assetCriticality',
        inputDescription: 'high',
        multiplier: 1.1,
        runningScore: 214.5,
      },
      { factor: 'confidence', inputDescription: 'verified', multiplier: 1.0, runningScore: 100 },
    ],
  },
};
