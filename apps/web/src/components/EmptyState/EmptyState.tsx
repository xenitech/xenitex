import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  readonly title: string;
  readonly description: string;
  readonly action?: {
    readonly label: string;
    readonly onClick: () => void;
  };
}

/** UI-59/UI-77/UI-100. Never a decorative illustration — states the actual reason, offers the one action that helps. */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className={styles.state}>
      <p className={styles.title}>{title}</p>
      <p className={styles.description}>{description}</p>
      {action && (
        <button type="button" className={styles.action} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
