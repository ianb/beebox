# The CODING_FEEDBACK CLI (bin/coding-feedback)

`bin/coding-feedback add` writes one retrospective note to
`<exhibits store>/<workstream>/coding-feedback/`, with YAML frontmatter that
attaches it to a checkout state and a session transcript. These tests point
`BBX_EXHIBITS_ROOT` at a temp store and `HOME` at a fake home holding fixture
transcripts, and drive the CLI from a temp git checkout, so nothing touches the
real store or the developer's transcripts. Both session variables are removed
from the child environment unless a test sets them, because this suite may
itself run inside a Claude or Codex session.

```ts setup
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, readdir, utimes, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), "..");
const cliTs = join(repoRoot, "bin/coding-feedback.ts");
// The fixture checkout has no node_modules, so `--import tsx` cannot resolve
// from its cwd; load tsx from this repository instead.
const tsxLoader = pathToFileURL(join(repoRoot, "node_modules/tsx/dist/loader.mjs")).href;

const root = await realpath(await mkdtemp(join(tmpdir(), "coding-feedback-doctest-")));
const store = join(root, "workstream-exhibits");
const home = join(root, "home");
const mono = join(root, "beebox");
const worktree = join(root, "beebox-worktrees", "demo");

async function git(cwd: string, ...args: string[]) {
  return execFileAsync("git", args, { cwd });
}
await mkdir(mono, { recursive: true });
await git(mono, "init", "-b", "main");
await git(mono, "config", "user.email", "test@example.com");
await git(mono, "config", "user.name", "Coding Feedback Test");
await writeFile(join(mono, "README.md"), "fixture\n");
await git(mono, "add", "README.md");
await git(mono, "commit", "-m", "fixture");
await git(mono, "worktree", "add", "-b", "worktree-demo", worktree, "main");

// Fixture transcripts. Claude: <projects>/<cwd with non-alphanumerics as "-">/<id>.jsonl.
const claudeDir = join(home, ".claude/projects", worktree.replaceAll(/[^\dA-Za-z]/g, "-"));
const claudeSibling = `${claudeDir}-two`;
await mkdir(claudeDir, { recursive: true });
await mkdir(claudeSibling, { recursive: true });
const claudeLine = (cwd: string, id: string) => `${JSON.stringify({ type: "user", cwd, sessionId: id })}\n`;
const claudeOld = join(claudeDir, "aaaaaaaa-0000-4000-8000-000000000001.jsonl");
const claudeNew = join(claudeDir, "bbbbbbbb-0000-4000-8000-000000000002.jsonl");
// Newest of all, in a prefix-matching project dir, but its cwd is another checkout.
const claudeOther = join(claudeSibling, "cccccccc-0000-4000-8000-000000000003.jsonl");
await writeFile(claudeOld, claudeLine(worktree, "aaaaaaaa-0000-4000-8000-000000000001"));
await writeFile(claudeNew, `{"type":"summary"}\n${claudeLine(worktree, "bbbbbbbb-0000-4000-8000-000000000002")}`);
await writeFile(claudeOther, claudeLine(`${worktree}-two`, "cccccccc-0000-4000-8000-000000000003"));

// Codex: sessions/YYYY/MM/DD/rollout-<time>-<thread id>.jsonl, first line session_meta.
const codexDay = join(home, ".codex/sessions/2026/10/07");
await mkdir(codexDay, { recursive: true });
const codexId = "01a11884-dc75-7862-9a3c-61d4e5cc3daf";
const codexMain = join(codexDay, `rollout-2026-10-07T17-38-43-${codexId}.jsonl`);
const codexSub = join(codexDay, "rollout-2026-10-07T17-40-00-01a11884-ffff-7862-9a3c-61d4e5cc3daf.jsonl");
const meta = (payload: object) => `${JSON.stringify({ type: "session_meta", payload })}\n`;
await writeFile(codexMain, meta({ id: codexId, cwd: worktree, thread_source: "user" }));
await writeFile(codexSub, meta({ id: "01a11884-ffff-7862-9a3c-61d4e5cc3daf", cwd: worktree, thread_source: "subagent" }));
const codexOldSub = join(codexDay, "rollout-2026-10-07T17-41-00-01a11884-eeee-7862-9a3c-61d4e5cc3daf.jsonl");
await writeFile(codexOldSub, meta({ id: "01a11884-eeee-7862-9a3c-61d4e5cc3daf", cwd: worktree, parent_thread_id: codexId }));

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);
async function age(file: string, minutesAgo: number) {
  await utimes(file, at(minutesAgo), at(minutesAgo));
}
await age(claudeOld, 30);
await age(claudeNew, 10);
await age(claudeOther, 1);
await age(codexMain, 20);
await age(codexSub, 2);
await age(codexOldSub, 3);

const baseEnv: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && k !== "CLAUDE_CODE_SESSION_ID" && k !== "CODEX_THREAD_ID") baseEnv[k] = v;
}
baseEnv.HOME = home;
baseEnv.BBX_EXHIBITS_ROOT = store;

async function run(args: string[], opts: { cwd?: string; input?: string; env?: Record<string, string> } = {}) {
  const child = execFile("node", ["--import", tsxLoader, cliTs, ...args], {
    cwd: opts.cwd ?? worktree,
    env: { ...baseEnv, ...opts.env },
  });
  child.stdin?.end(opts.input ?? "");
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (d) => (stdout += d));
  child.stderr?.on("data", (d) => (stderr += d));
  const code: number = await new Promise((done) => child.on("close", (c) => done(c ?? 1)));
  return { code, stdout, stderr };
}

async function frontmatter(file: string) {
  const text = await readFile(file, "utf8");
  const [, yaml = "", body = ""] = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/u.exec(text) ?? [];
  return { meta: parseYaml(yaml), body };
}

const body = "1. Lint rules took three rounds.\n2. bin/AGENTS.md lacked X.\n3. Add X.\n4. A shared seam.\n";
```

With no session variable, `add` from the worktree attaches the most recently
modified transcript for this checkout: a Claude transcript in the project
directory named for the checkout root (no Claude content is read), or a Codex
rollout whose `session_meta` cwd is the checkout. Here that is the newer Claude
transcript. The newest file overall sits in a prefix-matching project directory
for another checkout, and the two newest Codex rollouts are subagents' (one
marked by `thread_source`, an older one only by `parent_thread_id`); all are
passed over. Stdout is one line, the written path, under
`<store>/demo/coding-feedback/`. The frontmatter carries every field in this
order, and the body follows verbatim. The checkout stays clean: nothing was
written into it.

```ts
const added = await run(["add", "--checkpoint", "implemented"], { input: body });
const written = added.stdout.trim();
const { meta: m, body: storedBody } = await frontmatter(written);
const head = (await git(worktree, "rev-parse", "HEAD")).stdout.trim();
JSON.stringify({
  code: added.code,
  stdoutLines: added.stdout.trimEnd().split("\n").length,
  path: written.startsWith(join(store, "demo/coding-feedback/")) && /\/\d{8}T\d{6}Z-implemented\.md$/u.test(written),
  keys: Object.keys(m),
  workstream: m.workstream,
  checkpoint: m.checkpoint,
  headMatches: m.head === head,
  branch: m.branch,
  dirty: m.dirty,
  engine: m.engine,
  sessionId: m.sessionId,
  transcript: m.transcriptPath === claudeNew,
  resolvedBy: m.resolvedBy,
  timesIso: [m.timestamp, m.resolvedAt].every((t: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(t)),
  bodyVerbatim: storedBody === body,
  marker: (await readdir(store)).includes(".workstream-exhibits"),
  checkoutClean: (await git(worktree, "status", "--porcelain")).stdout === "",
})
=> {"code":0,"stdoutLines":1,"path":true,"keys":["timestamp","workstream","checkpoint","head","branch","dirty","engine","sessionId","transcriptPath","resolvedBy","resolvedAt"],"workstream":"demo","checkpoint":"implemented","headMatches":true,"branch":"worktree-demo","dirty":false,"engine":"claude","sessionId":"bbbbbbbb-0000-4000-8000-000000000002","transcript":true,"resolvedBy":"mtime","timesIso":true,"bodyVerbatim":true,"marker":true,"checkoutClean":true}
```

When the Codex rollout is the most recently written, the mtime guess picks it,
and the session id comes from its `session_meta`. `--engine claude` restricts
the guess to Claude transcripts.

```ts
await age(codexMain, 5);
const codex = await frontmatter((await run(["add", "--checkpoint", "landed"], { input: body })).stdout.trim());
const claudeOnly = await frontmatter((await run(["add", "--checkpoint", "landed", "--engine", "claude"], { input: body })).stdout.trim());
await age(codexMain, 20);
JSON.stringify({
  codex: [codex.meta.engine, codex.meta.sessionId, codex.meta.transcriptPath === codexMain, codex.meta.resolvedBy],
  claudeOnly: [claudeOnly.meta.engine, claudeOnly.meta.sessionId],
})
=> {"codex":["codex","01a11884-dc75-7862-9a3c-61d4e5cc3daf",true,"mtime"],"claudeOnly":["claude","bbbbbbbb-0000-4000-8000-000000000002"]}
```

A harness's exported session id outranks the mtime guess, even when it names
an older transcript. When both variables are set (one harness running inside
the other), the session whose transcript was written last wins. Flags outrank
both.

```ts
const envClaude = await frontmatter((await run(["add", "--checkpoint", "plan-reviewed"], {
  input: body, env: { CLAUDE_CODE_SESSION_ID: "aaaaaaaa-0000-4000-8000-000000000001" },
})).stdout.trim());
const envBoth = await frontmatter((await run(["add", "--checkpoint", "plan-reviewed"], {
  input: body, env: { CLAUDE_CODE_SESSION_ID: "aaaaaaaa-0000-4000-8000-000000000001", CODEX_THREAD_ID: codexId },
})).stdout.trim());
const flagged = await frontmatter((await run(["add", "--checkpoint", "plan-reviewed", "--transcript", claudeOld], {
  input: body, env: { CODEX_THREAD_ID: codexId },
})).stdout.trim());
const unknown = await run(["add", "--checkpoint", "plan-reviewed", "--session", "nope"], { input: body });
JSON.stringify({
  envClaude: [envClaude.meta.engine, envClaude.meta.sessionId, envClaude.meta.transcriptPath === claudeOld, envClaude.meta.resolvedBy],
  envBoth: [envBoth.meta.engine, envBoth.meta.resolvedBy],
  flagged: [flagged.meta.engine, flagged.meta.sessionId, flagged.meta.resolvedBy],
  unknownSession: unknown.code === 2 && unknown.stderr.includes("pass --engine"),
})
=> {"envClaude":["claude","aaaaaaaa-0000-4000-8000-000000000001",true,"env"],"envBoth":["codex","env"],"flagged":["claude","aaaaaaaa-0000-4000-8000-000000000001","flag"],"unknownSession":true}
```

An empty or whitespace-only body is refused with the four prompts and writes
nothing; so is an unknown checkpoint. The main checkout's workstream is
`main`, and `--workstream` overrides the derived name. A store root that exists
without the exhibits marker is refused rather than adopted.

```ts
const before = (await readdir(join(store, "demo/coding-feedback"))).length;
const empty = await run(["add", "--checkpoint", "implemented"], { input: "  \n\n" });
const badCheckpoint = await run(["add", "--checkpoint", "done"], { input: body });
const after = (await readdir(join(store, "demo/coding-feedback"))).length;
const fromMain = (await run(["add", "--checkpoint", "implemented"], { cwd: mono, input: body })).stdout.trim();
const overridden = (await run(["add", "--checkpoint", "implemented", "--workstream", "other"], { input: body })).stdout.trim();
const unmarked = join(root, "unmarked");
await mkdir(unmarked);
const refused = await run(["add", "--checkpoint", "implemented"], { input: body, env: { BBX_EXHIBITS_ROOT: unmarked } });
JSON.stringify({
  empty: empty.code === 2 && empty.stderr.includes("empty body") && empty.stderr.includes("4. What change to the codebase itself"),
  badCheckpoint: badCheckpoint.code === 2 && badCheckpoint.stderr.includes("--checkpoint must be one of"),
  nothingWritten: before === after,
  fromMain: fromMain.startsWith(join(store, "main/coding-feedback/")),
  overridden: overridden.startsWith(join(store, "other/coding-feedback/")),
  unmarkedRefused: refused.code === 2 && refused.stderr.includes("without .workstream-exhibits"),
  unmarkedUntouched: (await readdir(unmarked)).length === 0,
})
=> {"empty":true,"badCheckpoint":true,"nothingWritten":true,"fromMain":true,"overridden":true,"unmarkedRefused":true,"unmarkedUntouched":true}
```

`list` reports the current workstream's entries newest first; `--all` walks
every workstream directory in the store. Entries never overwrite each other:
a same-second entry gets a `-<n>` suffix. `show` prints an entry and refuses a path outside
the store.

```ts
const listed = JSON.parse((await run(["list", "--json"])).stdout);
const all = JSON.parse((await run(["list", "--all", "--json"])).stdout);
const text = (await run(["list"])).stdout.trimEnd().split("\n");
const shown = await run(["show", listed[0].path]);
const outside = await run(["show", join(mono, "README.md")]);
const stamps = listed.map((e: { timestamp: string }) => e.timestamp);
JSON.stringify({
  count: listed.length,
  newestFirst: stamps.every((t: string, i: number) => i === 0 || stamps[i - 1] >= t),
  checkpoints: listed.map((e: { checkpoint: string }) => e.checkpoint),
  allWorkstreams: [...new Set(all.map((e: { workstream: string }) => e.workstream))].toSorted(),
  uniquePaths: new Set(all.map((e: { path: string }) => e.path)).size === all.length,
  textLines: text.length,
  showPrints: shown.code === 0 && shown.stdout.startsWith("---\ntimestamp: "),
  outsideRefused: outside.code === 2 && outside.stderr.includes("not a CODING_FEEDBACK entry"),
})
=> {"count":6,"newestFirst":true,"checkpoints":["plan-reviewed","plan-reviewed","plan-reviewed","landed","landed","implemented"],"allWorkstreams":["demo","main","other"],"uniquePaths":true,"textLines":6,"showPrints":true,"outsideRefused":true}
```

`list --since <iso>` keeps only entries strictly after that instant, so a
scheduled reader can store the newest timestamp it consumed and ask for what
came after. An entry exactly at the instant is excluded. A value that is not an
ISO-8601 UTC instant is refused.

```ts
const everything = JSON.parse((await run(["list", "--all", "--json"])).stdout);
const pivot = everything[2].timestamp;
const after = JSON.parse((await run(["list", "--all", "--since", pivot, "--json"])).stdout);
const badSince = await run(["list", "--all", "--since", "last week"]);
JSON.stringify({
  onlyNewer: after.every((e: { timestamp: string }) => e.timestamp > pivot),
  newerCount: after.length === everything.filter((e: { timestamp: string }) => e.timestamp > pivot).length,
  pivotExcluded: !after.some((e: { timestamp: string }) => e.timestamp === pivot),
  badSince: badSince.code === 2 && badSince.stderr.includes("--since must be an ISO-8601 UTC instant"),
})
=> {"onlyNewer":true,"newerCount":true,"pivotExcluded":true,"badSince":true}
```
