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
  run(verb: ActionVerb, name: string): Promise<void>;
}

type ActionVerb = "close" | "focus" | "resume";

const ACTION_PATH = /^\/workstreams\/action\/(close|focus|resume)\/([a-zA-Z0-9_-]+)$/;

function defaultDeps(repoRoot: string): WorkstreamsDeps {
  async function run(args: string[]): Promise<string> {
    const child = execa(path.join(repoRoot, "bin/workstreams"), args, {
      cwd: repoRoot,
      timeout: 10_000,
      killSignal: "SIGKILL",
      detached: true,
    });
    try {
      return (await child).stdout;
    } catch (error) {
      if (typeof error === "object" && error !== null && "timedOut" in error && error.timedOut === true && child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // The process group already exited.
        }
      }
      throw error;
    }
  }
  return {
    async list() {
      const stdout = await run(["list", "--json", "--include-removed"]);
      return JSON.parse(stdout) as WorkstreamRow[];
    },
    async run(verb, name) {
      await run([verb, name]);
    },
  };
}

function emoji(row: WorkstreamRow): string {
  return row.session.emoji ?? "·";
}

function actionForm(verb: ActionVerb, row: WorkstreamRow): string {
  const label = verb[0]?.toUpperCase() + verb.slice(1);
  return `<form method="POST" action="/workstreams/action/${verb}/${encodeURIComponent(row.name)}"><button type="submit">${label}</button></form>`;
}

function actionsHtml(row: WorkstreamRow): string {
  if (row.agent.state === "live") return actionForm("focus", row) + actionForm("close", row);
  if (row.session.removed?.merged === false) return "";
  if (row.session.hasSession) return actionForm("resume", row);
  return "";
}

function rowHtml(row: WorkstreamRow, note: string): string {
  const box = row.boxState.keepUnmerged
    ? '<span class="chip held">keep unmerged</span>'
    : row.boxState.testSetup
      ? `<span class="chip held">test1 ${row.boxState.pristine === true ? "pristine" : "dirtied"}</span>`
      : "";
  return `<li><a href="/workstreams/${encodeURIComponent(row.name)}/"><span class="emoji">${escapeHtml(emoji(row))}</span>${escapeHtml(row.name)}</a><span>${escapeHtml(note)}</span>${box}<span class="actions">${actionsHtml(row)}</span></li>`;
}

function section(params: { title: string; rows: WorkstreamRow[]; note: (row: WorkstreamRow) => string }): string {
  const { title, rows, note } = params;
  if (rows.length === 0) return "";
  return `<section><h2>${escapeHtml(title)} <small>${rows.length}</small></h2><ul>${rows.map((row) => rowHtml(row, note(row))).join("")}</ul></section>`;
}

export function renderWorkstreams(rows: WorkstreamRow[], flash = ""): string {
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
body{font:14px/1.5 system-ui,sans-serif;max-width:900px;margin:2em auto;padding:0 1em;color:#222}h1{font-size:1.4em}h2{font-size:1em;margin-top:1.8em}h2 small{color:#999;font-weight:400}ul{list-style:none;padding:0}li{display:flex;gap:1em;align-items:center;padding:.55em 0;border-bottom:1px solid #eee}li>a{min-width:18em;font:600 14px ui-monospace,Menlo,monospace;color:#2255aa;text-decoration:none}.emoji{display:inline-block;width:1.8em}.chip{margin-left:auto;padding:.1em .45em;border-radius:4px;background:#eee;font-size:.8em}.held{background:#fff1c7;color:#765600}nav a{color:#2255aa}.actions{display:flex;gap:.4em;margin-left:auto}.actions form{margin:0}.flash{background:#eef6ff;border:1px solid #bbd8f5;padding:.6em .8em}@media(max-width:600px){li{align-items:flex-start;flex-wrap:wrap}li>a{min-width:100%}}
</style></head><body><nav><a href="/">router</a> · <a href="/workstreams/issues/">issues</a></nav><h1>workstreams</h1>${flash ? `<p class="flash">${escapeHtml(flash)}</p>` : ""}${body || "<p>No workstreams recorded.</p>"}</body></html>`;
}

function firstErrorLine(error: unknown): string {
  if (typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string") {
    const line = error.stderr.split("\n").find((part) => part.trim() !== "");
    if (line) return line;
  }
  return error instanceof Error ? error.message.split("\n")[0] ?? "command failed" : String(error);
}

async function serveAction(pathname: string, deps: WorkstreamsDeps, res: http.ServerResponse): Promise<void> {
  const match = ACTION_PATH.exec(pathname);
  if (!match) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("unknown workstreams action\n");
    return;
  }
  const verb = match[1] as ActionVerb;
  const name = match[2] ?? "";
  let flash = `${verb} ${name}: done`;
  try {
    await deps.run(verb, name);
  } catch (error) {
    flash = `${verb} ${name}: ${firstErrorLine(error)}`;
  }
  res.writeHead(303, { location: `/workstreams/?flash=${encodeURIComponent(flash)}` });
  res.end();
}

export async function serveWorkstreams(params: {
  method: string;
  pathname: string;
  repoRoot: string;
  res: http.ServerResponse;
  deps?: WorkstreamsDeps;
  flash?: string;
}): Promise<void> {
  const { method, pathname, repoRoot, res } = params;
  const deps = params.deps ?? defaultDeps(repoRoot);
  if (method === "POST" && pathname.startsWith("/workstreams/action/")) {
    await serveAction(pathname, deps, res);
    return;
  }
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
  try {
    const html = renderWorkstreams(await deps.list(), params.flash ?? "");
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
