import type { Meta, StoryObj } from '@storybook/react';
import { Logo } from './Logo.js';

const meta: Meta<typeof Logo> = {
  title: 'Brand/Logo',
  component: Logo,
};
export default meta;

type Story = StoryObj<typeof Logo>;

/** The persistent top-bar mark (AppShell). */
export const Mark: Story = { args: { variant: 'mark' } };

/** The full pre-authentication lockup (sign-in, setup, MFA screens). */
export const Lockup: Story = { args: { variant: 'lockup' } };
