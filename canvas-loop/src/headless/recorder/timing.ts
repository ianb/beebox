// `run --timing`: how long each frame's draw (and, for TEA, the fold) takes,
// summarised into the transcript. Wall-clock, so the summary differs between
// runs; the rendered frames do not.

function ms(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function summary(label: string, samples: readonly number[]): string {
  if (samples.length === 0) return `${label}: no frames`;
  const sorted = samples.toSorted((a, b) => a - b);
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  return `${label} avg ${avg.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${(sorted.at(-1) ?? 0).toFixed(2)} ms`;
}

export class FrameTimer {
  #draw: number[] = [];
  #update: number[] = [];
  #first: number | undefined;

  /** Time one frame's draw; frame 0 (which paints caches and sprites) is reported apart. */
  draw<T>(frame: number, body: () => T): T {
    const start = process.hrtime.bigint();
    const result = body();
    if (frame === 0) this.#first = ms(start);
    else this.#draw.push(ms(start));
    return result;
  }

  /** Time one frame's update fold (TEA). */
  update(body: () => void): void {
    const start = process.hrtime.bigint();
    body();
    this.#update.push(ms(start));
  }

  report(): string {
    const parts = [summary("draw", this.#draw)];
    if (this.#update.length > 0) parts.push(summary("update", this.#update));
    if (this.#first !== undefined) parts.push(`frame 0 draw ${this.#first.toFixed(1)} ms (builds caches and sprites)`);
    return `timing: ${parts.join("; ")}`;
  }
}
