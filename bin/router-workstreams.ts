import type http from "node:http";
import path from "node:path";
import { execa } from "execa";

import { escapeHtml } from "./router-docs.js";

interface RemovedState {
  at: string;
  finalSha?: string;
  merged: boolean;
}

export interface WorkstreamRow {
  name: string;
  path: string | null;
  git: { ahead: number | null; dirty: number | null; merged: boolean | null; tip: string | null } | null;
  runtime: { state: string };
  agent: { state: string; reason: string };
  session: {
    agent: string | null;
    hasSession: boolean;
    tty: string | null;
    emoji: string | null;
    baseSha: string | null;
    removed: RemovedState | null;
  };
  boxState: { testSetup: boolean; keepUnmerged: boolean; pristine: boolean | null };
}

export interface WorkstreamsDeps {
  list(): Promise<WorkstreamRow[]>;
}

function defaultDeps(repoRoot: string): WorkstreamsDeps {
  return {
    async list() {
      const result = await execa(path.join(repoRoot, "bin/workstreams"), ["list", "--json", "--include-removed"], {
        cwd: repoRoot,
        timeout: 10_000,
        killSignal: "SIGKILL",
      });
      return JSON.parse(result.stdout) as WorkstreamRow[];
    },
  };
}

function emoji(row: WorkstreamRow): string {
  return row.session.emoji ?? "·";
}

function rowHtml(row: WorkstreamRow, note: string): string {
  const box = row.boxState.keepUnmerged
    ? '<span class="chip held">keep unmerged</span>'
    : row.boxState.testSetup
      ? `<span class="chip held">test1 ${row.boxState.pristine === true ? "pristine" : "dirtied"}</span>`
      : "";
  return `<li><a href="/workstreams/${encodeURIComponent(row.name)}/"><span class="emoji">${escapeHtml(emoji(row))}</span>${escapeHtml(row.name)}</a><span>${escapeHtml(note)}</span>${box}</li>`;
}

function section(params: { title: string; rows: WorkstreamRow[]; note: (row: WorkstreamRow) => string }): string {
  const { title, rows, note } = params;
  if (rows.length === 0) return "";
  return `<section><h2>${escapeHtml(title)} <small>${rows.length}</small></h2><ul>${rows.map((row) => rowHtml(row, note(row))).join("")}</ul></section>`;
}

export function renderWorkstreams(rows: WorkstreamRow[]): string {
  const attached = rows.filter((row) => row.path !== null);
  const held = attached.filter((row) => row.agent.state !== "live" && (row.boxState.keepUnmerged || row.boxState.testSetup));
  const heldNames = new Set(held.map((row) => row.name));
  const untouched = attached.filter((row) =>
    !heldNames.has(row.name) && row.git?.dirty === 0 && row.git.tip !== null && row.git.tip === row.session.baseSha
  );
  const untouchedNames = new Set(untouched.map((row) => row.name));
  const mergedOpen = attached.filter((row) =>
    !heldNames.has(row.name) && !untouchedNames.has(row.name) && row.git?.merged === true && row.agent.state === "live"
  );
  const excluded = new Set([...heldNames, ...untouchedNames, ...mergedOpen.map((row) => row.name)]);
  const inProgress = attached.filter((row) => !excluded.has(row.name));
  const removed = rows.filter((row) => row.path === null && row.session.removed !== null);
  const culled = removed
    .filter((row) => row.session.removed?.merged === true)
    .sort((a, b) => (b.session.removed?.at ?? "").localeCompare(a.session.removed?.at ?? ""))
    .slice(0, 15);
  const forced = removed.filter((row) => row.session.removed?.merged === false);

  const body = [
    section({ title: "In progress", rows: inProgress, note: (row) => row.agent.state === "live" ? "session live" : "session closed" }),
    section({ title: "Merged ✓, session still open", rows: mergedOpen, note: () => "close freely" }),
    section({ title: "Untouched", rows: untouched, note: () => "created, no work committed" }),
    section({ title: "Held for testing", rows: held, note: () => "worktree held for testing" }),
    section({ title: "Recently culled", rows: culled, note: (row) => `removed ${row.session.removed?.at ?? ""}` }),
    section({ title: "Removed with unmerged work", rows: forced, note: (row) => `final ${row.session.removed?.finalSha?.slice(0, 10) ?? "SHA unavailable"}` }),
  ].join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="30"><title>workstreams</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;max-width:900px;margin:2em auto;padding:0 1em;color:#222}h1{font-size:1.4em}h2{font-size:1em;margin-top:1.8em}h2 small{color:#999;font-weight:400}ul{list-style:none;padding:0}li{display:flex;gap:1em;align-items:center;padding:.55em 0;border-bottom:1px solid #eee}li a{min-width:18em;font:600 14px ui-monospace,Menlo,monospace;color:#2255aa;text-decoration:none}.emoji{display:inline-block;width:1.8em}.chip{margin-left:auto;padding:.1em .45em;border-radius:4px;background:#eee;font-size:.8em}.held{background:#fff1c7;color:#765600}nav a{color:#2255aa}@media(max-width:600px){li{align-items:flex-start;flex-wrap:wrap}li a{min-width:100%}}
</style></head><body><nav><a href="/">router</a> · <a href="/workstreams/issues/">issues</a></nav><h1>workstreams</h1>${body || "<p>No workstreams recorded.</p>"}</body></html>`;
}

export async function serveWorkstreams(params: {
  method: string;
  pathname: string;
  repoRoot: string;
  res: http.ServerResponse;
  deps?: WorkstreamsDeps;
}): Promise<void> {
  const { method, pathname, repoRoot, res } = params;
  if (pathname === "/workstreams") {
    res.writeHead(301, { location: "/workstreams/" });
    res.end();
    return;
  }
  if (pathname !== "/workstreams/") {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("workstreams page not found\n");
    return;
  }
  const deps = params.deps ?? defaultDeps(repoRoot);
  try {
    const html = renderWorkstreams(await deps.list());
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    });
    res.end(method === "HEAD" ? undefined : html);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`workstreams listing failed: ${message.split("\n")[0]}\n`);
  }
}
