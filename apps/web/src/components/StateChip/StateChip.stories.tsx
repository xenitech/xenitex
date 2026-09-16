import type { Meta, StoryObj } from '@storybook/react';
import type { IssueState } from '@xenitex/domain';
import { StateChip } from './StateChip.js';

const meta: Meta<typeof StateChip> = {
  title: 'Data display/StateChip',
  component: StateChip,
};
export default meta;

type Story = StoryObj<typeof StateChip>;

const STATES: readonly IssueState[] = [
  'new',
  'triaged',
  'in_progress',
  'mitigated',
  'verified_resolved',
  'reopened',
  'false_positive',
  'risk_accepted',
];

export const New: Story = { args: { state: 'new' } };
export const Triaged: Story = { args: { state: 'triaged' } };
export const InProgress: Story = { args: { state: 'in_progress' } };
export const Mitigated: Story = { args: { state: 'mitigated' } };
export const VerifiedResolved: Story = { args: { state: 'verified_resolved' } };
export const Reopened: Story = { args: { state: 'reopened' } };
export const FalsePositive: Story = { args: { state: 'false_positive' } };
export const RiskAccepted: Story = { args: { state: 'risk_accepted' } };

export const AllStates: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {STATES.map((state) => (
        <StateChip key={state} state={state} />
      ))}
    </div>
  ),
};
