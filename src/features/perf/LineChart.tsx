import { Component, useEffect, useRef, type ReactNode } from 'react';
import { Line } from '@antv/g2plot';
import { trackResource } from '../../lib/resources.ts';

export interface ChartPoint {
  t: number;
  value: number;
  series: string;
}

interface LineChartProps {
  data: ChartPoint[];
  colors: string[];
  height?: number;
  unit?: string;
  ariaLabel: string;
}

/**
 * Thin G2Plot wrapper: the chart is created once and fed with `changeData`
 * (no re-instantiation per update), animations are off, and it is destroyed on unmount.
 */
export function LineChart({ data, colors, height = 180, unit = '', ariaLabel }: LineChartProps) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<Line | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const c = new Line(el.current, {
      data: [],
      xField: 't',
      yField: 'value',
      seriesField: 'series',
      height,
      autoFit: true,
      animation: false,
      color: colors,
      lineStyle: { lineWidth: 1.75 },
      meta: {
        // Declared explicitly: with empty initial data G2 would infer a linear scale and try a colour gradient.
        series: { type: 'cat' },
        t: { type: 'linear', nice: false, formatter: (v: number) => `${v}s` },
        value: { nice: true, min: 0, formatter: (v: number) => `${Math.round(v * 10) / 10}${unit}` },
      },
      xAxis: { tickCount: 6, label: { style: { fill: '#64748b', fontSize: 10 } }, line: { style: { stroke: '#e2e8f0' } } },
      yAxis: { tickCount: 4, label: { style: { fill: '#64748b', fontSize: 10 } }, grid: { line: { style: { stroke: '#f1f5f9' } } } },
      legend: { position: 'top-right', itemName: { style: { fill: '#475569', fontSize: 11 } } },
      tooltip: { shared: true, showCrosshairs: true },
    });
    c.render();
    chart.current = c;
    const release = trackResource('chart');
    return () => {
      c.destroy();
      chart.current = null;
      release();
    };
    // Chart is configured once; data flows through changeData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    chart.current?.changeData(data);
  }, [data]);

  // G2Plot takes over its container (and drops attributes on it), so the accessible name lives on a wrapper.
  return (
    <div role="img" aria-label={ariaLabel}>
      <div ref={el} style={{ height }} />
    </div>
  );
}

/** Keeps a charting failure contained to its panel instead of unmounting the page. */
export class ChartErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) return <p className="py-8 text-center text-xs text-red-600">Chart failed to render: {this.state.error.message}</p>;
    return this.props.children;
  }
}
