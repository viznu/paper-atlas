interface Bar {
  label: string;
  value: number;
  display?: string; // formatted value (defaults to value)
  onClick?: () => void;
}

interface Props {
  bars: Bar[];
  accent?: string; // bar colour
}

/** Compact horizontal bar chart for sidebar stats (labels left, bar+value right). */
export default function MiniBars({ bars, accent = '#7dd3fc' }: Props) {
  if (!bars.length) return null;
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="minibars">
      {bars.map((b, i) => {
        const Row = b.onClick ? 'button' : 'div';
        return (
          <Row
            key={i}
            className={b.onClick ? 'mb-row clickable' : 'mb-row'}
            onClick={b.onClick}
            type={b.onClick ? 'button' : undefined}
          >
            <span className="mb-label" title={b.label}>
              {b.label}
            </span>
            <span className="mb-track">
              <span
                className="mb-fill"
                style={{ width: `${(b.value / max) * 100}%`, background: accent }}
              />
            </span>
            <span className="mb-val">{b.display ?? b.value.toLocaleString()}</span>
          </Row>
        );
      })}
    </div>
  );
}
