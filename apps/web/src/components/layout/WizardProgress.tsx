import styles from './WizardProgress.module.css';

export interface WizardProgressProps {
  readonly steps: readonly string[];
  readonly currentIndex: number;
}

/** Shared by the setup wizard (3.1) and the new-scan wizard (3.5) — step position, never a percentage bar (steps are qualitatively different, not equal-weight). */
export function WizardProgress({ steps, currentIndex }: WizardProgressProps) {
  return (
    <ol className={styles.list}>
      {steps.map((step, index) => (
        <li
          key={step}
          className={styles.step}
          data-state={
            index === currentIndex ? 'current' : index < currentIndex ? 'done' : 'pending'
          }
          aria-current={index === currentIndex ? 'step' : undefined}
        >
          <span className={styles.marker} aria-hidden="true">
            {index < currentIndex ? '✓' : index + 1}
          </span>
          <span className={styles.label}>{step}</span>
        </li>
      ))}
    </ol>
  );
}
