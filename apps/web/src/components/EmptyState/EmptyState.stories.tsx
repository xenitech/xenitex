import type { Meta, StoryObj } from '@storybook/react';
import { EmptyState } from './EmptyState.js';

const meta: Meta<typeof EmptyState> = {
  title: 'Feedback/EmptyState',
  component: EmptyState,
};
export default meta;

type Story = StoryObj<typeof EmptyState>;

// Real content per UI-01/UI-77 — the actual empty-state copy from the Issues wireframe.
export const NoScopeAuthorised: Story = {
  args: {
    title: 'No scope has been authorised yet',
    description: 'Issues appear here once a scan runs against an authorised scope.',
    action: { label: 'Declare a scope', onClick: () => {} },
  },
};

export const NothingAssessedYet: Story = {
  name: 'Dashboard — nothing assessed (UI-77)',
  args: {
    title: 'Nothing has been assessed yet',
    description:
      'Declare an authorised scope and run a scan to see risk posture, coverage, and SLA compliance here.',
    action: { label: 'Declare a scope and run a scan', onClick: () => {} },
  },
};
