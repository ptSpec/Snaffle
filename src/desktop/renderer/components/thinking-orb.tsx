import { useEffect, useId, useRef } from "react";

export type OrbMotion = "active" | "settling" | "stopped";

const ORBITS = [
  [0.72, 0.06, 7, 3.8, 15],
  [1.05, 0.08, 10, 3.2, 8],
  [1.42, 0.05, 6, 4.5, -10],
  [0.86, 0.06, 8, 3.6, -12],
  [1.22, 0.08, 11, 3, -8],
  [1.62, 0.06, 7, 4.2, 15],
  [0.78, 0.05, 6, 3.4, -5],
  [1.32, 0.05, 7, 4, 5],
] as const;

export function ThinkingOrb({
  preview = false,
  motion = "active",
  speed = 1,
}: {
  preview?: boolean;
  motion?: OrbMotion;
  speed?: number;
}): JSX.Element {
  const orb = useRef<SVGSVGElement>(null);
  const phase = useRef(0);
  const id = useId().replaceAll(":", "");

  useEffect(() => {
    if (!orb.current) return;
    const layers = [...orb.current.querySelectorAll<SVGEllipseElement>("ellipse")];
    const reducedMotion = !preview && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let previous = performance.now();
    const start = previous;
    const startPhase = phase.current;

    function rotationAt(value: number, index: number, speed: number): number {
      const offset = index * 0.7;
      const modulation = (Math.sin(value * (0.5 + index * 0.025) + offset) - Math.sin(offset)) * 0.52;
      return (value * speed + modulation) * (180 / Math.PI);
    }

    function drawActive(value: number): void {
      layers.forEach((layer, index) => {
        const [speed, stretch, , drift, homeAngle] = ORBITS[index] ?? ORBITS[0];
        const rotation = homeAngle + rotationAt(value, index, speed);
        const wave = Math.sin(value * (speed + 0.55));
        const breath = Math.sin(value * 0.7) * (0.82 + Math.sin(value * 0.35 + index) * 0.18);
        const distance = breath * drift;
        layer.style.transform = `rotate(${rotation}deg) translate(${distance}%, 0) scale(${1 + stretch * wave}, ${1 - stretch * wave})`;
      });
    }

    function drawIdle(value: number): void {
      layers.forEach((layer, index) => {
        const [, , idleAngle, drift, homeAngle] = ORBITS[index] ?? ORBITS[0];
        const wave = Math.sin(value * (0.8 + index * 0.12));
        layer.style.transform = `rotate(${homeAngle + idleAngle * wave}deg) translate(${drift * wave * 0.25}%, 0) scale(${1 + 0.025 * wave}, ${1 - 0.025 * wave})`;
      });
    }

    function drawSettling(progress: number): void {
      const remaining = 1 - progress;
      layers.forEach((layer, index) => {
        const [speed, stretch, , drift, homeAngle] = ORBITS[index] ?? ORBITS[0];
        const fullRotation = rotationAt(startPhase, index, speed);
        const rotation = ((fullRotation + 180) % 360) - 180;
        const wave = Math.sin(startPhase * (speed + 0.55));
        const breath = Math.sin(startPhase * 0.7) * (0.82 + Math.sin(startPhase * 0.35 + index) * 0.18);
        const distance = breath * drift;
        layer.style.transform = `rotate(${homeAngle + rotation * remaining}deg) translate(${distance * remaining}%, 0) scale(${1 + stretch * wave * remaining}, ${1 - stretch * wave * remaining})`;
      });
    }

    function animate(now: number): void {
      const elapsed = now - previous;
      previous = now;
      if (motion === "active") {
        phase.current += (elapsed / 600) * speed;
        drawActive(phase.current);
      } else if (motion === "settling") {
        const progress = Math.min((now - start) / 2200, 1);
        const eased = progress * progress * (3 - 2 * progress);
        drawSettling(eased);
        phase.current = startPhase * (1 - eased);
        if (progress === 1) {
          phase.current = 0;
          return;
        }
      } else {
        drawIdle((now - start) / 1800);
      }
      frame = window.requestAnimationFrame(animate);
    }

    if (reducedMotion) drawIdle(0);
    else if (motion === "stopped" && !preview) drawIdle(0);
    else frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [motion, preview, speed]);

  const clipId = `thinking-orb-clip-${id}`;
  const blueId = `thinking-orb-blue-${id}`;
  const redId = `thinking-orb-red-${id}`;
  const lightBlueId = `thinking-orb-light-blue-${id}`;
  const lightRedId = `thinking-orb-light-red-${id}`;
  const paleBlueId = `thinking-orb-pale-blue-${id}`;
  const paleRedId = `thinking-orb-pale-red-${id}`;
  const yellowLeftId = `thinking-orb-yellow-left-${id}`;
  const yellowRightId = `thinking-orb-yellow-right-${id}`;
  const ambientId = `thinking-orb-ambient-${id}`;
  return (
    <svg
      ref={orb}
      className={`thinking-orb ${motion}${preview ? " preview" : ""}`}
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="10" cy="10" r="8" />
        </clipPath>
        <radialGradient id={blueId}>
          <stop offset="0" stopColor="var(--thinking-orb-deep-blue)" />
          <stop offset="0.72" stopColor="var(--thinking-orb-deep-blue)" stopOpacity="0.78" />
          <stop offset="1" stopColor="var(--thinking-orb-deep-blue)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={redId}>
          <stop offset="0" stopColor="var(--thinking-orb-red)" />
          <stop offset="0.72" stopColor="var(--thinking-orb-red)" stopOpacity="0.78" />
          <stop offset="1" stopColor="var(--thinking-orb-red)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={lightBlueId}>
          <stop offset="0" stopColor="var(--thinking-orb-light-blue)" />
          <stop offset="0.72" stopColor="var(--thinking-orb-light-blue)" stopOpacity="0.78" />
          <stop offset="1" stopColor="var(--thinking-orb-light-blue)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={lightRedId}>
          <stop offset="0" stopColor="var(--thinking-orb-light-red)" />
          <stop offset="0.72" stopColor="var(--thinking-orb-light-red)" stopOpacity="0.78" />
          <stop offset="1" stopColor="var(--thinking-orb-light-red)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={paleBlueId}>
          <stop offset="0" stopColor="var(--thinking-orb-pale-blue)" />
          <stop offset="1" stopColor="var(--thinking-orb-pale-blue)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={paleRedId}>
          <stop offset="0" stopColor="var(--thinking-orb-pale-red)" />
          <stop offset="1" stopColor="var(--thinking-orb-pale-red)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={yellowLeftId}>
          <stop offset="0" stopColor="var(--thinking-orb-yellow-left)" />
          <stop offset="0.7" stopColor="var(--thinking-orb-yellow-left)" stopOpacity="0.68" />
          <stop offset="1" stopColor="var(--thinking-orb-yellow-left)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={yellowRightId}>
          <stop offset="0" stopColor="var(--thinking-orb-yellow-right)" />
          <stop offset="0.7" stopColor="var(--thinking-orb-yellow-right)" stopOpacity="0.64" />
          <stop offset="1" stopColor="var(--thinking-orb-yellow-right)" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={ambientId}>
          <stop offset="0" stopColor="var(--thinking-orb-ambient)" stopOpacity="0.28" />
          <stop offset="0.72" stopColor="var(--thinking-orb-ambient)" stopOpacity="0.12" />
          <stop offset="1" stopColor="var(--thinking-orb-ambient)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <circle className="thinking-orb-base" cx="10" cy="10" r="8" />
        <circle className="thinking-orb-ambient" cx="10" cy="10" r="7.8" fill={`url(#${ambientId})`} />
        <g className="thinking-orb-layers">
          <g className="thinking-orb-flow-a">
            <ellipse className="thinking-orb-top-blue" cx="4.5" cy="7" rx="6.3" ry="5" fill={`url(#${paleBlueId})`} />
            <ellipse className="thinking-orb-mid-red" cx="15" cy="16" rx="7.3" ry="5.4" fill={`url(#${lightRedId})`} />
            <ellipse className="thinking-orb-bottom-blue" cx="5" cy="16" rx="7.3" ry="5.4" fill={`url(#${blueId})`} />
          </g>
          <g className="thinking-orb-flow-b">
            <ellipse className="thinking-orb-top-red" cx="15.5" cy="7" rx="6.3" ry="5" fill={`url(#${paleRedId})`} />
            <ellipse className="thinking-orb-mid-blue" cx="4.5" cy="11" rx="6.7" ry="5.2" fill={`url(#${lightBlueId})`} />
            <ellipse className="thinking-orb-bottom-red" cx="15.5" cy="7.8" rx="6.7" ry="5.2" fill={`url(#${redId})`} />
          </g>
          <g className="thinking-orb-highlights">
            <ellipse className="thinking-orb-yellow-left" cx="7.5" cy="3.5" rx="6" ry="4.8" fill={`url(#${yellowLeftId})`} />
            <ellipse className="thinking-orb-yellow-right" cx="12.5" cy="3.5" rx="6" ry="4.8" fill={`url(#${yellowRightId})`} />
          </g>
        </g>
      </g>
    </svg>
  );
}
