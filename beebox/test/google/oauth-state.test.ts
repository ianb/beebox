// # Google connector OAuth `state` nonce store
//
// The Google-services OAuth callback persists shared, broadly-scoped Google tokens
// and is reachable outside the per-box auth wall. `createGoogleOAuthState` (called
// behind the owner wall in `googleSetup`) mints a one-time nonce the callback must
// present back via `consumeGoogleOAuthState`; without a valid nonce the callback
// rejects. See `src/google/oauth-state.ts`.

import { test } from "tap";
import "agent-doctest/tap";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  createGoogleOAuthState,
  consumeGoogleOAuthState,
  parseOAuthState,
} from "../../src/google/oauth-state.js";

const boxRoot = await mkdtemp(path.join(os.tmpdir(), "oauth-state-"));

// ## `state` is `<boxSlug>:<nonce>`, and the nonce round-trips
void test("`state` is `<boxSlug>:<nonce>`, and the nonce round-trips", async (t) => {
  t.teardown(async () => {
    try {
      await rm(boxRoot, { recursive: true, force: true });
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L27
  const state = createGoogleOAuthState({ boxRoot, boxSlug: "ledger", returnPath: "admin", createdBy: "owner@example.com" });
  const parsed = parseOAuthState(state);
  assert.ok(parsed, "the minted state parses");
  t.check({ boxSlug: parsed.boxSlug, hasNonce: parsed.nonce.length > 0 }, {
    boxSlug: "ledger",
    hasNonce: true,
  });

  // ## A valid nonce consumes exactly once (one-time use closes replay)

  // doctest:L37
  const first = consumeGoogleOAuthState({ boxRoot, nonce: parsed.nonce });
  t.check(first, {
    returnPath: "admin",
    createdBy: "owner@example.com",
  });

  // doctest:L41
  t.check(
    // Replaying the same nonce fails — it was consumed.
    consumeGoogleOAuthState({ boxRoot, nonce: parsed.nonce }),
    null,
  );

  // ## An unknown / attacker-chosen nonce is rejected

  // doctest:L49
  t.check(consumeGoogleOAuthState({ boxRoot, nonce: "not-a-real-nonce" }), null);

  // doctest:L52
  t.check(consumeGoogleOAuthState({ boxRoot, nonce: "" }), null);

  // ## Legacy stateless shapes carry no nonce, so they no longer authorize

  // doctest:L59
  t.check(parseOAuthState("ledger"), null);

  // doctest:L62
  await t.checkText(parseOAuthState("ledger:admin") === null, "false");

  // `parseOAuthState` treats everything after the first colon as the nonce, so the
  // legacy `boxSlug:returnPath` shape parses to a nonce of `"admin"` — which is not a
  // real minted nonce, so `consumeGoogleOAuthState` rejects it:

  // doctest:L71
  const legacy = parseOAuthState("ledger:admin");
  assert.ok(legacy, "the legacy state parses");
  t.check(consumeGoogleOAuthState({ boxRoot, nonce: legacy.nonce }), null);

  // ## An expired nonce is pruned and rejected

  // doctest:L80
  const storePath = path.join(boxRoot, ".beebox", "google-oauth-state.secret.json");
  await mkdir(path.dirname(storePath), { recursive: true });
  // Hand-write an already-expired record (nonceHash is sha256 of "stale-nonce").
  const staleHash = createHash("sha256").update("stale-nonce").digest("hex");
  await writeFile(storePath, JSON.stringify({ pending: [{ nonceHash: staleHash, returnPath: "admin", createdBy: null, createdAt: 1, expiresAt: 2 }] }));

  // doctest:L86
  t.check(consumeGoogleOAuthState({ boxRoot, nonce: "stale-nonce" }), null);
});
