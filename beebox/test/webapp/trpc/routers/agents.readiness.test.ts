// # Agents: is there an agent that can run?
//
// A packaged box starts with no agent account. Its boxholder has no shell to
// run `claude auth login` in, so the web UI asks `agents.readiness` whether
// anything can carry a chat, blocks input when nothing can, and sends the owner
// to Admin → Agents. Three providers count: a Claude Code login, a Codex login,
// and an OpenRouter key with at least one added model.

import { test } from "tap";
import "agent-doctest/tap";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import { createFakeClaudeCli } from "../../../../src/services/claude-cli.js";
import { resetAgentReadinessCache } from "../../../../src/core/agent/readiness.js";
import { createFakeCodexCli } from "../../../../src/services/codex-cli/core.js";
import { clearBoxConfigCache } from "../../../../src/core/box/config.js";
import { CONFIG_RELATIVE_PATH } from "../../../../src/webapp/box-config-write.js";
import { grantSecret, setSecret } from "../../../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../../../src/lib/box-slug.js";
import { makeTmpBox } from "../../../helpers/doctest-helpers.js";
import { trpcContext } from "../../../helpers/trpc-context.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import type { Services } from "../../../../src/services/container.js";
import type { AgentReadiness } from "../../../../src/core/agent/readiness.js";

function ctxFor(boxRoot: string, { services, isOwner }: { services: Services; isOwner: boolean }): TrpcContext {
  return trpcContext({
    boxRoot,
    services,
    user: isOwner ? { email: "owner@example.com", name: "Owner" } : { email: "member@example.com", name: "Member" },
    isOwner,
    isAuthenticatedOwner: isOwner,
  });
}

function callers(boxRoot: string, services: Services) {
  const ownerAgents = appRouter.createCaller(ctxFor(boxRoot, { services, isOwner: true })).agents;
  return {
    owner: {
      reconcileDefault: ownerAgents.reconcileDefault,
      // The owner's answer carries the full per-provider detail; members get only `anyReady`.
      readiness: async (): Promise<AgentReadiness> => {
        const r = await ownerAgents.readiness();
        if (!("claude" in r)) throw new Error("owner readiness lacks provider detail");
        return r;
      },
    },
    member: appRouter.createCaller(ctxFor(boxRoot, { services, isOwner: false })).agents,
  };
}

async function config(boxRoot: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(boxRoot, CONFIG_RELATIVE_PATH), "utf8"));
}

async function patchConfig(boxRoot: string, fields: Record<string, unknown>): Promise<void> {
  const current = await config(boxRoot).catch(() => ({}));
  await writeFile(join(boxRoot, CONFIG_RELATIVE_PATH), JSON.stringify({ ...current, ...fields }, null, 2));
  clearBoxConfigCache(boxRoot);
}

// ## A fresh box has nothing, and members learn only that
void test("A fresh box has nothing, and members learn only that", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
      delete process.env.BBX_SECRETS_FILE;
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L68
  process.env.BBX_SECRETS_FILE = join(await mkdtemp(join(tmpdir(), "bbx-secrets-")), "secrets.json");
  const box = await makeTmpBox({ git: true });
  const claudeCli = createFakeClaudeCli({ loggedIn: false });
  const codexCli = createFakeCodexCli({ status: { kind: "logged-out" } });
  const { owner, member } = callers(box.root, { claudeCli, codexCli });

  // doctest:L74
  t.check(await owner.readiness(), {
    claude: "not-ready",
    codex: "not-ready",
    openrouter: "not-ready",
    anyReady: false,
    defaultReady: false,
  });

  // doctest:L77
  t.check(await member.readiness(), {
    anyReady: false,
  });

  // With nothing usable there is nothing to switch to, so reconciling leaves the
  // config alone.

  // doctest:L85
  t.check((await owner.reconcileDefault()).switched, false);

  // ## Signing in to Codex alone moves the default to Codex
  //
  // The box defaults to the claude engine, which cannot run. Reconciling after the
  // Codex sign-in switches the engine and clears any pinned model, so Codex's own
  // default applies.

  // doctest:L96
  await patchConfig(box.root, { agentModel: "claude-opus-5-5" });
  codexCli.status = { kind: "logged-in" };
  resetAgentReadinessCache();
  const before = await owner.readiness();
  t.check([before.anyReady, before.defaultReady], [
    true,
    false,
  ]);

  // doctest:L103
  const moved = await owner.reconcileDefault();
  const saved = await config(box.root);
  t.check([moved.switched, saved.agentEngine, saved.agentModel ?? null, moved.readiness.defaultReady], [
    true,
    "codex",
    null,
    true,
  ]);

  // ## A working default is never moved
  //
  // Signing in to Claude Code later changes nothing: the Codex default still runs.

  // doctest:L114
  claudeCli.loggedIn = true;
  resetAgentReadinessCache();
  t.check((await owner.reconcileDefault()).switched, false);

  // doctest:L119
  t.check((await config(box.root)).agentEngine, "codex");

  // ## An explicit engine list gains the new default
  //
  // When the owner has set which engines the box offers, the switch adds the new
  // default to that list instead of leaving a default the box does not offer.

  // doctest:L129
  codexCli.status = { kind: "logged-out" };
  resetAgentReadinessCache();
  await patchConfig(box.root, { engines: { codex: true, claude: false } });
  await owner.reconcileDefault();
  const listed = await config(box.root);
  t.check([listed.agentEngine, listed.engines], [
    "claude",
    {
      codex: true,
      claude: true,
    },
  ]);

  // ## OpenRouter counts once a key is granted and a model is added
  //
  // An OpenRouter model rides the claude engine but needs no Claude login. With
  // both logins gone, a granted key and an added model make the box ready, and
  // reconciling pins that model as the default.

  // doctest:L145
  claudeCli.loggedIn = false;
  resetAgentReadinessCache();
  await patchConfig(box.root, { openrouterModels: [{ id: "qwen/qwen3-coder", label: "Qwen3 Coder" }] });
  t.check((await owner.readiness()).openrouter, "not-ready");

  // doctest:L151
  await setSecret({ name: "openrouter", value: "placeholder-openrouter-key" });
  await grantSecret({ slug: await boxSlug(box.root), name: "openrouter", access: "server" });
  const withKey = await owner.readiness();
  t.check([withKey.openrouter, withKey.anyReady, withKey.defaultReady], [
    "ready",
    true,
    false,
  ]);

  // doctest:L157
  const pinned = await owner.reconcileDefault();
  const afterPin = await config(box.root);
  t.check([pinned.switched, afterPin.agentEngine, afterPin.agentModel], [
    true,
    "claude",
    "qwen/qwen3-coder",
  ]);

  // ## An inconclusive probe blocks nothing and moves nothing
  //
  // A Claude probe that returns no answer is not a logout (the run-time preflight
  // lets it through). It keeps chat unblocked, and it is not grounds to move the
  // default either.

  // doctest:L170
  await patchConfig(box.root, { agentModel: undefined, agentEngine: "claude" });
  claudeCli.authStatus = async () => ({ probeInconclusive: true });
  resetAgentReadinessCache();
  const unsure = await owner.readiness();
  t.check([unsure.claude, unsure.defaultReady], [
    "unknown",
    true,
  ]);

  // doctest:L177
  t.check((await owner.reconcileDefault()).switched, false);

  // ## A missing Claude CLI is not a flaky probe
  //
  // When `claude` cannot be spawned at all, the probe says so. That is "no Claude
  // Code here", not a transient non-answer, so it does not keep chat unblocked.

  // doctest:L187
  await patchConfig(box.root, { openrouterModels: [] });
  claudeCli.authStatus = async () => ({ probeInconclusive: true, error: "spawn claude ENOENT", cliMissing: true });
  resetAgentReadinessCache();
  const missing = await owner.readiness();
  t.check([missing.claude, missing.anyReady], [
    "not-ready",
    false,
  ]);

  // ## A runnable default counts even when it is none of the three
  //
  // A GLM model with its key rides the claude engine without a Claude login. When
  // it is the default, chat can run, so the box is not blocked.

  // doctest:L201
  await setSecret({ name: "glm", value: "placeholder-glm-key" });
  await grantSecret({ slug: await boxSlug(box.root), name: "glm", access: "server" });
  await patchConfig(box.root, { agentModel: "glm-5.3" });
  const glm = await owner.readiness();
  t.check([glm.defaultReady, glm.anyReady], [
    true,
    true,
  ]);

  // ## Answers are cached, and the admin page's live probe refreshes them
  //
  // Each login probe spawns a CLI, and the web UI asks on every load and focus,
  // so a sign-in is remembered for minutes. A logout made outside the admin page
  // shows up when that expires; the admin page's own status check updates the
  // cache at once, which is how a sign-in it is polling for unblocks chat.

  // doctest:L217
  await patchConfig(box.root, { agentModel: undefined, agentEngine: "codex" });
  codexCli.status = { kind: "logged-in" };
  resetAgentReadinessCache();
  t.check((await owner.readiness()).codex, "ready");

  // doctest:L223
  codexCli.status = { kind: "logged-out" };
  t.check((await owner.readiness()).codex, "ready");

  // doctest:L227
  const adminCaller = appRouter.createCaller(ctxFor(box.root, { services: { claudeCli, codexCli }, isOwner: true })).admin;
  await adminCaller.codexStatus();
  t.check((await owner.readiness()).codex, "not-ready");

  // ## Only the owner can move the default

  // doctest:L236
  t.check(await member.reconcileDefault().then(() => "ok", (error: unknown) => (error instanceof TRPCError ? error.code : String(error))), "FORBIDDEN");
});
