import type { Meta, StoryObj } from '@storybook/react';
import { ConfidenceMeter } from './ConfidenceMeter.js';

const meta: Meta<typeof ConfidenceMeter> = {
  title: 'Data display/ConfidenceMeter',
  component: ConfidenceMeter,
};
export default meta;

type Story = StoryObj<typeof ConfidenceMeter>;

export const Inferred: Story = {
  args: { band: 'inferred' },
  name: 'Inferred (single low-fidelity source — MOD-19)',
};
export const Corroborated: Story = { args: { band: 'corroborated' } };
export const Verified: Story = { args: { band: 'verified' } };
