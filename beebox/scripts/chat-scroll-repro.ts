/** Reproduce send anchoring in the real UI, against an existing TEST conversation. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const root = path.resolve(import.meta.dirname, "../..");
const url = process.argv[2];
const output = path.resolve(process.argv[3] ?? path.join(root, "scratch/chat-scroll-repro"));
const traceEnabled = process.env.SCROLL_REPRO_TRACE !== "0";
if (!url?.startsWith("/chat?session=")) {
  console.error("Usage: node --import tsx beebox/scripts/chat-scroll-repro.ts '/chat?session=TEST_SESSION' [output-dir]");
  process.exit(2);
}
mkdirSync(output, { recursive: true });

function browse(args: string[]): string {
  return execFileSync(path.join(root, "bin/browse"), args, {
    cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  }).trim();
}
function evaluate(script: string): string {
  return browse(["eval", "--no-wait", script]);
}

const measurement = z.object({
  userTop: z.number(),
  addedUsers: z.number(),
  easeCancelled: z.boolean().nullable(),
  dropped: z.number(),
});
let failures = 0;
try {
  for (let trial = 1; trial <= 3; trial++) {
    // Navigation resets the frontend-only stream. The authoritative history
    // remains the same; this probe does not claim to test stream finalization.
    browse(["open", url]);
    evaluate("new Promise(resolve => setTimeout(resolve, 1200))");
    evaluate(`(() => {
      const s = document.querySelector('[data-testid=chat-scroller]');
      if (!s || s.scrollHeight < s.clientHeight + 200) throw Error('Need a test conversation longer than one screen');
      if (!window.__bbxScrollTrace) throw Error('Scroll instrumentation unavailable');
      window.__scrollRepro = {events: [], dropped: 0, userCount: s.querySelectorAll('[data-role=user]').length};
      window.__bbxScrollTrace.subscribe(${traceEnabled} ? e => {
        if (window.__scrollRepro.events.length < 6000) window.__scrollRepro.events.push(e);
        else window.__scrollRepro.dropped++;
      } : null);
      window.__bbxScrollTrace.enable(${traceEnabled});
      return 'recording';
    })()`);
    const draft = ["/fakestream 600 100 40", ...Array.from({ length: 7 }, (_, i) => `line ${i + 2}`)].join("\n");
    browse(["fill", "bbx-composer-input", draft]);
    browse(["click", "bbx-composer-send"]);
    const result = measurement.parse(JSON.parse(evaluate(`new Promise(resolve => setTimeout(() => {
      const s = document.querySelector('[data-testid=chat-scroller]');
      const u = [...s.querySelectorAll('[data-role=user]')].at(-1);
      resolve({userTop: u.getBoundingClientRect().top - s.getBoundingClientRect().top,
        addedUsers: s.querySelectorAll('[data-role=user]').length - window.__scrollRepro.userCount,
        easeCancelled: ${traceEnabled} ? window.__scrollRepro.events.some(e => e.k === 'ease-stop' && !e.finish) : null,
        dropped: window.__scrollRepro.dropped});
    }, 800))`)));
    const trace = evaluate("window.__scrollRepro");
    writeFileSync(path.join(output, `trial-${trial}.json`), trace + "\n");
    const screenshot = path.join(output, `trial-${trial}.png`);
    browse(["screenshot", screenshot]);
    evaluate("window.__bbxScrollTrace.enable(false); window.__bbxScrollTrace.subscribe(null)");
    const pass = Math.abs(result.userTop) <= 2 && result.addedUsers === 1 && result.dropped === 0;
    if (!pass) failures++;
    console.log(JSON.stringify({ trial, pass, ...result }));
  }
  process.exitCode = failures > 0 ? 1 : 0;
} catch (error: unknown) {
  console.error("Reproduction setup or execution failed:", error);
  process.exitCode = 2;
} finally {
  try {
    evaluate("window.__bbxScrollTrace?.enable(false); window.__bbxScrollTrace?.subscribe(null)");
    // Stop the synthetic stream and restore the conversation's stored state.
    browse(["open", url]);
  } catch (error: unknown) {
    console.error("Could not clean up reproduction browser:", error);
    process.exitCode = 2;
  }
}
