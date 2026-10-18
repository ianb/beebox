// # Reactor Integration Tests
//
// Integration tests for the reactor with fake agents. Tests batch
// processing, lock management, and cycle behavior.

import { test } from "tap";
import "agent-doctest/tap";
import { any, not } from "agent-doctest/check";
import {
  runReactor,
} from "../../../src/core/reactor/engine/core.js";
import { finishJob } from "../../../src/core/finish-job.js";
import { createFakeAgent } from "../fake-agent.js";
import type { FakeAgent } from "../fake-agent.js";
import type { createAgent } from "../../../src/core/agent/invoke/core.js";
import { invariant } from "../../../src/shared/invariant.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";
import { createIntakeJobTemplate } from "../../../src/schemas/intake-job.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// Job cards are YAML frontmatter; build them with the real producer templates
// so these integration tests exercise the same shapes connectors write.
type CreateAgentOptions = Parameters<typeof createAgent>[0];

const intakeJob = (description: string, opts?: { priority?: "normal" | "low" }) =>
  createIntakeJobTemplate({
    description,
    items: [],
    ...(opts ?? {}),
  });

// Override the reactor's slow real subsystems with no-ops. None of these
// tests assert on their effects, but each does real, expensive work per run:
//   - runSync / runFinalize spawn `bbx wakeup` / `bbx finalize` (a ~1s Node+tsx
//     cold start each, no-opping on an empty test box)
//   - generateDocs regenerates agent docs (~1s cold on a fresh box)
// Faking them keeps these tests in-process, fast, and deterministic.
const testOverrides = {
  runSync: async () => true,
  runFinalize: async () => true,
  generateDocs: async () => {},
};

// ## Batch processing with fake agent
//
// ### Single batch job processed by agent
void test("Single batch job processed by agent", async (t) => {
  // doctest:L50
  const box = await makeTmpBox({ git: true });
  await box.write("_bookkeeping/jobs/task.intake.job.card", intakeJob("Write a haiku"));
  box.commitAll("Add job");

  // doctest:L54
  const created: FakeAgent[] = [];
  const agentFactory = (opts: CreateAgentOptions) => {
    const agent = createFakeAgent({
      name: opts.name,
      act: async ({ boxRoot }) => {
        await finishJob({ boxRoot, jobRelPath: "_bookkeeping/jobs/task.intake.job.card" });
        return { success: true };
      },
    });
    created.push(agent);
    return agent;
  };

  // doctest:L67
  const result = await runReactor({
    boxRoot: box.root,
    ...testOverrides,
    createAgent: agentFactory,
  });

  // doctest:L73
  t.check(result, { success: true, jobsProcessed: 1, jobsRemaining: 0 });

  // doctest:L82
  // System prompt no longer carries the absolute box path (dropped so it
  // doesn't leak this machine's temp/home directory into agent context).
  const fakeAgent = created[0];
  invariant(fakeAgent, "the reactor created its agent");
  // The prompts are large generated text, so the check is on what the prompt must not hold.
  t.check(fakeAgent.invocations.map((i) => i.systemPrompt), [not(any(String).includes(box.root))]);

  // doctest:L89
  await box.cleanup();
});

// ### Multiple batch jobs in one session
void test("Multiple batch jobs in one session", async (t) => {
  // doctest:L95
  const box = await makeTmpBox({ git: true });
  await box.write("_bookkeeping/jobs/task1.intake.job.card", intakeJob("Task one"));
  await box.write("_bookkeeping/jobs/task2.intake.job.card", intakeJob("Task two"));
  box.commitAll("Add jobs");

  // doctest:L100
  const created: FakeAgent[] = [];
  const agentFactory = (opts: CreateAgentOptions) => {
    const agent = createFakeAgent({
      name: opts.name,
      act: async ({ boxRoot }) => {
        // Finish both jobs
        await finishJob({ boxRoot, jobRelPath: "_bookkeeping/jobs/task1.intake.job.card" });
        await finishJob({ boxRoot, jobRelPath: "_bookkeeping/jobs/task2.intake.job.card" });
        return { success: true };
      },
    });
    created.push(agent);
    return agent;
  };

  // doctest:L115
  const result = await runReactor({
    boxRoot: box.root,
    ...testOverrides,
    createAgent: agentFactory,
  });

  // doctest:L121
  t.check(result, { success: true, jobsProcessed: 2, jobsRemaining: 0 });

  // doctest:L124
  // Single agent session (one invocation with both jobs)
  const fakeAgent = created[0];
  invariant(fakeAgent, "the reactor created its agent");
  // The prompt is large generated text: it holds both jobs.
  t.check(fakeAgent.invocations.map((i) => i.prompt), [any(String).includes("Task one").includes("Task two")]);

  // doctest:L136
  await box.cleanup();
});

// ### Dry run does not invoke agent
void test("Dry run does not invoke agent", async (t) => {
  // doctest:L142
  const box = await makeTmpBox({ git: true });
  await box.write("_bookkeeping/jobs/task.intake.job.card", intakeJob("Should not run"));
  box.commitAll("Add job");

  // doctest:L146
  let agentCreated = false;
  const agentFactory = (opts: CreateAgentOptions) => {
    agentCreated = true;
    return createFakeAgent({ name: opts.name, act: async () => ({ success: true }) });
  };

  // doctest:L152
  const result = await runReactor({
    boxRoot: box.root,
    ...testOverrides,
    createAgent: agentFactory,
    dryRun: true,
  });

  // doctest:L159
  t.check(agentCreated, false);

  // doctest:L162
  t.check(result, { success: true, jobsProcessed: 0, jobsRemaining: 1 });

  // doctest:L165
  await box.cleanup();
});

// ### skipLowPriority skips when only low-priority jobs exist
void test("skipLowPriority skips when only low-priority jobs exist", async (t) => {
  // doctest:L171
  const box = await makeTmpBox({ git: true });
  await box.write("_bookkeeping/jobs/digest.intake.job.card", intakeJob("Daily digest", { priority: "low" }));
  box.commitAll("Add low-pri job");

  // doctest:L175
  let agentCreated = false;
  const agentFactory = (opts: CreateAgentOptions) => {
    agentCreated = true;
    return createFakeAgent({ name: opts.name, act: async () => ({ success: true }) });
  };

  // doctest:L181
  const result = await runReactor({
    boxRoot: box.root,
    ...testOverrides,
    createAgent: agentFactory,
    skipLowPriority: true,
  });

  // doctest:L188
  t.check(agentCreated, false);

  // doctest:L191
  t.check(result, { success: true, jobsProcessed: 0, jobsRemaining: 1 });

  // doctest:L194
  await box.cleanup();
});

// ## Lock management
//
// ### Lock prevents concurrent runs
void test("Lock prevents concurrent runs", async (t) => {
  t.teardown(async () => {
    try {
      await fs.rm(lockFile + ".guard", { recursive: true, force: true });
      await fs.unlink(lockFile).catch(() => {});
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L202
  const box = await makeTmpBox({ git: true });
  const lockFile = path.join(box.root, ".bbx-reactor.lock");
  // Simulate a live holder in another process: a fresh guard directory (what
  // proper-lockfile mkdir-locks) plus its diagnostic sidecar.
  await fs.mkdir(lockFile + ".guard");
  await fs.writeFile(lockFile, JSON.stringify({
    pid: process.pid,
    hostname: os.hostname(),
    acquiredAt: new Date().toISOString(),
    metadata: { kind: "reactor" },
  }));

  // doctest:L214
  const result = await runReactor({
    boxRoot: box.root,
    ...testOverrides,
    createAgent: (opts) => createFakeAgent({ name: opts.name, act: async () => ({ success: true }) }),
  });

  // doctest:L220
  // Reactor bailed due to lock
  t.check(result, { success: true, jobsProcessed: 0, jobsRemaining: 0, skipped: "locked" });
});

// ### Stale lock is cleaned up
void test("Stale lock is cleaned up", async (t) => {
  // doctest:L234
  const box = await makeTmpBox({ git: true });
  const lockFile = path.join(box.root, ".bbx-reactor.lock");
  // Simulate a crashed holder: a guard directory whose mtime is well past the
  // stale window (5 min). proper-lockfile reclaims it on the next acquire.
  await fs.mkdir(lockFile + ".guard");
  const past = new Date(Date.now() - 10 * 60 * 1000);
  await fs.utimes(lockFile + ".guard", past, past);
  await fs.writeFile(lockFile, JSON.stringify({
    pid: 99999999,
    hostname: os.hostname(),
    acquiredAt: past.toISOString(),
    metadata: { kind: "reactor" },
  }));

  // doctest:L248
  await box.write("_bookkeeping/jobs/task.intake.job.card", intakeJob("After stale lock"));
  box.commitAll("Add job");

  // doctest:L251
  let fakeAgent;
  const agentFactory = (opts: CreateAgentOptions) => {
    fakeAgent = createFakeAgent({
      name: opts.name,
      act: async ({ boxRoot }) => {
        await finishJob({ boxRoot, jobRelPath: "_bookkeeping/jobs/task.intake.job.card" });
        return { success: true };
      },
    });
    return fakeAgent;
  };

  // doctest:L263
  const result = await runReactor({
    boxRoot: box.root,
    ...testOverrides,
    createAgent: agentFactory,
  });

  // doctest:L269
  // Stale lock was cleaned up and reactor ran
  t.check(result, { success: true, jobsProcessed: 1, jobsRemaining: 0 });

  // doctest:L273
  await box.cleanup();
});

// ## Cycle loop
//
// ### Multiple cycles process remaining jobs
//
// The reactor loops when jobs remain after a cycle. Here we start with
// 2 jobs but the agent only finishes 1 per invocation, requiring 2 cycles.
void test("The reactor loops when jobs remain after a cycle.", async (t) => {
  // doctest:L284
  const box = await makeTmpBox({ git: true });
  await box.write("_bookkeeping/jobs/task1.intake.job.card", intakeJob("First task"));
  await box.write("_bookkeeping/jobs/task2.intake.job.card", intakeJob("Second task"));
  box.commitAll("Add jobs");

  // doctest:L289
  let cycle = 0;
  const agentFactory = (opts: CreateAgentOptions) => {
    const currentCycle = cycle++;
    return createFakeAgent({
      name: opts.name,
      act: async ({ boxRoot }) => {
        // Each cycle finishes only one job
        const jobFile = currentCycle === 0 ? "task1.intake.job.card" : "task2.intake.job.card";
        await finishJob({ boxRoot, jobRelPath: `_bookkeeping/jobs/${jobFile}` });
        return { success: true };
      },
    });
  };

  // doctest:L303
  const result = await runReactor({
    boxRoot: box.root,
    ...testOverrides,
    createAgent: agentFactory,
    maxCycles: 3,
  });

  // doctest:L310
  t.check(result, { success: true, jobsProcessed: 2, jobsRemaining: 0 });

  // doctest:L316
  t.check(
    // Two cycles were needed
    cycle,
    2,
  );

  // doctest:L320
  await box.cleanup();
});
