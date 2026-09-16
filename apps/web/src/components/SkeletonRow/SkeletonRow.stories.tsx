import type { Meta, StoryObj } from '@storybook/react';
import { SkeletonRow } from './SkeletonRow.js';

const meta: Meta<typeof SkeletonRow> = {
  title: 'Feedback/SkeletonRow',
  component: SkeletonRow,
};
export default meta;

type Story = StoryObj<typeof SkeletonRow>;

// Column widths matching the Issues table's default visible columns (risk, issue, asset, state).
export const IssuesTableLoading: Story = {
  render: () => (
    <div style={{ width: 600 }}>
      <SkeletonRow columnWidths={[1, 3, 2, 1]} />
      <SkeletonRow columnWidths={[1, 3, 2, 1]} />
      <SkeletonRow columnWidths={[1, 3, 2, 1]} />
    </div>
  ),
};
