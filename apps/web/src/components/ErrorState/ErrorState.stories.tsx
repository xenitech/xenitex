import type { Meta, StoryObj } from '@storybook/react';
import { ErrorState } from './ErrorState.js';

const meta: Meta<typeof ErrorState> = {
  title: 'Feedback/ErrorState',
  component: ErrorState,
};
export default meta;

type Story = StoryObj<typeof ErrorState>;

// Real content per UI-01/UI-99 — the exact example from the panel design spec's writing guidance.
export const ScopeChangedDuringReview: Story = {
  args: {
    title: 'Scan could not start',
    detail:
      'The scan could not start because the scope was changed while you were reviewing the plan. Review the updated plan and confirm again.',
    code: 'scan.stale_plan',
    correlationId: 'req-8f2c1a90',
  },
};

export const ExclusionViolation: Story = {
  args: {
    title: 'Scan blocked',
    detail:
      'This scan targets a range covered by an active exclusion rule. Remove the range from scope or update the exclusion before retrying.',
    code: 'scope.exclusion_violation',
    correlationId: 'req-3ba7e610',
  },
};
