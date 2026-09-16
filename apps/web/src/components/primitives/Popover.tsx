import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import styles from './Popover.module.css';

export interface PopoverProps {
  readonly trigger: ReactNode;
  readonly children: ReactNode;
  /** UI-44: RiskBadge is focusable and reveals its explainer on focus OR hover — both, not either exclusively. */
  readonly label: string;
}

/**
 * Minimal hover/focus-triggered info popover — the shared mechanic behind
 * RiskBadge → RiskExplainer (UI-44/UI-45) and reused later by any other
 * catalogue component needing the same "reveal on focus or hover, dismiss
 * on Escape or blur" pattern (ScopePicker, FilterBar). Deliberately no
 * floating-ui-style collision detection yet — first pass for isolation
 * testing; add it if a real screen's layout needs it.
 */
export function Popover({ trigger, children, label }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={styles.trigger}
        aria-describedby={panelId}
        aria-label={label}
        onFocus={() => setOpen(true)}
        onBlur={(event) => {
          if (!containerRef.current?.contains(event.relatedTarget as Node)) {
            setOpen(false);
          }
        }}
      >
        {trigger}
      </button>
      <div
        id={panelId}
        role="tooltip"
        className={styles.panel}
        data-open={open}
        aria-hidden={!open}
      >
        {children}
      </div>
    </div>
  );
}
