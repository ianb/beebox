// # The model a Codex thread ran, from its rollout
//
// The SDK event stream does not name the model. Codex's rollout JSONL does: a
// `turn_context` record opens each turn. The usage ledger records the model of
// the thread's latest turn, read backward from the end of the file
// (issues/code-quality/2026-09-05-codex-usage-records-sentinel-not-model.md).

import { test, type Test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  codexHomeDir,
  findCodexRollout,
  readCodexRolloutModel,
} from "../../src/services/codex-rollout-model.js";

/** A UUIDv7 thread id for a fixed creation time. */
function threadIdAt(ms: number): string {
  const hex = ms.toString(16).padStart(12, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7abc-8def-0123456789ab`;
}

function localDay(ms: number): string[] {
  const at = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return [String(at.getFullYear()), pad(at.getMonth() + 1), pad(at.getDate())];
}

const CREATED = Date.UTC(2026, 9, 19, 12, 41, 17);
const THREAD = threadIdAt(CREATED);

function turnContext(model: string): string {
  return JSON.stringify({ timestamp: "t", type: "turn_context", payload: { turn_id: "x", cwd: "/box", model } });
}

async function codexHome(t: Test): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "codex-rollout-"));
  t.teardown(() => rm(home, { recursive: true, force: true }));
  return home;
}

async function writeRollout(home: string, rollout: { dayMs: number; lines: string[] }): Promise<string> {
  const dir = join(home, "sessions", ...localDay(rollout.dayMs));
  await mkdir(dir, { recursive: true });
  const file = join(dir, `rollout-2026-10-19T07-41-17-${THREAD}.jsonl`);
  await writeFile(file, `${rollout.lines.join("\n")}\n`);
  return file;
}

// ## The latest turn's model wins
//
// A thread whose model changed between turns records the later one. Records
// after the last `turn_context` (the turn's items) do not hide it, even when
// they span more than one read chunk.
void test("The latest turn's model wins", async (t) => {
  const home = await codexHome(t);
  const filler = JSON.stringify({ type: "response_item", payload: { text: "y".repeat(1000) } });
  await writeRollout(home, {
    dayMs: CREATED,
    lines: [
      JSON.stringify({ type: "session_meta", payload: { id: THREAD } }),
      turnContext("gpt-6-sol"),
      filler,
      turnContext("gpt-6-astra"),
      ...Array.from({ length: 700 }, () => filler),
    ],
  });
  t.check(await readCodexRolloutModel({ codexHome: home, threadId: THREAD }), "gpt-6-astra");
});

// ## A turn_context line longer than a read chunk is read whole
//
// Instructions ride in the turn_context record, so its line can outgrow one
// 256 KiB read.
void test("A turn_context line longer than a read chunk is read whole", async (t) => {
  const home = await codexHome(t);
  const long = JSON.stringify({ timestamp: "t", type: "turn_context", payload: { instructions: "z".repeat(600_000), model: "gpt-6-astra" } });
  await writeRollout(home, { dayMs: CREATED, lines: [turnContext("gpt-6-sol"), long, JSON.stringify({ type: "response_item" })] });
  t.check(await readCodexRolloutModel({ codexHome: home, threadId: THREAD }), "gpt-6-astra");
});

// ## The file is found near its creation day
//
// The directory is the thread's local creation date. A Codex process in
// another timezone may file it a day either side.
void test("The file is found near its creation day", async (t) => {
  const home = await codexHome(t);
  const file = await writeRollout(home, { dayMs: CREATED + 86_400_000, lines: [turnContext("gpt-6-sol")] });
  t.check(await findCodexRollout(home, THREAD), file);
  t.check(await readCodexRolloutModel({ codexHome: home, threadId: THREAD }), "gpt-6-sol");
});

// ## A missing rollout is null; an unreadable one throws
//
// The caller falls back for both; only the second is a surprise worth a
// specific message. A thread id that is not a UUIDv7 cannot be dated.
void test("A missing rollout is null; an unreadable one throws", async (t) => {
  const home = await codexHome(t);
  t.check(await readCodexRolloutModel({ codexHome: home, threadId: THREAD }), null);
  t.check(await findCodexRollout(home, "not-a-uuid"), null);

  const file = await writeRollout(home, { dayMs: CREATED, lines: [JSON.stringify({ type: "session_meta", payload: {} })] });
  await t.checkThrows(
    () => readCodexRolloutModel({ codexHome: home, threadId: THREAD }),
    `CodexRolloutParseError: Codex rollout ${file} has no readable turn_context model`,
  );
});

// ## The Codex home follows the session's environment
void test("The Codex home follows the session's environment", async (t) => {
  t.check(codexHomeDir({ CODEX_HOME: "/session/codex" }), "/session/codex");
  // A supplied environment replaces ours in the child, so a missing key means
  // Codex's default home, not this process's CODEX_HOME.
  t.check(codexHomeDir({ PATH: "/bin" }), join(homedir(), ".codex"));
});
