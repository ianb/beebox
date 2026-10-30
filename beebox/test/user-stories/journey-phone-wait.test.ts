// # The walker's phone: a wait across several days
//
// A slow, real-box test of a whole wait, kept apart from journey-phone.test.ts
// so each file stays inside the per-file timeout under load.
// See docs/implemented-plans/walk-simulated-time.md (Track 7).

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { makeTmpBox } from "../helpers/test-helpers.ts";

// Cron occurrences are in the process's zone, as the scheduler's are; the test pins it.
process.env.TZ = "UTC";
// ## A wait lives through the interval in time order, and resumes after a stop
//
// A real box and real ticks across a two-day wait: a daily reminder fires each
// day; a daily `runs:` card runs each day, and its first run creates a reminder
// that fires later in the same wait; a card that turns itself off runs once; one
// that finds nothing to do is reported each time; a one-shot `runs:` card that
// fails is reported and the wait goes on. Afterwards the box clock is two days ahead.
// A wait cut off while a run was in progress is resumed without re-running it.
void test("A wait lives through the interval in time order, and resumes after a stop", async (t) => {
  const box = await makeTmpBox({ git: true });
  const runDir = mkdtempSync(join(tmpdir(), "bbx-phone-run-"));
  t.teardown(async () => {
    await box.cleanup();
    rmSync(runDir, { recursive: true, force: true });
  });
  const schedules = join(box.root, "_config", "schedules");
  // The box's own default schedules run agents, which a test has no login for.
  rmSync(schedules, { recursive: true, force: true });
  mkdirSync(schedules, { recursive: true });
  writeFileSync(join(box.root, "_config", "box.json"), JSON.stringify({ fakeNotifications: true }));
  const day = 24 * 60 * 60 * 1000;
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/u, "Z");
  const later = iso(Date.now() + 1.5 * day);
  writeFileSync(join(schedules, "remind-water.scheduled-script.card"),
    "---\ncron: \"0 9 * * *\"\nnotify:\n  title: Water the plants\n  target: chat:new\n---\n");
  writeFileSync(join(schedules, "daily-note.scheduled-script.card"),
    `---\ncron: "0 10 * * *"\nruns: >\n  echo "ran $BBX_TIME" >> .beebox/ran.log &&\n  { [ -e _config/schedules/remind-made.scheduled-script.card ] || printf -- '---\\nat: ${later}\\nonce: true\\nnotify:\\n  title: Made by a run\\n  target: chat:new\\n---\\n' > _config/schedules/remind-made.scheduled-script.card; }\n---\n`);
  // Turns itself off on its first run: the rest of the wait is planned again, so it runs once.
  writeFileSync(join(schedules, "self-off.scheduled-script.card"),
    "---\ncron: \"0 11 * * *\"\nruns: >\n  echo \"self-off $BBX_TIME\" >> .beebox/ran.log &&\n  sed -i.bak 's/^cron:/enabled: false\\ncron:/' _config/schedules/self-off.scheduled-script.card && rm -f _config/schedules/self-off.scheduled-script.card.bak\n---\n");
  // Finds nothing to do each time: reported as held back, and the wait goes on.
  writeFileSync(join(schedules, "nothing-new.scheduled-script.card"),
    "---\ncron: \"0 12 * * *\"\nruns: echo '{\"reason\":\"no-change\"}' > \"$BBX_DEFER_FILE\"; exit 75\n---\n");
  writeFileSync(join(schedules, "broken-once.scheduled-script.card"),
    `---\nat: ${iso(Date.now() + 0.5 * day)}\nonce: true\nruns: exit 3\n---\n`);
  execFileSync("git", ["-C", box.root, "add", "-A"]);
  execFileSync("git", ["-C", box.root, "commit", "-qm", "schedules"]);
  writeFileSync(join(runDir, "before.json"), JSON.stringify({ box: box.root, url: "http://localhost:3210/wt/g-paperwork-3/" }));
  const phone = (...args: string[]) => execFileSync(process.execPath, ["--import", "tsx", resolve(import.meta.dirname, "journeys/phone.ts"), runDir, ...args], {
    encoding: "utf8", env: { ...process.env, TZ: "UTC" }, timeout: 600_000,
  });

  const waited = phone("--wait", "2d");
  // Their order depends on the hour the test runs; which ones came does not.
  const titles = [...waited.matchAll(/^(?:Water the plants|Made by a run)$/gmu)].map((m) => m[0]).toSorted();
  const offset: unknown = JSON.parse(readFileSync(join(box.root, ".beebox", "clock-offset.json"), "utf8"));
  const offsetDays = typeof offset === "object" && offset !== null && "offsetMs" in offset && typeof offset.offsetMs === "number" ? Math.round(offset.offsetMs / day) : -1;
  t.check({
    titles,
    failedLine: /^- broken-once@\S+: .+$/mu.exec(waited)?.[0].replace(/@\S+: .+$/u, "@<at>: <error>"),
    deferred: [...waited.matchAll(/^- (nothing-new)@\S+: (.+)$/gmu)].map((m) => `${m[1] ?? ""}: ${m[2] ?? ""}`),
    runs: readFileSync(join(box.root, ".beebox", "ran.log"), "utf8").trim().split("\n").map((l) => l.replace(/\d{4}-\d\d-\d\dT/u, "<day>T")),
    offsetDays,
    stateKeys: Object.keys(z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(join(runDir, "phone.json"), "utf8")))),
  }, {
    titles: ["Made by a run", "Water the plants", "Water the plants"],
    failedLine: "- broken-once@<at>: <error>",
    deferred: ["nothing-new: no-change", "nothing-new: no-change"],
    runs: ["ran <day>T10:00:01.000Z", "self-off <day>T11:00:01.000Z", "ran <day>T10:00:01.000Z"],
    offsetDays: 2,
    stateKeys: ["shown"],
  });

  // A wait cut off mid-run: its record says the run started and did not finish.
  const stamp = new Date(Date.now() + offsetDays * day);
  const from = stamp.toISOString();
  // A short interval with nothing due, so the resume runs only the closing wakeup.
  const to = new Date(stamp.getTime() + 60 * 60 * 1000).toISOString();
  const cut = `daily-note@${new Date(stamp.getTime() + 30 * 60 * 1000).toISOString()}`;
  const state: unknown = JSON.parse(readFileSync(join(runDir, "phone.json"), "utf8"));
  writeFileSync(join(runDir, "phone.json"), JSON.stringify({ ...(typeof state === "object" ? state : {}), wait: { from, to, started: [cut], done: [] } }));
  const resumed = phone();
  t.check({
    refusedNewWait: (() => {
      writeFileSync(join(runDir, "phone.json"), JSON.stringify({ shown: [], wait: { from, to, started: [], done: [] } }));
      try {
        phone("--wait", "1d");
        return "ran";
      } catch (e) {
        return e instanceof Error && "stderr" in e ? String(e.stderr).trim() : String(e);
      }
    })(),
    resumedLines: resumed.split("\n").slice(0, 4),
  }, {
    refusedNewWait: "phone: an earlier wait has not finished; run phone.ts without --wait to resume it first",
    resumedLines: [`Resuming the wait to ${to}.`, "", "Cut off by an earlier stop, and not run again:", `- ${cut}`],
  });
});
