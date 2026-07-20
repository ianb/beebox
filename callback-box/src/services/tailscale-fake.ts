/**
 * Read-only fake `TailscaleDeps` for the status state machine's doctests. It
 * scripts the two `tailscale ... --json` subcommands, a single `/auth/me`-style
 * probe, and the non-loopback address list — with no tailnet.
 *
 * Two fail-closed properties the review (Track B adversarial pass) demanded of
 * the fake:
 *   - per-command exit codes (`statusCode`/`serveCode`) so the cli-error state
 *     is exercisable, not just spawn failure;
 *   - an UNRECOGNIZED `tailscale` invocation THROWS rather than returning exit 0,
 *     so a test can never silently pass against a command the fake never modeled.
 *
 * The stateful serve simulator that models `tailscale serve` MUTATIONS
 * (`--bg`/`… off`, foreground funnel) lives in the setup doctest itself, since
 * only setup/stop issue writes.
 */

import type {
  CommandResult,
  ListNetworkAddresses,
  ProbeResult,
  TailscaleDeps,
} from "./tailscale.js";

export interface FakeTailscaleOptions {
  /** Default true; false makes every `tailscale` call unspawnable (binary absent). */
  binaryPresent?: boolean;
  /** `tailscale status --json` stdout: an object to serialize, or a raw string. */
  status?: unknown;
  /** Exit code for `tailscale status --json` (default 0). Nonzero ⇒ cli-error. */
  statusCode?: number;
  /** `tailscale serve status --json` stdout: an object to serialize, or a raw string. */
  serve?: unknown;
  /** Exit code for `tailscale serve status --json` (default 0). Nonzero ⇒ cli-error. */
  serveCode?: number;
  /** What the injected probe returns for every probed URL. */
  probe?: ProbeResult;
  /** Non-loopback interface addresses the bind guard enumerates (default none). */
  networkAddresses?: string[];
}

/** Thrown when a doctest drives the fake with a `tailscale` command it never
 *  modeled — a modeling gap must fail loudly, never pass as a no-op exit 0. */
export class UnexpectedTailscaleCommandError extends Error {
  constructor(readonly command: string) {
    super("fake tailscale deps received an unmodeled command: " + command);
    this.name = "UnexpectedTailscaleCommandError";
  }
}

function stdoutFor(value: unknown): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function createFakeTailscaleDeps(options: FakeTailscaleOptions): TailscaleDeps {
  const binaryPresent = options.binaryPresent ?? true;
  const notSpawned: CommandResult = { spawned: false, code: null, stdout: "", stderr: "" };
  const networkInterfaces: ListNetworkAddresses = () => options.networkAddresses ?? [];
  return {
    run: (cmd, args) => {
      if (cmd !== "tailscale" || !binaryPresent) return Promise.resolve(notSpawned);
      const sub = args.join(" ");
      if (sub === "status --json") {
        return Promise.resolve({ spawned: true, code: options.statusCode ?? 0, stdout: stdoutFor(options.status), stderr: "" });
      }
      if (sub === "serve status --json") {
        return Promise.resolve({ spawned: true, code: options.serveCode ?? 0, stdout: stdoutFor(options.serve), stderr: "" });
      }
      const invocation = `tailscale ${sub}`;
      throw new UnexpectedTailscaleCommandError(invocation);
    },
    probe: () => Promise.resolve(options.probe ?? { reachable: false, status: null }),
    networkInterfaces,
  };
}
