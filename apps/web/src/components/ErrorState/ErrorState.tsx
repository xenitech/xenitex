import styles from './ErrorState.module.css';

export interface ErrorStateProps {
  readonly title: string;
  /** UI-99: states what happened and what to do, in one sentence — not "An error occurred." */
  readonly detail: string;
  /** RFC 9457 `code` — stable, machine-readable, what a client or test actually branches on (docs/adr/0006-api-conventions.md). */
  readonly code: string;
  readonly correlationId: string;
}

/** UI-60/P1-04. Renders the RFC 9457 problem detail an operator can quote back in a support conversation. */
export function ErrorState({ title, detail, code, correlationId }: ErrorStateProps) {
  return (
    <div className={styles.state} role="alert">
      <p className={styles.title}>{title}</p>
      <p className={styles.detail}>{detail}</p>
      <div className={styles.meta}>
        <span>code: {code}</span>
        <span>correlation: {correlationId}</span>
      </div>
    </div>
  );
}
