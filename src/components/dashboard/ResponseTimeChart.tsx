// ISC-74: a lightweight response-time chart — no charting library, just an SVG sparkline
// over the response_time_ms series (oldest to newest).
export function ResponseTimeChart({ points }: { points: number[] }) {
  if (points.length < 2) {
    return <p className="text-sm text-ink-soft">Not enough data yet for a chart.</p>;
  }

  const width = 600;
  const height = 120;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = Math.max(max - min, 1);

  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - ((p - min) / range) * (height - 10) - 5;
    return `${x},${y}`;
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-32 w-full" preserveAspectRatio="none">
      <polyline points={coords.join(" ")} fill="none" stroke="#f0c419" strokeWidth={2} />
    </svg>
  );
}
