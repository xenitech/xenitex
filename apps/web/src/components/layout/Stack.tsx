import type { HTMLAttributes } from 'react';
import styles from './Stack.module.css';

/** Vertical rhythm for forms and stacked sections — the one layout primitive reused across every wizard step and form in the app. */
export function Stack({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={[styles.stack, className].filter(Boolean).join(' ')} {...rest} />;
}
