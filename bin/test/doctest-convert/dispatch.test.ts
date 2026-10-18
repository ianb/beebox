// The driver rejects a batch whose worker ran a forbidden command, read from
// either CLI's JSON transcript.

import { test } from "tap";
import "agent-doctest/tap";
import { commandsIn, forbidden, parseStatus } from "../../doctest-convert/dispatch.ts";

void test("commands from Claude and Codex transcripts", async (t) => {
  const transcript = [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm install" } }] } }),
    "a plain-text line",
    JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "/bin/zsh -lc 'node --import tsx bin/doctest-convert.ts check x'" } }),
    JSON.stringify({ msg: { type: "exec_command_begin", command: ["bash", "-lc", "git status"] } }),
  ].join("\n");
  t.check(commandsIn(transcript), ["pnpm install", "/bin/zsh -lc 'node --import tsx bin/doctest-convert.ts check x'", "bash -lc git status"]);
});

void test("git may only read; file names that contain git are not git", async (t) => {
  const verdicts = Object.fromEntries(
    [
      "node --import tsx bin/doctest-convert.ts check beebox/test/lib/git-stale-lock.test.ts",
      "git diff beebox/test/lib/env.test.ts",
      "git -C . status",
      "git diff && git commit -am x",
      "git -C . reset --hard",
      "cd beebox; git mv a b",
      "pnpm install",
      "rm beebox/test/lib/env.test.ts",
      "python3 - <<'EOF'\ns = s.replace('git status', 'git diff')  # rm\nEOF",
      "python3 - <<'EOF'\nprint(1)\nEOF\ngit commit -am x",
      "grep -n \"rm\\\\b\\\\|Fixtures\" a.test.ts | head -20",
      "perl -i -ne 'print unless /^import \\{ mkdtemp, rm \\} from/' a.test.ts",
      "node x.mts; rm -f ./x.mts",
      "find . -name '*.tmp' -exec rm {} +",
      "ls | xargs -0 rm",
      "/bin/zsh -lc 'rm a.ts'",
      "cd beebox && pkill -f tap",
      "node --import tsx bin/doctest-convert.ts check beebox/test/lib/term.test.ts",
    ].map((c) => [c, forbidden(c)]),
  );
  t.check(verdicts, {
    "node --import tsx bin/doctest-convert.ts check beebox/test/lib/git-stale-lock.test.ts": false,
    "git diff beebox/test/lib/env.test.ts": false,
    "git -C . status": false,
    "git diff && git commit -am x": true,
    "git -C . reset --hard": true,
    "cd beebox; git mv a b": true,
    "pnpm install": true,
    "rm beebox/test/lib/env.test.ts": true,
    "python3 - <<'EOF'\ns = s.replace('git status', 'git diff')  # rm\nEOF": false,
    "python3 - <<'EOF'\nprint(1)\nEOF\ngit commit -am x": true,
    "grep -n \"rm\\\\b\\\\|Fixtures\" a.test.ts | head -20": false,
    "perl -i -ne 'print unless /^import \\{ mkdtemp, rm \\} from/' a.test.ts": false,
    "node x.mts; rm -f ./x.mts": true,
    "find . -name '*.tmp' -exec rm {} +": true,
    "ls | xargs -0 rm": true,
    "/bin/zsh -lc 'rm a.ts'": true,
    "cd beebox && pkill -f tap": true,
    "node --import tsx bin/doctest-convert.ts check beebox/test/lib/term.test.ts": false,
  });
});

void test("status paths: NUL-separated, with both ends of a rename", async (t) => {
  t.check(parseStatus(" M a b.ts\0R  new.ts\0old.ts\0?? dir/x.ts\0"), ["a b.ts", "new.ts", "old.ts", "dir/x.ts"]);
});
