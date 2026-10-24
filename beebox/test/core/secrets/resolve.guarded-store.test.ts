// # Secret reads that promise not to throw still return when the store path is refused
//
// In a test process whose HOME is the account's real home, the store refuses
// to name its path (`store.real-store-guard.test.ts`). The env that marks a
// test process (`TAP`, `NODE_TEST_CONTEXT`) passes down to any program a test
// starts, so a box agent running `node --test` that shells to `bbx` reaches
// these functions with the guard live. Each one has a no-throw contract:
// `resolveSecret` returns a refusal, `secretIsResolvable` returns false, and
// the access-log writers are best-effort.
//
// This file runs under tap, so the guard is already live once HOME is the real
// home and `BBX_SECRETS_FILE` is unset. The guard refuses before any path is
// built, so nothing here reads or writes the real store.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { userInfo } from "node:os";
import { resolveSecret, secretIsResolvable } from "../../../src/core/secrets/resolve.js";
import { appendSecretAccessEvent, pruneSecretAccessLog } from "../../../src/core/secrets/access-log.js";
import { makeTmpBox } from "../../helpers/test-helpers.js";

void test("resolveSecret, secretIsResolvable and the access-log writers return when the store path is refused", async (t) => {
  const box = await makeTmpBox();
  const saved = {
    HOME: process.env.HOME,
    BBX_SECRETS_FILE: process.env.BBX_SECRETS_FILE,
    BBX_TEST_REAL_HOME: process.env.BBX_TEST_REAL_HOME,
  };
  const originalWarn = console.warn;
  const warnings: string[] = [];
  t.teardown(async () => {
    console.warn = originalWarn;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await box.cleanup();
  });
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  process.env.HOME = userInfo().homedir;
  delete process.env.BBX_SECRETS_FILE;
  delete process.env.BBX_TEST_REAL_HOME;

  const resolved = await resolveSecret({ boxRoot: box.root, slug: "test", name: "mistral", purpose: "transcription", access: "server" });
  // An unusable store is the store-unreadable refusal: the boxholder must fix the machine, not the box.
  t.check(resolved.ok ? "resolved" : { kind: resolved.error.kind, message: resolved.error.message }, {
    kind: "store-unreadable",
    message: any(String).includes("test process"),
  });

  // No store means the secret is not configured.
  t.check(await secretIsResolvable({ boxRoot: box.root, slug: "test", name: "mistral", access: "server" }), false);

  // Best-effort writers: no log line, no throw, and pruning removes nothing.
  await appendSecretAccessEvent({ ts: "2026-10-22T00:00:00.000Z", box: "test", secret: "mistral", purpose: "transcription", event: "resolve" });
  t.check(await pruneSecretAccessLog(new Date("2026-10-22T00:00:00.000Z")), []);

  // The writers warn instead of failing silently. The log write warns once per
  // process, so the refusal's own log line produced it and the direct append adds none.
  t.check(warnings, [
    any(String).startsWith("[secrets] access log unwritable at (path unavailable): Refusing to use the real secret store"),
    any(String).startsWith("[secrets] could not locate the access log for pruning: Refusing to use the real secret store"),
  ]);
});
