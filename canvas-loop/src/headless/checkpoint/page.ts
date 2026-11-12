// `cli checkpoints <dir> [--out page.html]`: one self-contained page that steps
// through saved checkpoints: each run's picture, note, time, which source files
// changed (lines added/removed), and the source as it stood.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { CheckpointMeta } from "./save.js";

interface Step {
  readonly seq: number;
  readonly at: string;
  readonly note: string;
  readonly errors: readonly string[];
  readonly image: string | undefined;
  readonly changes: readonly { file: string; added: number; removed: number }[];
  readonly sources: Record<string, string>;
}

/** Lines added and removed between two texts (longest common subsequence of lines). */
export function lineChanges(before: string, after: string): { added: number; removed: number } {
  const a = before.split("\n");
  const b = after.split("\n");
  let prev = new Uint32Array(b.length + 1);
  for (const lineA of a) {
    const row = new Uint32Array(b.length + 1);
    for (const [j, lineB] of b.entries()) row[j + 1] = lineA === lineB ? (prev[j] ?? 0) + 1 : Math.max(prev[j + 1] ?? 0, row[j] ?? 0);
    prev = row;
  }
  const common = prev[b.length] ?? 0;
  return { added: b.length - common, removed: a.length - common };
}

function readSources(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).toSorted()) out[name] = readFileSync(join(dir, name), "utf8");
  return out;
}

/** The picture to show for a run: its last captured full frame (not a zoom). */
function mainFrame(framesDir: string): string | undefined {
  if (!existsSync(framesDir)) return undefined;
  const frames = readdirSync(framesDir)
    .filter((n) => /^frame-\d+\.png$/.test(n))
    .toSorted();
  const last = frames.at(-1);
  return last === undefined ? undefined : `data:image/png;base64,${readFileSync(join(framesDir, last)).toString("base64")}`;
}

function loadSteps(dir: string): Step[] {
  const steps: Step[] = [];
  let previous: Record<string, string> = {};
  for (const name of readdirSync(dir).filter((n) => /^\d{4}$/.test(n)).toSorted()) {
    const at = join(dir, name);
    const meta: CheckpointMeta = JSON.parse(readFileSync(join(at, "meta.json"), "utf8"));
    const sources = readSources(join(at, "sources"));
    const files = [...new Set([...Object.keys(previous), ...Object.keys(sources)])].toSorted();
    const changes = files
      .map((file) => ({ file, ...lineChanges(previous[file] ?? "", sources[file] ?? "") }))
      .filter((c) => c.added + c.removed > 0);
    steps.push({ seq: meta.seq, at: meta.at, note: meta.note ?? "", errors: meta.errors, image: mainFrame(join(at, "frames")), changes, sources });
    previous = sources;
  }
  return steps;
}

const PAGE_SCRIPT = `
const steps = JSON.parse(document.getElementById("data").textContent);
const range = document.getElementById("step");
const esc = (t) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
function show(i) {
  const s = steps[i];
  document.getElementById("img").src = s.image ?? "";
  document.getElementById("head").textContent = "Checkpoint " + s.seq + " of " + steps.length + " — " + new Date(s.at).toLocaleString();
  document.getElementById("note").textContent = s.note || "(no note)";
  document.getElementById("errors").textContent = s.errors.join("\\n");
  document.getElementById("changes").innerHTML = s.changes.map((c) => "<li>" + esc(c.file) + " <span class=add>+" + c.added + "</span> <span class=del>−" + c.removed + "</span></li>").join("") || "<li>no source change</li>";
  document.getElementById("sources").innerHTML = Object.entries(s.sources).map(([f, t]) => "<details><summary>" + esc(f) + "</summary><pre>" + esc(t) + "</pre></details>").join("");
}
range.max = String(steps.length - 1);
range.addEventListener("input", () => show(Number(range.value)));
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") { range.value = String(Number(range.value) + (e.key === "ArrowRight" ? 1 : -1)); show(Number(range.value)); }
});
range.value = String(steps.length - 1);
show(steps.length - 1);
`;

/** The checkpoint page for `dir`, as one HTML string (images inlined). */
export function checkpointPage(dir: string, title: string): string {
  const data = JSON.stringify(loadSteps(dir)).replaceAll("</", "<\\/");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title.replaceAll("<", "&lt;")}</title>
<style>
body { margin: 0; background: #f7f5ef; color: #1e293b; font: 15px/1.5 ui-sans-serif, system-ui, sans-serif; padding-bottom: 48px; }
main { max-width: 1100px; margin: 0 auto; padding: 20px 16px; }
#step { width: 100%; }
img { max-width: 100%; border-radius: 6px; display: block; margin: 10px 0; }
#note { font-size: 17px; }
#errors { color: #b91c1c; white-space: pre-wrap; }
.add { color: #047857; } .del { color: #b91c1c; }
pre { background: #1b1f2a; color: #e2e8f0; padding: 12px; border-radius: 6px; overflow-x: auto; font: 12px/1.45 ui-monospace, monospace; max-height: 560px; }
</style></head>
<body><main>
<h1>${title.replaceAll("<", "&lt;")}</h1>
<p>Each checkpoint is one render the agent stopped to look at. Drag the slider or use ← →.</p>
<input type="range" id="step" min="0" step="1" />
<h2 id="head"></h2><p id="note"></p><p id="errors"></p>
<img id="img" alt="the rendered frame at this checkpoint" />
<h3>Changed since the previous checkpoint</h3><ul id="changes"></ul>
<h3>Source at this checkpoint</h3><div id="sources"></div>
</main>
<script type="application/json" id="data">${data}</script>
<script>${PAGE_SCRIPT}</script>
</body></html>
`;
}
