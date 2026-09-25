/** The refusal a box's admission gate raises, shared by every caller that branches on it. */
/** One admitted piece of work, as another process sees it. */
export interface WorkHolder { pid: number; reason: string; since: string }

type MaintenanceRefusal = "foreign" | "expired" | "closed" | "nested" | "timeout";

/** A refusal that names what holds the box and, when it is known, how long. */
export class BoxMaintenanceError extends Error {
  readonly reason: MaintenanceRefusal;
  /** How long until a closed box is expected to reopen, when its phase records a deadline. */
  readonly retryAfterMs: number | undefined;
  /** The maintenance owner that refused this one, when another owner holds the box. */
  readonly holder: WorkHolder | undefined;
  constructor(opts: { reason: MaintenanceRefusal; detail?: string; retryAfterMs?: number; holder?: WorkHolder }) {
    const messages = {
      foreign: "Work permission belongs to another box", expired: "Work permission has expired",
      closed: "Box admission is closed; retry after maintenance",
      nested: "Nested maintenance is not allowed", timeout: "Timed out draining box work",
    };
    super(opts.reason === "closed" && opts.detail ? closedMessage(opts.detail, opts.retryAfterMs) : `${messages[opts.reason]}${opts.detail ? `: ${opts.detail}` : ""}`);
    this.name = "BoxMaintenanceError";
    this.reason = opts.reason;
    this.retryAfterMs = opts.retryAfterMs;
    this.holder = opts.holder;
  }
}

function closedMessage(reason: string, retryAfterMs: number | undefined): string {
  const wait = retryAfterMs === undefined ? "" : `; expected to reopen within ${String(Math.max(1, Math.ceil(retryAfterMs / 60_000)))} min`;
  return `Box is closed for ${reason}${wait}`;
}
