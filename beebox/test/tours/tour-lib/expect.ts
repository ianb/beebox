/**
 * Soft assertions: tours don't throw when expectations miss — they
 * accumulate findings into a per-tour list that ends up in summary.md.
 * Authors can scan the summary to see which expectations failed without
 * losing the rest of the tour run.
 */

import type { BrowseSession } from "./browse.js";
import { escapeForRegex, snapshotRegex } from "./snapshot-regex.js";
import type { ExpectAPI, Finding, Severity, Viewport } from "./types.js";

interface ExpectContext {
  session: BrowseSession;
  viewport: Viewport;
  checkpointName: () => string;
  pushFinding: (f: Finding) => void;
}

/** Render a locator name for a finding message: exact strings stay quoted, patterns show as regex literals. */
function describe(name: string | RegExp): string {
  return typeof name === "string" ? `"${name}"` : String(name);
}

function record(ctx: ExpectContext, { severity, message }: { severity: Severity; message: string }): void {
  ctx.pushFinding({ severity, checkpoint: ctx.checkpointName(), viewport: ctx.viewport, message });
}

export function buildExpectAPI(ctx: ExpectContext): ExpectAPI {
  return {
    async heading(name, opts) {
      const snap = await ctx.session.snapshot({ interactiveOnly: false });
      const level = opts?.level;
      const escaped = escapeForRegex(name);
      // Snapshot attribute brackets look like `[level=1, ref=e12]` — match the
      // requested attribute anywhere inside the bracket group, not just at
      // the end.
      const levelClause = level === undefined ? "" : `\\s*\\[(?:[^\\]]*,\\s*)?level=${level}(?:[\\s,\\]])`;
      const re = snapshotRegex(`heading\\s+"${escaped}"${levelClause}`);
      if (!re.test(snap)) {
        const where = level === undefined ? `heading "${name}"` : `heading "${name}" at level ${level}`;
        record(ctx, { severity: "fail", message: `expected ${where} not found in snapshot` });
      }
    },
    async landmark(name) {
      const snap = await ctx.session.snapshot({ interactiveOnly: false });
      const escaped = escapeForRegex(name);
      const re = snapshotRegex(`(?:region|navigation|main|complementary|contentinfo|banner|search|form)\\s+"${escaped}"`, "i");
      if (!re.test(snap)) {
        record(ctx, { severity: "fail", message: `expected landmark named "${name}" not found in snapshot` });
      }
    },
    async button(name) {
      const ref = await ctx.session.findRef("button", name);
      if (ref === null) {
        record(ctx, { severity: "fail", message: `expected button ${describe(name)} not found in interactive snapshot` });
      }
    },
    async noPageErrors() {
      // The app bar renders an error badge only when the client debug log has
      // entries; its accessible name carries the count (AppNav ErrorBadge).
      const snap = await ctx.session.snapshot({ interactiveOnly: true });
      const m = snap.match(/Open debug log \((\d+) errors?\)/);
      if (m === null) return;
      const count = Number(m[1]);
      if (count > 0) {
        record(ctx, {
          severity: "fail",
          message: `page reported ${count} client error${count === 1 ? "" : "s"} (app-bar debug log badge)`,
        });
      }
    },
    async custom(message, predicate) {
      const snap = await ctx.session.snapshot({ interactiveOnly: false });
      if (!predicate(snap)) {
        record(ctx, { severity: "fail", message });
      }
    },
  };
}
