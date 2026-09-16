import styles from './SkeletonRow.module.css';

export interface SkeletonRowProps {
  /** Column width fractions, e.g. [1, 3, 2, 1] — must match the real DataTable's column count for the screen it stands in for. */
  readonly columnWidths: readonly number[];
}

/** UI-63. Table-body only — never a full-page skeleton; the shell renders immediately. */
export function SkeletonRow({ columnWidths }: SkeletonRowProps) {
  return (
    <div className={styles.row} aria-hidden="true">
      {columnWidths.map((width, index) => (
        <span key={index} className={styles.cell} style={{ flexGrow: width, flexBasis: 0 }} />
      ))}
    </div>
  );
}
