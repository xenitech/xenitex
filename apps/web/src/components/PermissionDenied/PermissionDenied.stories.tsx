import type { Meta, StoryObj } from '@storybook/react';
import { PermissionDenied } from './PermissionDenied.js';

const meta: Meta<typeof PermissionDenied> = {
  title: 'Feedback/PermissionDenied',
  component: PermissionDenied,
};
export default meta;

type Story = StoryObj<typeof PermissionDenied>;

export const RequiresOperator: Story = {
  args: { requiredRole: 'operator' },
};

export const RequiresAdministrator: Story = {
  args: { requiredRole: 'administrator' },
};
