// Pendulum physics and the places it can swing.
//
// The swing integrates the full equation θ'' = −(g/L)·sin θ with RK4, so a
// large release angle really is a little slower than the small-angle formula
// T = 2π√(L/g). A "full swing" ends each time the bob comes back to the side it
// was released from: the angular velocity crosses from + to −. The crossing
// instant is interpolated inside the substep, so the stopwatch is not tied to
// the frame rate.

export const PLANETS = ["Earth", "Moon", "Mars", "Jupiter"] as const;
export type Planet = (typeof PLANETS)[number];

/** Surface gravity in m/s². */
export const GRAVITY: Record<Planet, number> = {
  Earth: 9.81,
  Moon: 1.62,
  Mars: 3.71,
  Jupiter: 24.79,
};

export const PLANET_COLOR: Record<Planet, string> = {
  Earth: "#2d72c4",
  Moon: "#6e7380",
  Mars: "#c4492b",
  Jupiter: "#d48a1e",
};

export const SWINGS_PER_TRIAL = 10;

export function theoryPeriod(length: number, planet: Planet): number {
  return 2 * Math.PI * Math.sqrt(length / GRAVITY[planet]);
}

export interface Swing {
  /** Angle from straight down, radians; positive is to the right. */
  theta: number;
  omega: number;
  /** Seconds since release. */
  t: number;
  /** Full swings completed since release. */
  swings: number;
  length: number;
  planet: Planet;
  /** Release angle in degrees, as the learner typed it. */
  angle: number;
}

export function release(a: { length: number; planet: Planet; angle: number }): Swing {
  return { theta: (a.angle * Math.PI) / 180, omega: 0, t: 0, swings: 0, ...a };
}

function accel(theta: number, k: number): number {
  return -k * Math.sin(theta);
}

/** One RK4 step of length h. */
function rk4(s: { theta: number; omega: number }, a: { h: number; k: number }): { theta: number; omega: number } {
  const { h, k } = a;
  const k1t = s.omega;
  const k1w = accel(s.theta, k);
  const k2t = s.omega + (h / 2) * k1w;
  const k2w = accel(s.theta + (h / 2) * k1t, k);
  const k3t = s.omega + (h / 2) * k2w;
  const k3w = accel(s.theta + (h / 2) * k2t, k);
  const k4t = s.omega + h * k3w;
  const k4w = accel(s.theta + h * k3t, k);
  return {
    theta: s.theta + (h / 6) * (k1t + 2 * k2t + 2 * k3t + k4t),
    omega: s.omega + (h / 6) * (k1w + 2 * k2w + 2 * k3w + k4w),
  };
}

export interface Advanced {
  swing: Swing;
  /** Set on the substep where the tenth full swing ends: the interpolated time. */
  finishedAt: number | null;
}

/** Advance the swing by `seconds` of simulated time in small RK4 substeps. */
export function advance(swing: Swing, seconds: number): Advanced {
  const substeps = Math.max(4, Math.ceil(seconds / (1 / 480)));
  const h = seconds / substeps;
  const k = GRAVITY[swing.planet] / swing.length;
  let s = { ...swing };
  let finishedAt: number | null = null;
  for (let i = 0; i < substeps; i += 1) {
    const next = rk4(s, { h, k });
    const crossed = s.omega > 0 && next.omega <= 0;
    const crossAt = crossed ? s.t + (h * s.omega) / (s.omega - next.omega) : 0;
    const swings = crossed ? s.swings + 1 : s.swings;
    if (crossed && swings === SWINGS_PER_TRIAL) finishedAt = crossAt;
    s = { ...s, ...next, t: s.t + h, swings };
  }
  return { swing: s, finishedAt };
}
