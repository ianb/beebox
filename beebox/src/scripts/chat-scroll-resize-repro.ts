/** Real-chat reading-position check across composer growth. TEST conversations only. */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const root = path.resolve(import.meta.dirname, "../..");
const url = process.argv[2];
const output = path.resolve(process.argv[3] ?? path.join(root, "scratch/chat-scroll-resize"));
if (!url?.startsWith("/chat?session=")) {
  console.error("Usage: node --import tsx beebox/scripts/chat-scroll-resize-repro.ts '/chat?session=TEST_SESSION' [output-dir]");
  process.exit(2);
}
mkdirSync(output, { recursive: true });

function browse(...args: string[]): string {
  return execFileSync(path.join(root, "bin/browse"), ["--session", "chat-scroll-resize", ...args], {
    // Preserve the CLI environment while pinning the dedicated test box.
    env: { ...process.env, BROWSE_BOX: "test1" },
    cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  }).trim();
}
function evaluate(script: string): string { return browse("eval", "--no-wait", script); }
function settle(): void {
  evaluate(`new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Browser delivered no animation frame')), 5000);
    setTimeout(() => requestAnimationFrame(() => { clearTimeout(timeout); resolve(null); }), 500);
  })`);
}

class InitialPositionError extends Error {
  constructor() { super("Initial reading position did not settle"); this.name = "InitialPositionError"; }
}

const geometry = z.object({ connected: z.literal(true), top: z.number(), height: z.number(), fromBottom: z.number(), markerTop: z.number() });
const measure = `(() => {
  const s = document.querySelector('[data-testid=chat-scroller]');
  return {connected:window.__resizeRepro.marker.isConnected, top:s.scrollTop, height:s.clientHeight,
    fromBottom:s.scrollHeight-s.clientHeight-s.scrollTop,
    markerTop:window.__resizeRepro.marker.getBoundingClientRect().top-s.getBoundingClientRect().top};
})()`;

try {
  browse("open", url);
  browse("set", "viewport", "1280", "577");
  const results = [];
  for (const gap of [0, 200]) {
    browse("open", url);
    settle();
    evaluate("document.getElementById('bbx-composer-input').select()");
    browse("press", "Backspace");
    settle();
    evaluate(`(() => {
      const s = document.querySelector('[data-testid=chat-scroller]');
      if (!s || s.scrollHeight-s.clientHeight < 300) throw Error('Need a longer test conversation');
      s.scrollTop = s.scrollHeight-s.clientHeight-${gap};
      return null;
    })()`);
    settle();
    evaluate(`(() => {
      const s = document.querySelector('[data-testid=chat-scroller]');
      const rect = s.getBoundingClientRect();
      const marker = [...s.querySelectorAll('p,li')].find(el => {
        const top = el.getBoundingClientRect().top;
        return top >= rect.top && top < rect.bottom;
      });
      if (!marker) throw Error('Need a visible paragraph or list item');
      window.__resizeRepro = {marker,events:[]};
      window.__bbxScrollTrace.subscribe(e => {
        if (window.__resizeRepro.events.length < 6000) window.__resizeRepro.events.push(e);
      });
      window.__bbxScrollTrace.enable(true);
      return null;
    })()`);
    const before = geometry.parse(JSON.parse(evaluate(measure)));
    if (Math.abs(before.fromBottom - gap) > 2) throw new InitialPositionError();
    browse("fill", "bbx-composer-input", Array.from({ length: 8 }, (_, i) => `Draft line ${i + 1}`).join("\n"));
    settle();
    const after = geometry.parse(JSON.parse(evaluate(measure)));
    const drift = after.markerTop - before.markerTop;
    const pass = after.height < before.height && (gap === 0 ? Math.abs(after.fromBottom) <= 2 : Math.abs(drift) <= 2);
    const result = { gap, pass, drift, before, after };
    results.push(result);
    console.log(JSON.stringify(result));
    writeFileSync(path.join(output, `gap-${gap}.json`), evaluate("window.__resizeRepro.events") + "\n");
    evaluate("window.__bbxScrollTrace.enable(false); window.__bbxScrollTrace.subscribe(null)");
    // Empty fill changed the DOM without clearing React state in the browser
    // driver during investigation. Select then send a real deletion event.
    evaluate("document.getElementById('bbx-composer-input').select()");
    browse("press", "Backspace");
    settle();
  }
  writeFileSync(path.join(output, "results.json"), JSON.stringify(results, null, 2) + "\n");
  process.exitCode = results.every((result) => result.pass) ? 0 : 1;
} catch (error: unknown) {
  console.error("Resize reproduction setup or execution failed:", error);
  process.exitCode = 2;
} finally {
  try {
    evaluate("window.__bbxScrollTrace?.enable(false); window.__bbxScrollTrace?.subscribe(null)");
    const selected = evaluate("(() => { const c = document.getElementById('bbx-composer-input'); if (!c) return false; c.select(); return true; })()");
    if (selected === "true") browse("press", "Backspace");
    browse("close");
  } catch (error: unknown) {
    console.error("Could not clean up resize reproduction:", error);
    process.exitCode = 2;
  }
}
