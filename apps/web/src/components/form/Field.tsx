import {
  useId,
  type ReactElement,
  cloneElement,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
} from 'react';
import styles from './Field.module.css';

export interface FieldProps {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly children: ReactElement<{
    id?: string | undefined;
    'aria-describedby'?: string | undefined;
    'aria-invalid'?: boolean | undefined;
  }>;
}

/** Label/hint/error wiring via aria-describedby — every form input in the app goes through this, never a bare <input>. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {cloneElement(children, {
        id,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        'aria-invalid': Boolean(error),
      })}
      {hint && !error && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={styles.input} {...props} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={styles.input} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={styles.input} {...props} />;
}
