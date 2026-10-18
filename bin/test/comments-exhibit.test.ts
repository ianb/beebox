// # `bin/comments` on an exhibit page
//
// An exhibit page is not a file in any checkout, so `bin/comments` names it with
// an address, `exhibit:<workstream>/<name>`, wherever it would take a path. The
// exhibits listener writes through this same CLI
// (`beebox/docs/implemented-plans/exhibit-comments.md`), and the agent reads with the
// `list --workstream` call it already makes at pickup.

import { test } from "tap";
import "agent-doctest/tap";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(process.cwd(), "..");
const cli = join(repoRoot, "bin/comments");
const store = await mkdtemp(join(tmpdir(), "comments-exhibit-doctest-"));

interface ExecFailure { code?: number; stdout?: string; stderr?: string }
function isExecFailure(value: unknown): value is ExecFailure {
  return typeof value === "object" && value !== null;
}

async function comments(args: string[]) {
  try {
    const r = await execFileAsync(cli, args, {
      cwd: repoRoot,
      env: { ...process.env, BBX_COMMENTS_ROOT: store },
    });
    return { code: 0, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
  } catch (e) {
    const err = isExecFailure(e) ? e : {};
    return { code: err.code ?? 1, stdout: (err.stdout ?? "").trim(), stderr: (err.stderr ?? "").trim() };
  }
}

// ## A comment on an exhibit is for that exhibit's workstream
//
// No `--workstream` is needed: the address carries it. `--json` echoes the subject
// the store filed it under.
void test("No --workstream is needed:", async (t) => {
  // doctest:L46
  const added = await comments(["add", "exhibit:demo-ws/after", "--body", "The caption is wrong.", "--origin", "voice", "--quoted", "A1 shows", "--section", "Figures", "--json"]);
  const parsed = JSON.parse(added.stdout);
  t.check({ code: added.code, subject: parsed.subject, idShape: /^c-/.test(parsed.id) }, {
    code: 0,
    subject: {
      scope: "exhibit",
      workstream: "demo-ws",
      exhibit: "after",
    },
    idShape: true,
  });

  // doctest:L53
  const listed = await comments(["list", "--workstream", "demo-ws", "--json"]);
  const entry = JSON.parse(listed.stdout).entries[0];
  t.check({ subject: entry.subject, workstream: entry.comments[0].workstream, origin: entry.comments[0].origin, section: entry.comments[0].section }, {
    subject: {
      scope: "exhibit",
      workstream: "demo-ws",
      exhibit: "after",
    },
    workstream: "demo-ws",
    origin: "voice",
    section: "Figures",
  });

  // The human listing prints the address, so it can be pasted straight back into
  // `show` or `clear`.

  // doctest:L63
  const shown = await comments(["show", "exhibit:demo-ws/after"]);
  t.check(shown.stdout.split("\n")[0], "exhibit:demo-ws/after  (1)");

  // ## `--workstream` still wins when given
  //
  // A comment on one workstream's exhibit can be addressed to another: the address
  // is a default, not a rule.

  // doctest:L74
  const other = await comments(["add", "exhibit:demo-ws/after", "--body", "For the router owner.", "--workstream", "router", "--json"]);
  const forRouter = await comments(["list", "--workstream", "router", "--json"]);
  t.check({ code: other.code, bodies: JSON.parse(forRouter.stdout).entries.flatMap((e: { comments: Array<{ body: string }> }) => e.comments.map((c) => c.body)) }, {
    code: 0,
    bodies: [
      "For the router owner.",
    ],
  });

  // An explicit empty `--workstream` still means unrouted, as it does for a file:
  // the exhibit's workstream is the default for an absent flag, not a rule.

  // doctest:L84
  const unrouted = await comments(["add", "exhibit:demo-ws/after", "--body", "For nobody yet.", "--workstream", "", "--json"]);
  const everything = await comments(["list", "--json"]);
  const routes = JSON.parse(everything.stdout).entries.flatMap((e: { comments: Array<{ body: string; workstream: string | null }> }) => e.comments.map((c) => [c.body, c.workstream]));
  t.check({ code: unrouted.code, routes: routes.toSorted() }, {
    code: 0,
    routes: [
      [
        "For nobody yet.",
        null,
      ],
      [
        "For the router owner.",
        "router",
      ],
      [
        "The caption is wrong.",
        "demo-ws",
      ],
    ],
  });

  // ## Clearing by address

  // doctest:L94
  const cleared = await comments(["clear", "exhibit:demo-ws/after"]);
  const after = await comments(["list", "--workstream", "demo-ws"]);
  t.check({ cleared: cleared.stdout, after: after.stdout }, {
    cleared: "Cleared 3 on exhibit:demo-ws/after.",
    after: "Nothing waiting for demo-ws.",
  });

  // ## A bad address is refused in one sentence
  //
  // The store validates the segments; the CLI passes its sentence through with
  // exit 1, the same posture as a path that escapes the store.

  // doctest:L106
  const bad = await comments(["add", "exhibit:demo-ws/.hidden", "--body", "x"]);
  t.check({ code: bad.code, stderr: bad.stderr }, {
    code: 1,
    stderr: "comments: invalid comment path: not an exhibit name: .hidden",
  });

  // A string that claims the prefix but does not split into two segments is
  // refused too, rather than being read as a file named `exhibit:…`.

  // doctest:L115
  const three = await comments(["show", "exhibit:a/b/c"]);
  t.check({ code: three.code, stderr: three.stderr }, {
    code: 1,
    stderr: "comments: 'exhibit:a/b/c' is not an exhibit address; the form is exhibit:<workstream>/<name>",
  });
});
