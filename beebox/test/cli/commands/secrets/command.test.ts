// # `bbx secrets` — the CLI plumbing
//
// `src/cli/commands/secrets/command.ts` is plumbing for deploy scripts, the migration,
// emergencies, and agents. Two rules live in the CLI rather than in the store: a
// value never comes from argv, and mutations refuse in an agent session without
// `--agent-confirmed` (the `bbx auth` pattern). Each subcommand body is an exported
// function, called directly here rather than spawning the CLI.
//
// Values below are obvious placeholders.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, isoDate, str } from "@ianbicking/tap-check/check";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  runDeclareSecret,
  runGrantSecret,
  runListSecrets,
  runRevokeSecret,
  runSecretsStatus,
  runSetSecret,
} from "../../../../src/cli/commands/secrets/command.js";
import { runDescribeSecret } from "../../../../src/cli/commands/secrets/describe.js";
import { grantSecret, setSecret } from "../../../../src/core/secrets/lifecycle.js";

// The guard is deliberately loose — a non-TTY stdin alone reads as "agent".
// Pinning both signals keeps these cases deterministic wherever the suite runs.
process.stdin.isTTY = false;
process.env.CLAUDECODE = "1";

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-cli-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}

/** Run a `run*` action with console output captured and `process.exit` trapped. */
async function runCaptured(fn: () => unknown) {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  const origExit = process.exit;
  let exitCode: number | string | undefined;
  console.log = (...args) => { logs.push(args.join(" ")); };
  console.error = (...args) => { errors.push(args.join(" ")); };
  process.exit = (code) => {
    exitCode = code ?? 0;
    throw new Error("__doctest_process_exit__");
  };
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof Error) || e.message !== "__doctest_process_exit__") throw e;
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exit = origExit;
  }
  return { logs, errors, exitCode };
}

/** A captured run, with a temp box's directory name replaced by `<box>`. */
function seen(run: Awaited<ReturnType<typeof runCaptured>>, boxDir?: string) {
  const hide = (lines: string[]) => (boxDir === undefined ? lines : lines.map((l) => l.replaceAll(basename(boxDir), "<box>")));
  return { exitCode: run.exitCode, logs: hide(run.logs), errors: hide(run.errors) };
}

/** The refusal an agent session gets for a machine-level action; the store path varies. */
const machineRefusal = (head: string) => str`${head}

The secret store (${any(String)}) is MACHINE-LEVEL — one file behind every box
on this machine, not just the box you are standing in. Granting a secret hands another
box a live credential; setting one rotates the single copy every box shares.

If the person you are working for explicitly asked you to do this, re-run with
--agent-confirmed.

If you need a secret for work you are doing: \`bbx secrets declare <name> --note ...\`
names the slot, and the boxholder supplies and grants the value. Needing a credential
you were not given is a question for a human, not an obstacle to work around.`;

/** The uniform refusal of `describe` for a name outside the agent's own box. */
const describeRefusal = ({ name, why, tail }: { name: string; why: string; tail: string }) => str`Refusing to describe "${name}": this looks like an agent session (CLAUDECODE is set in the environment), and
${why}

An agent may say why ITS OWN box spends a key. The rest of the machine's secrets are the
boxholder's record, and this command deliberately answers the same way whether the name
belongs to another box or does not exist at all — a reply that told them apart would let
this command enumerate the machine's secrets one guess at a time.

${tail}
If the person you are working for explicitly asked for this edit, re-run with --agent-confirmed.`;

/** The refusal `status` gives an agent for a box other than its own. */
const statusRefusal = ({ head, why, tail }: { head: string; why: string; tail: string }) => str`${head}: this looks like an agent session (CLAUDECODE is set in the environment), and
${why}

An agent's view of the secret store is its own box's grants and declared slots. The
machine's other boxes are the boxholder's business, not something to enumerate from here.
${tail}`;

// ## A value in argument position is refused
//
// `ps` and shell history see every argument, so the argv form is rejected before
// anything else happens — including before the agent check, so the message an
// operator sees names the real problem.
void test("ps and shell history see every argument, so the argv form is rejected before...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L71
  const dir = await useTempStore();
  const refused = await runCaptured(() =>
    runSetSecret({ name: "mistral", argvValue: "placeholder-value-1", agentConfirmed: true }),
  );
  t.check(seen(refused), {
    exitCode: 1,
    logs: [],
    errors: [
      `Refusing to take a secret value from the command line: arguments are visible to
every process on the machine (\`ps\`) and land in shell history.

Pipe it instead:  printf %s "$VALUE" | bbx secrets set mistral
or run the command with no value argument to be prompted (input hidden).`,
    ],
  });
});

// ## Mutations refuse in an agent session; `declare` does not
//
// `grant` hands another box a live credential, so it needs a human's explicit
// say-so. `declare` — name a slot you need — is the agent's own surface: it can
// neither disclose nor empower anything, so it runs unguarded.
void test("grant hands another box a live credential, so it needs a human's explicit say...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L96
  const dir = await useTempStore();
  await setSecret({ name: "mistral", value: "placeholder-value-2" });
  // The box these `status` calls run in: its slug is its directory's basename,
  // so this is the "demo-box" they ask about.
  const demoBox = join(dir, "demo-box");
  await mkdir(demoBox);

  // doctest:L103
  const blocked = await runCaptured(() => runGrantSecret({ boxOrRoot: "demo-box", name: "mistral" }));
  t.check(seen(blocked), {
    exitCode: 1,
    logs: [],
    errors: [machineRefusal("Refusing to grant a secret to a box: this looks like an agent session (CLAUDECODE is set in the environment).")],
  });
  const after = await runCaptured(() => runSecretsStatus({ boxOrRoot: "demo-box", boxRoot: demoBox }));
  t.check(seen(after), { exitCode: undefined, logs: ["Box: demo-box", "  granted: none"], errors: [] });

  // doctest:L110
  const declared = await runCaptured(() => runDeclareSecret({ name: "weatherapi", note: "for a trick" }));
  t.check(seen(declared), {
    exitCode: undefined,
    logs: ["Declared \"weatherapi\" — an empty, ungranted slot. Ask the boxholder to supply the value and grant it."],
    errors: [],
  });

  // With `--agent-confirmed``);

  // With `--agent-confirmed` — the flag that asserts a human asked — the same grant
  // goes through, and `status` reports it:

  // doctest:L126
  const granted = await runCaptured(() =>
    runGrantSecret({ boxOrRoot: "demo-box", name: "mistral", access: "agent", agentConfirmed: true }),
  );
  t.check(seen(granted), { exitCode: undefined, logs: ["Granted \"mistral\" to \"demo-box\" with agent access."], errors: [] });
  const status = await runCaptured(() => runSecretsStatus({ boxOrRoot: "demo-box", boxRoot: demoBox }));
  t.check(seen(status), {
    exitCode: undefined,
    logs: [
      "Box: demo-box",
      "  granted: mistral (agent)",
      "    used for: audio transcription (Voxtral — recordings and live chat dictation); Mistral API calls from box views, through the server-side adapter",
    ],
    errors: [],
  });

  // The `used for``);

  // The `used for` line is the built-in registry's (`src/core/secrets/uses.ts`) — the
  // boxholder sees what the engine will actually spend a key on without having to
  // read the code that spends it.
  //
  // An unknown access level is refused rather than silently downgraded:

  // doctest:L146
  const bad = await runCaptured(() =>
    runGrantSecret({ boxOrRoot: "demo-box", name: "mistral", access: "root", agentConfirmed: true }),
  );
  t.check(seen(bad), { exitCode: 1, logs: [], errors: ["Unknown access level \"root\" — use \"server\" (default) or \"agent\"."] });

  // doctest:L157`);

  // doctest:L157
  const revoked = await runCaptured(() =>
    runRevokeSecret({ boxOrRoot: "demo-box", name: "mistral", agentConfirmed: true }),
  );
  t.check(seen(revoked), { exitCode: undefined, logs: ["Revoked \"mistral\" from \"demo-box\"."], errors: [] });
});

// ## `declare` attributes the slot to the declaring box
//
// Declaring grants nothing, so without attribution the slot would vanish from the
// box's own view the moment it was created — and an agent that declared something
// last week could not report what it was still waiting on. `declaredBy` is
// recorded from the box the command ran in (here passed explicitly; the CLI finds
// it from the working directory), and `status` shows it back.
void test("Declaring grants nothing, so without attribution the slot would vanish from t...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
      await rm(boxDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L177
  const dir = await useTempStore();
  const boxDir = await mkdtemp(join(tmpdir(), "weather-box-"));

  // doctest:L180
  const declared = await runCaptured(() =>
    runDeclareSecret({ name: "weatherapi", note: "for the forecast trick", boxRoot: boxDir }),
  );
  t.check(seen(declared, boxDir), {
    exitCode: undefined,
    logs: [
      "Declared \"weatherapi\" — an empty, ungranted slot. Ask the boxholder to supply the value and grant it.",
      "Attributed to box \"<box>\" — it shows up in `bbx secrets status <box>`.",
    ],
    errors: [],
  });

  // doctest:L185
  const status = await runCaptured(() => runSecretsStatus({ boxOrRoot: boxDir, boxRoot: boxDir }));
  t.check(seen(status, boxDir), {
    exitCode: undefined,
    logs: ["Box: <box>", "  granted: none", "  declared here: weatherapi — no value yet, not granted to this box"],
    errors: [],
  });

  // Once`);

  // Once the boxholder supplies the value and grants it, it reports as a grant
  // instead — a declared slot is only news while it is still waiting:

  // doctest:L199
  await setSecret({ name: "weatherapi", value: "placeholder-value-4" });
  await runCaptured(() =>
    runGrantSecret({ boxOrRoot: boxDir, name: "weatherapi", access: "agent", agentConfirmed: true }),
  );
  const after = await runCaptured(() => runSecretsStatus({ boxOrRoot: boxDir, boxRoot: boxDir }));
  t.check(seen(after, boxDir), { exitCode: undefined, logs: ["Box: <box>", "  granted: weatherapi (agent)"], errors: [] });
});

// ## `declare --use` and `describe --add-use` say why a secret exists
//
// Reasons are additive: a second trick spending the same key appends its own
// rather than overwriting the first's. Adding one is agent-facing (an agent should
// say why it now needs a key); removing one carries the agent guard, because
// deleting the line that justified a grant is a human's decision.
void test("Reasons are additive:", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
      await rm(boxDir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L223
  const dir = await useTempStore();
  const boxDir = await mkdtemp(join(tmpdir(), "weather-box-"));

  // doctest:L226
  await runCaptured(() =>
    runDeclareSecret({ name: "weatherapi", uses: ["forecasts in the morning brief"], boxRoot: boxDir }),
  );
  const described = await runCaptured(() =>
    runDescribeSecret({ name: "weatherapi", addUses: ["the umbrella reminder trick"], boxRoot: boxDir }),
  );
  t.check(seen(described, boxDir), {
    exitCode: undefined,
    logs: [`"weatherapi" is used for:
  - forecasts in the morning brief
  - the umbrella reminder trick`],
    errors: [],
  });

  // doctest:L234
  const status = await runCaptured(() => runSecretsStatus({ boxOrRoot: boxDir, boxRoot: boxDir }));
  t.check(seen(status, boxDir), {
    exitCode: undefined,
    logs: [
      "Box: <box>",
      "  granted: none",
      "  declared here: weatherapi — no value yet, not granted to this box",
      "    also declared: forecasts in the morning brief; the umbrella reminder trick",
    ],
    errors: [],
  });

  // Dropping`);

  // Dropping a reason in an agent session is refused without `--agent-confirmed`:

  // doctest:L249
  const blocked = await runCaptured(() =>
    runDescribeSecret({ name: "weatherapi", clearUses: true, boxRoot: boxDir }),
  );
  t.check(seen(blocked, boxDir), {
    exitCode: 1,
    logs: [],
    errors: [machineRefusal("Refusing to remove a secret's stated uses: this looks like an agent session (CLAUDECODE is set in the environment).")],
  });

  // doctest:L255
  const cleared = await runCaptured(() =>
    runDescribeSecret({ name: "weatherapi", clearUses: true, agentConfirmed: true }),
  );
  t.check(seen(cleared), { exitCode: undefined, logs: ["\"weatherapi\" now states no uses of its own."], errors: [] });
});

// ## `describe --add-use` is scoped to the agent's own box
//
// Adding a reason is unguarded *for the box the agent is standing in* — its own
// grants, and the slots it declared and is still waiting on. Anything else is
// refused, because an unguarded write that succeeded for a real name and errored
// for an invented one would enumerate the machine's secrets one guess at a time.
// So the refusal is uniform: another box's secret and a name that does not exist
// get the same words.
void test("Adding a reason is unguarded for the box the agent is standing in — its own g...", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L280
  const dir = await useTempStore();
  const ownBox = join(dir, "own-box");
  await mkdir(ownBox);
  await setSecret({ name: "weatherapi", value: "placeholder-value-5" });
  await grantSecret({ slug: "own-box", name: "weatherapi", access: "agent" });
  await setSecret({ name: "someone-elses", value: "placeholder-value-6" });

  // doctest:L287
  const mine = await runCaptured(() =>
    runDescribeSecret({ name: "weatherapi", addUses: ["the umbrella reminder trick"], boxRoot: ownBox }),
  );
  t.check(seen(mine), {
    exitCode: undefined,
    logs: [`"weatherapi" is used for:
  - the umbrella reminder trick`],
    errors: [],
  });

  // A secret this box holds no grant on, and a name nobody ever declared, are
  // answered identically — the only difference between the two messages is the name
  // the caller supplied:

  // doctest:L303
  const foreign = await runCaptured(() =>
    runDescribeSecret({ name: "someone-elses", addUses: ["curiosity"], boxRoot: ownBox }),
  );
  const unknown = await runCaptured(() =>
    runDescribeSecret({ name: "no-such-secret", addUses: ["curiosity"], boxRoot: ownBox }),
  );
  t.check(seen(foreign), {
    exitCode: 1,
    logs: [],
    errors: [describeRefusal({ name: "someone-elses", why: "\"someone-elses\" is not granted to — or declared by — the box you are working in (\"own-box\").", tail: "To name a slot this box needs: bbx secrets declare someone-elses --note ..." })],
  });
  t.check(seen(unknown), {
    exitCode: 1,
    logs: [],
    errors: [describeRefusal({ name: "no-such-secret", why: "\"no-such-secret\" is not granted to — or declared by — the box you are working in (\"own-box\").", tail: "To name a slot this box needs: bbx secrets declare no-such-secret --note ..." })],
  });

  // `--agent-confirmed` — a human explicitly asked — carries it through, and outside
  // a box there is no own-box view at all:

  // doctest:L322
  const confirmed = await runCaptured(() =>
    runDescribeSecret({ name: "someone-elses", addUses: ["the boxholder asked"], boxRoot: ownBox, agentConfirmed: true }),
  );
  t.check(seen(confirmed), {
    exitCode: undefined,
    logs: [`"someone-elses" is used for:
  - the boxholder asked`],
    errors: [],
  });

  // doctest:L327
  const nowhere = await runCaptured(() =>
    runDescribeSecret({ name: "weatherapi", addUses: ["curiosity"], boxRoot: null }),
  );
  t.check(seen(nowhere), {
    exitCode: 1,
    logs: [],
    errors: [describeRefusal({ name: "weatherapi", why: "the working directory is not inside a box, so there is no own-box secret this could be.", tail: "Run this from inside a box." })],
  });
});

// ## `list` prints names and metadata, never values
void test("`list` prints names and metadata, never values", async (t) => {
  t.teardown(async () => {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L346
  const dir = await useTempStore();
  await setSecret({ name: "mistral", value: "placeholder-value-3", note: "transcription" });
  const listed = await runCaptured(() => runListSecrets({ agentConfirmed: true }));
  t.check(seen(listed), {
    exitCode: undefined,
    logs: [str`mistral\tset\tupdated=${isoDate()}\tgrants=none\tnote=transcription\tused for: audio transcription (Voxtral — recordings and live chat dictation); Mistral API calls from box views, through the server-side adapter`],
    errors: [],
  });


  // ## An agent sees its own box, not the machine
  //
  // `list` is the machine-wide inventory — every secret name and which boxes hold
  // them — so it carries the same agent refusal as the mutations. `status` is
  // per-box and stays open to an agent, but only for the box the command is
  // standing in. Neither discloses a value; what is withheld is the map.

  // doctest:L364
  const listBlocked = await runCaptured(() => runListSecrets());
  t.check(seen(listBlocked), {
    exitCode: 1,
    logs: [],
    errors: [machineRefusal("Refusing to list every secret on this machine: this looks like an agent session (CLAUDECODE is set in the environment).")],
  });

  // doctest:L368
  const ownBox = join(dir, "own-box");
  const otherBox = join(dir, "other-box");
  await mkdir(ownBox);
  await mkdir(otherBox);

  // doctest:L373
  const own = await runCaptured(() => runSecretsStatus({ boxOrRoot: "own-box", boxRoot: ownBox }));
  t.check(seen(own), { exitCode: undefined, logs: ["Box: own-box", "  granted: none"], errors: [] });

  // doctest:L377
  const other = await runCaptured(() => runSecretsStatus({ boxOrRoot: "other-box", boxRoot: ownBox }));
  t.check(seen(other), {
    exitCode: 1,
    logs: [],
    errors: [statusRefusal({ head: "Refusing to report on box \"other-box\"", why: "the box you are working in is \"own-box\".", tail: "Try: bbx secrets status own-box" })],
  });

  // doctest:L381
  const nowhere = await runCaptured(() => runSecretsStatus({ boxOrRoot: "own-box", boxRoot: null }));
  t.check(seen(nowhere), {
    exitCode: 1,
    logs: [],
    errors: [statusRefusal({ head: "Refusing to report on box \"own-box\"", why: "the working directory is not inside a box, so there is no own-box view to show.", tail: "Run this from inside a box." })],
  });
});
