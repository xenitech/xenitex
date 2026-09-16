import styles from './EvidenceBlock.module.css';

export interface EvidenceBlockMatchedSpan {
  readonly lineIndex: number;
  readonly start: number;
  readonly length: number;
}

export interface EvidenceBlockProps {
  /**
   * SEC-17: raw scanner-derived content — banners, headers, response
   * excerpts. Every line is rendered as a plain React text child below,
   * NEVER through dangerouslySetInnerHTML, a markdown renderer, or string
   * concatenation into an HTML template. That is what makes this component
   * safe against an attacker-controlled evidence string containing HTML or
   * script-like content: React escapes text children by construction, and
   * there is no code path here that opts out of that. Do not add one.
   */
  readonly lines: readonly string[];
  readonly matchedSpan?: EvidenceBlockMatchedSpan;
  readonly adapterKey: string;
  readonly adapterVersion: string;
  readonly observedAt: string;
  readonly rawArtifactHref: string;
}

/** UI-47. The MOD-21 surface: every issue's evidence must be inspectable here, or it has no reason to be on screen. */
export function EvidenceBlock({
  lines,
  matchedSpan,
  adapterKey,
  adapterVersion,
  observedAt,
  rawArtifactHref,
}: EvidenceBlockProps) {
  return (
    <div className={styles.block}>
      <div className={styles.meta}>
        <span>
          {adapterKey} v{adapterVersion} · {observedAt}
        </span>
        <a className={styles.metaLink} href={rawArtifactHref}>
          View raw artifact
        </a>
      </div>
      <pre className={styles.code}>
        {lines.map((line, index) => (
          <div key={index} className={styles.line} data-matched={index === matchedSpan?.lineIndex}>
            <span className={styles.lineNumber}>{index + 1}</span>
            <span className={styles.lineContent}>
              {renderLine(line, index === matchedSpan?.lineIndex ? matchedSpan : undefined)}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}

function renderLine(line: string, span: EvidenceBlockMatchedSpan | undefined) {
  if (!span) return line;
  // Plain string slicing, then each slice rendered as a separate text child
  // (never re-joined into a string and re-parsed) — the highlight is purely
  // presentational, it cannot change what the underlying evidence says.
  const before = line.slice(0, span.start);
  const matched = line.slice(span.start, span.start + span.length);
  const after = line.slice(span.start + span.length);
  return (
    <>
      {before}
      <mark className={styles.match}>{matched}</mark>
      {after}
    </>
  );
}
