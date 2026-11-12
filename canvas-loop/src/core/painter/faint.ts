// Faint-mark warnings: a mark whose strongest pixel lands under a few percent
// opacity (after its brush and any open groups) cannot be seen, and an agent
// would otherwise spend a render cycle discovering that.

/** A mark whose strongest pixel is under this opacity counts as too faint to see. */
const FAINT = 0.08;
const MAX_WARNINGS = 8;

export class FaintWatch {
  #warn: (message: string) => void;
  #count = 0;

  constructor(warn: (message: string) => void) {
    this.#warn = warn;
  }

  /** Check one mark's landed strength; warn a few times per run, then once that the rest are suppressed. */
  /** `where` names the sprite or cache the mark was drawn into (its position is in that layer's coordinates). */
  check(peak: { alpha: number; x: number; y: number }, args: { groupAlphas: readonly number[]; where: string | undefined }): void {
    const alpha = args.groupAlphas.reduce((a, b) => a * b, peak.alpha);
    if (alpha >= FAINT || this.#count > MAX_WARNINGS) return;
    this.#count += 1;
    if (this.#count > MAX_WARNINGS) {
      this.#warn("faint marks: more marks are too faint to see; further warnings suppressed");
      return;
    }
    const at = `(${Math.round(peak.x)}, ${Math.round(peak.y)})${args.where === undefined ? "" : ` in ${args.where}`}`;
    this.#warn(`faint mark near ${at}: it reaches only ${Math.round(alpha * 100)}% opacity and will barely show (gesture({ faint: true }) marks it as intended)`);
  }
}
