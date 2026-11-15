// GPU time per pass kind, from timestamp queries (the device needs the
// 'timestamp-query' feature). Each pass the renderer begins asks for its
// timestamp writes by kind; after the frame's work is done the intervals are
// read back and summed per kind. Passes past the query set's capacity go
// untimed and are counted. On tile-based GPUs pass intervals overlap; each
// pass is charged only its time after every earlier pass ended, so the kinds
// partition the frame's span (an attribution, not an exact cost).

/** What a pass does, for attribution. */
export type PassKind = "coverage" | "marks" | "clip" | "draw" | "effect" | "painterly" | "smear" | "light" | "raster" | "brush";

const CAPACITY = 4096;

/** One frame's GPU time: per kind (charged time, pass count), first begin to last end, passes not timed. */
export interface GpuTimes {
  readonly kinds: Record<string, { ms: number; passes: number }>;
  readonly spanMs: number;
  readonly untimed: number;
}

export class PassTimer {
  readonly #device: GPUDevice;
  readonly #set: GPUQuerySet;
  readonly #resolve: GPUBuffer;
  #kinds: PassKind[] = [];
  /** Passes begun after the query set was full. */
  untimed = 0;

  constructor(device: GPUDevice) {
    this.#device = device;
    this.#set = device.createQuerySet({ type: "timestamp", count: CAPACITY });
    this.#resolve = device.createBuffer({ size: CAPACITY * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
  }

  /** A new frame: forget the last frame's passes. */
  begin(): void {
    this.#kinds = [];
    this.untimed = 0;
  }

  /** Timestamp writes for one pass of `kind`, or undefined once the set is full. */
  writes(kind: PassKind): GPURenderPassTimestampWrites | undefined {
    const i = this.#kinds.length * 2;
    if (i + 2 > CAPACITY) {
      this.untimed++;
      return undefined;
    }
    this.#kinds.push(kind);
    return { querySet: this.#set, beginningOfPassWriteIndex: i, endOfPassWriteIndex: i + 1 };
  }

  /** Resolve this frame's queries into a buffer the caller maps after submitting; undefined when no pass was timed. */
  resolve(enc: GPUCommandEncoder, temp: GPUBuffer[]): GPUBuffer | undefined {
    const n = this.#kinds.length * 2;
    if (n === 0) return undefined;
    enc.resolveQuerySet(this.#set, 0, n, this.#resolve, 0);
    const read = this.#device.createBuffer({ size: n * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    enc.copyBufferToBuffer(this.#resolve, 0, read, 0, n * 8);
    temp.push(read);
    return read;
  }

  /** Milliseconds per pass kind, and the passes of each kind, read from `read` once the frame is done. */
  async read(read: GPUBuffer): Promise<GpuTimes> {
    await read.mapAsync(GPUMapMode.READ);
    const t = new BigUint64Array(read.getMappedRange());
    const kinds: Record<string, { ms: number; passes: number }> = {};
    let first: bigint | undefined;
    let last = 0n;
    for (const [k, kind] of this.#kinds.entries()) {
      const a = t[2 * k] ?? 0n;
      const b = t[2 * k + 1] ?? 0n;
      first ??= a;
      // Passes overlap on tile-based GPUs: each pass is charged only the time after every earlier pass ended, so kinds partition the span.
      const from = a > last ? a : last;
      const e = kinds[kind] ?? { ms: 0, passes: 0 };
      kinds[kind] = { ms: e.ms + (b > from ? Number(b - from) / 1e6 : 0), passes: e.passes + 1 };
      if (b > last) last = b;
    }
    read.unmap();
    return { kinds, spanMs: first === undefined || last < first ? 0 : Number(last - first) / 1e6, untimed: this.untimed };
  }

  destroy(): void {
    this.#set.destroy();
    this.#resolve.destroy();
  }
}
