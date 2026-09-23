import type { Meta, StoryObj } from '@storybook/react';
import { RiskBadge } from './RiskBadge.js';

const meta: Meta<typeof RiskBadge> = {
  title: 'Data display/RiskBadge',
  component: RiskBadge,
};
export default meta;

type Story = StoryObj<typeof RiskBadge>;

// Real content per UI-01 — the Log4Shell example from docs/design/wireframe-issues.md,
// with the exact factor breakdown from docs/issues-scoring-dashboard-spec.md
// SCORE 2.2's multiplicative model (see RiskExplainer.stories.tsx for the same worked example).
export const Critical: Story = {
  args: {
    score: 100,
    band: 'critical',
    explanation: {
      scoringPolicyVersion: 2,
      factors: [
        {
          factor: 'cvssBaseScore',
          inputDescription: '10.0 (3.1)',
          multiplier: 1,
          runningScore: 100,
        },
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
  },
};

export const High: Story = { args: { score: 81, band: 'high' } };
export const Medium: Story = { args: { score: 56, band: 'medium' } };
export const Low: Story = { args: { score: 41, band: 'low' } };
export const Info: Story = { args: { score: 12, band: 'info' } };

export const WithoutExplainer: Story = {
  args: { score: 78, band: 'high' },
  name: 'Without explainer (e.g. export preview)',
};
