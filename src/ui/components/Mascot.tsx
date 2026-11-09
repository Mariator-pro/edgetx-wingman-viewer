import { useEffect, useRef } from 'react';

// The Wingman quad flying back and forth in the free space it is given (header of the flights page).
const WIDTH = 70; // px, the svg's width
const SPEED = 90; // px/s on average
const HOLD = 1100; // ms hovering at each end
const ACCENT = '#7cd230';
const MOTORS = [
  [-36, -14, 16],
  [36, -14, 16],
  [-46, 8, 19],
  [46, 8, 19],
] as const; // x, y, prop radius; back pair first
const TIP = [-16, -40] as const;
const ARCS = [6, 9.5, 13];

function Motor({ x, y, size, blade }: { x: number; y: number; size: number; blade: (el: SVGRectElement | null) => void }) {
  return (
    <g>
      <rect x={x - 4} y={y - 1} width={8} height={6} rx={1} fill="#9a9a9a" />
      <rect x={x - 4.5} y={y - 3.5} width={9} height={3} rx={1} fill="#5aa020" />
      <ellipse cx={x} cy={y - 6} rx={size} ry={size * 0.2} fill={ACCENT} opacity={0.22} />
      <rect ref={blade} className="[transform-box:fill-box] origin-center" x={x - size + 1} y={y - 7} width={2 * size - 2} height={2} rx={1} fill={ACCENT} />
    </g>
  );
}

export function Mascot() {
  const track = useRef<HTMLDivElement>(null);
  const drone = useRef<SVGSVGElement>(null);
  const tip = useRef<SVGCircleElement>(null);
  const blades = useRef<(SVGRectElement | null)[]>([]);
  const arcs = useRef<(SVGPathElement | null)[]>([]);
  const eyes = useRef<(SVGGElement | null)[]>([]);
  const pupils = useRef<(SVGCircleElement | null)[]>([]);

  useEffect(() => {
    const box = track.current!;
    const svg = drone.current!;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let range = 0;
    const size = new ResizeObserver(() => {
      range = Math.max(0, box.clientWidth - WIDTH);
      svg.style.display = range < 24 ? 'none' : '';
    });
    size.observe(box);

    let state: 'fly' | 'hold' = 'fly';
    let stateT = 0;
    let dir = 1;
    let lean = 0;
    let look = 1;
    let spin = 0;
    let t = 0;
    let blinkAt = 2000;
    let blinkUntil = 0;
    let last = performance.now();
    let id = 0;

    const frame = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      t += dt;
      id = requestAnimationFrame(frame);
      if (motion.matches) {
        svg.style.transform = `translate(${range / 2}px, 0)`;
        return;
      }

      // across with ease in and out, hover at the end, then back
      const flyDur = Math.min(7000, Math.max(2200, (range / SPEED) * 1000));
      stateT += dt;
      let u: number;
      let vel = 0;
      if (state === 'fly') {
        const p = Math.min(1, stateT / flyDur);
        const e = (1 - Math.cos(Math.PI * p)) / 2;
        u = dir > 0 ? e : 1 - e;
        vel = dir * Math.sin(Math.PI * p);
        if (p >= 1) [state, stateT] = ['hold', 0];
      } else {
        u = dir > 0 ? 1 : 0;
        if (stateT >= HOLD) [state, stateT, dir] = ['fly', 0, -dir];
      }

      // leans into the direction of travel, bobs, looks ahead
      lean += (vel * 13 - lean) * Math.min(1, dt / 160);
      look += (dir - look) * Math.min(1, dt / 250);
      const bob = 2.5 * Math.sin((t / 1400) * 2 * Math.PI);
      svg.style.transform = `translate(${u * range}px, ${bob}px) rotate(${lean}deg)`;
      for (const p of pupils.current) p?.setAttribute('transform', `translate(${look * 1.8} 0.3)`);

      if (t > blinkAt) [blinkUntil, blinkAt] = [t + 130, t + 2500 + Math.random() * 3000];
      for (const e of eyes.current) if (e) e.style.transform = t < blinkUntil ? 'scaleY(0.15)' : '';

      spin += dt * 0.045;
      blades.current.forEach((b, i) => b && (b.style.transform = `scaleX(${Math.cos(spin + i * 0.8)})`));

      // heartbeat of the antenna tip and signal arcs running outwards
      const hb = (t % 1000) / 1000;
      const beat = Math.max(Math.exp(-((hb - 0.1) ** 2) / 0.002), 0.7 * Math.exp(-((hb - 0.3) ** 2) / 0.002));
      tip.current?.setAttribute('opacity', String(0.25 + 0.75 * beat));
      arcs.current.forEach((a, i) => {
        const ph = ((((t - i * 300) % 1800) + 1800) % 1800) / 1800;
        a?.setAttribute('opacity', String(ph > 0.1 && ph < 0.65 ? 1 - Math.max(0, (ph - 0.45) / 0.2) : 0));
      });
    };
    id = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(id);
      size.disconnect();
    };
  }, []);

  const frameStroke = 'stroke-[#2b2b2b] dark:stroke-[#55585c]';
  return (
    <div ref={track} aria-hidden="true" className="pointer-events-none relative h-10 min-w-0 flex-1 basis-0">
      <svg ref={drone} viewBox="-66 -54 132 96" className="absolute -top-1.5 left-0 will-change-transform" width={WIDTH} height={51}>
        <g className={frameStroke} strokeWidth={4} strokeLinecap="round">
          <line x1={-10} y1={-8} x2={-36} y2={-14} />
          <line x1={10} y1={-8} x2={36} y2={-14} />
        </g>
        {MOTORS.slice(0, 2).map(([x, y, s], i) => (
          <Motor key={i} x={x} y={y} size={s} blade={(el) => void (blades.current[i] = el)} />
        ))}
        <line x1={-6} y1={-24} x2={TIP[0]} y2={TIP[1] + 2} stroke="#3a3a3a" strokeWidth={2.4} strokeLinecap="round" />
        <g fill="none" stroke={ACCENT} strokeWidth={1.8} strokeLinecap="round">
          {ARCS.map((r, i) => {
            const d = r * Math.SQRT1_2;
            return <path key={r} ref={(el) => void (arcs.current[i] = el)} opacity={0} d={`M ${TIP[0] - d} ${TIP[1] - d} A ${r} ${r} 0 0 1 ${TIP[0] + d} ${TIP[1] - d}`} />;
          })}
        </g>
        <circle cx={TIP[0]} cy={TIP[1]} r={3.8} fill="#7a1616" />
        <circle ref={tip} cx={TIP[0]} cy={TIP[1]} r={3.8} fill="#ff3b3b" />
        <rect x={-15} y={-27} width={30} height={15} rx={3} fill="#f0c020" />
        <rect x={-15} y={-27} width={30} height={3.5} rx={1.5} fill="#2a2a2a" />
        <rect x={-3.5} y={-27} width={7} height={15} fill={ACCENT} />
        <rect x={-17} y={-13} width={34} height={3.5} rx={1.5} fill="#232323" />
        <g className={frameStroke} strokeWidth={4.5} strokeLinecap="round">
          <line x1={-12} y1={4} x2={-46} y2={8} />
          <line x1={12} y1={4} x2={46} y2={8} />
        </g>
        {MOTORS.slice(2).map(([x, y, s], i) => (
          <Motor key={i} x={x} y={y} size={s} blade={(el) => void (blades.current[i + 2] = el)} />
        ))}
        <rect x={-17} y={-11} width={34} height={27} rx={6} fill={ACCENT} />
        <rect x={-14.5} y={-8.5} width={29} height={22} rx={4.5} fill="#1b1e1b" />
        <circle cx={0} cy={-5} r={1.3} fill="#2f5a8a" />
        {[-6.5, 6.5].map((x, i) => (
          <g key={x} ref={(el) => void (eyes.current[i] = el)} className="[transform-box:fill-box] origin-center">
            <circle cx={x} cy={1.5} r={5.5} fill="#fff" />
            <circle ref={(el) => void (pupils.current[i] = el)} cx={x} cy={1.5} r={2.7} fill="#101010" />
          </g>
        ))}
        <circle cx={0} cy={10} r={1.7} fill="none" stroke={ACCENT} strokeWidth={1.2} />
      </svg>
    </div>
  );
}
