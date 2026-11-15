// A frame's GPU error scopes. The scope stack belongs to the device, which
// every figure on a page shares, so a frame pushes its scopes and pops all of
// them in one synchronous step and only then awaits the results: awaiting
// between pops would let another figure's frame push or pop in between and
// take this frame's errors (or give it its own).

/** The part of a `GPUDevice` error scopes need. */
export interface ScopeDevice {
  pushErrorScope(filter: GPUErrorFilter): void;
  popErrorScope(): Promise<GPUError | null>;
}

export class ErrorScopes {
  readonly #device: ScopeDevice;
  #open = 0;

  constructor(device: ScopeDevice) {
    this.#device = device;
  }

  push(filters: readonly GPUErrorFilter[]): void {
    for (const f of filters) {
      this.#device.pushErrorScope(f);
      this.#open++;
    }
  }

  /** Pop every scope still open, synchronously, then wait for their errors. A pop that fails (a lost device) counts as no error. */
  async popAll(): Promise<GPUError[]> {
    const pops: Promise<GPUError | null>[] = [];
    for (; this.#open > 0; this.#open--) pops.push(this.#device.popErrorScope());
    const results = await Promise.allSettled(pops);
    const errors: GPUError[] = [];
    for (const r of results) if (r.status === "fulfilled" && r.value !== null) errors.push(r.value);
    return errors;
  }
}
