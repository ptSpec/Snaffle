import { useEffect, useMemo, useRef, useState } from "react";
import type { Usage } from "../../../protocol.js";

export type UsageDitherPoint = {
  id: string;
  label: string;
  usage: Usage;
  cacheAvailable: boolean;
};

type HoveredPoint = {
  index: number;
};

const CHART_HEIGHT = 110;
const MIN_COLUMN_WIDTH = 12;

export function UsageDither({
  points,
  onSelect,
}: {
  points: UsageDitherPoint[];
  onSelect(id: string): void;
}): JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(220);
  const [hovered, setHovered] = useState<HoveredPoint | null>(null);
  const chartWidth = Math.max(frameWidth, points.length * MIN_COLUMN_WIDTH + 12);

  const maxTokens = useMemo(() => Math.max(
    1,
    ...points.map(({ usage }) => usage.totalTokens ??
      (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)),
  ), [points]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const update = (): void => setFrameWidth(Math.max(160, frame.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(chartWidth * ratio);
    canvas.height = Math.round(CHART_HEIGHT * ratio);
    canvas.style.width = `${chartWidth}px`;
    canvas.style.height = `${CHART_HEIGHT}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const style = getComputedStyle(document.documentElement);
    drawUsage(context, points, chartWidth, CHART_HEIGHT, maxTokens, {
      cached: style.getPropertyValue("--usage-cached").trim(),
      uncached: style.getPropertyValue("--usage-uncached").trim(),
      output: style.getPropertyValue("--usage-output").trim(),
    });
  }, [chartWidth, maxTokens, points]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll && chartWidth > frameWidth) scroll.scrollLeft = scroll.scrollWidth;
  }, [chartWidth, frameWidth, points.length]);

  const findPoint = (clientX: number): HoveredPoint | null => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame || !points.length) return null;
    const canvasRect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(chartWidth - 1, clientX - canvasRect.left));
    const index = Math.min(points.length - 1, Math.floor((x / chartWidth) * points.length));
    return { index };
  };

  const point = hovered ? points[hovered.index] : undefined;

  return (
    <div className="usage-dither" ref={frameRef}>
      <div
        className="usage-dither-scroll"
        ref={scrollRef}
        onMouseMove={(event) => setHovered(findPoint(event.clientX))}
        onMouseLeave={() => setHovered(null)}
        onClick={(event) => {
          const next = findPoint(event.clientX);
          if (next) onSelect(points[next.index]!.id);
        }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`Token usage across ${points.length} conversation turns`}
        />
      </div>
      {point && hovered ? (
        <div className="usage-dither-tooltip">
          <strong>{point.label}</strong>
          <span>{usageTooltip(point)}</span>
        </div>
      ) : null}
      <div className="usage-dither-legend" aria-hidden="true">
        <span className="cached">Cached</span>
        <span className="uncached">Uncached</span>
        <span className="output">Output</span>
      </div>
    </div>
  );
}

function drawUsage(
  context: CanvasRenderingContext2D,
  points: UsageDitherPoint[],
  width: number,
  height: number,
  maxTokens: number,
  colors: { cached: string; uncached: string; output: string },
): void {
  context.clearRect(0, 0, width, height);
  if (!points.length) return;

  const rows = 13;
  const rowPitch = 8;
  const cellSize = 6;
  const baseline = height - 2;
  const columnWidth = width / points.length;

  points.forEach((point, index) => {
    const input = point.usage.inputTokens ?? 0;
    const cached = point.cacheAvailable ? Math.min(input, point.usage.cachedInputTokens ?? 0) : 0;
    const uncached = Math.max(0, input - cached);
    const output = point.usage.outputTokens ?? 0;
    const total = Math.max(1, point.usage.totalTokens ?? input + output);
    const filledRows = Math.max(1, Math.round(Math.sqrt(total / maxTokens) * rows));
    const x = index * columnWidth + Math.max(1, (columnWidth - cellSize) / 2);

    for (let row = 0; row < filledRows; row += 1) {
      const position = (row + 0.5) / filledRows;
      const cachedShare = cached / total;
      const uncachedShare = uncached / total;
      context.globalAlpha = point.cacheAvailable && position <= cachedShare ? 0.68 : 1;
      context.fillStyle = position <= cachedShare
        ? colors.cached
        : position <= cachedShare + uncachedShare
          ? colors.uncached
          : colors.output;
      context.fillRect(
        x,
        baseline - (row + 1) * rowPitch,
        Math.min(cellSize, columnWidth - 2),
        cellSize,
      );
    }
  });
  context.globalAlpha = 1;
}

function usageTooltip(point: UsageDitherPoint): string {
  const input = point.usage.inputTokens ?? 0;
  const output = point.usage.outputTokens ?? 0;
  const details = point.cacheAvailable
    ? `${formatNumber(Math.max(0, input - (point.usage.cachedInputTokens ?? 0)))} uncached · ${formatNumber(point.usage.cachedInputTokens ?? 0)} cached`
    : `${formatNumber(input)} input · cache data unavailable`;
  return `${details} · ${formatNumber(output)} output${point.usage.costUsd ? ` · ${formatCost(point.usage.costUsd)}` : ""}`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatCost(costUsd: number): string {
  const decimals = costUsd < 0.01 ? 6 : costUsd < 1 ? 4 : 2;
  return `$${costUsd.toFixed(decimals)}`;
}
