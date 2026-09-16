export interface SparklinePoint {
  readonly date: string;
  readonly value: number;
}

export interface SparklineProps {
  readonly points: readonly SparklinePoint[];
  readonly width?: number;
  readonly height?: number;
}

/** Inline SVG, no charting library (P1-26: no external dependency for a single trend line). */
export function Sparkline({ points, width = 160, height = 40 }: SparklineProps) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);

  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = height - ((p.value - min) / range) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Trend"
    >
      <path d={path} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
    </svg>
  );
}
