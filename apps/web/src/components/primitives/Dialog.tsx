import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Dialog.module.css';

export interface DialogProps {
  readonly titleId: string;
  readonly title: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/**
 * Minimal accessible modal: traps focus by moving it into the dialog on
 * open, restores it to the trigger on close, closes on Escape and backdrop
 * click. Used for every confirm-before-mutating flow (global stop, abort
 * scan, false-positive/risk-accept dialogs) so that behaviour is identical
 * everywhere rather than re-implemented per screen.
 */
export function Dialog({ titleId, title, isOpen, onClose, children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
