// # Google connector OAuth `state` nonce store
//
// The Google-services OAuth callback persists shared, broadly-scoped Google tokens
// and is reachable outside the per-box auth wall. `createGoogleOAuthState` (called
// behind the owner wall in `googleSetup`) mints a one-time nonce the callback must
// present back via `consumeGoogleOAuthState`; without a valid nonce the callback
// rejects. See `src/google/oauth-state.ts`.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, capture } from "@ianbicking/tap-check/check";
import * as os from "node:os";
import * as path from "node:path";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
  const state = createGoogleOAuthState({ boxRoot, boxSlug: "ledger", returnPath: "admin", createdBy: "owner@example.com" });
  const nonce = capture(any(String).matches(/./));
  t.check(parseOAuthState(state), { boxSlug: "ledger", nonce });
  t.check(state, `ledger:${nonce.value}`);

  // ## A valid nonce consumes exactly once (one-time use closes replay)

  const first = consumeGoogleOAuthState({ boxRoot, nonce: nonce.value });
  t.check(first, {
    returnPath: "admin",
    createdBy: "owner@example.com",
  });

  t.check(
    // Replaying the same nonce fails — it was consumed.
    consumeGoogleOAuthState({ boxRoot, nonce: nonce.value }),
    null,
  );

  // ## An unknown / attacker-chosen nonce is rejected

  t.check(consumeGoogleOAuthState({ boxRoot, nonce: "not-a-real-nonce" }), null);

  t.check(consumeGoogleOAuthState({ boxRoot, nonce: "" }), null);

  // ## Legacy stateless shapes carry no nonce, so they no longer authorize

  t.check(parseOAuthState("ledger"), null);

  // `parseOAuthState` treats everything after the first colon as the nonce, so the
  // legacy `boxSlug:returnPath` shape parses to a nonce of `"admin"` — which is not a
  // real minted nonce, so `consumeGoogleOAuthState` rejects it:

  t.check(parseOAuthState("ledger:admin"), { boxSlug: "ledger", nonce: "admin" });
  t.check(consumeGoogleOAuthState({ boxRoot, nonce: "admin" }), null);

  // ## An expired nonce is pruned and rejected

  const storePath = path.join(boxRoot, ".beebox", "google-oauth-state.secret.json");
  await mkdir(path.dirname(storePath), { recursive: true });
  // Hand-write an already-expired record (nonceHash is sha256 of "stale-nonce").
  const staleHash = createHash("sha256").update("stale-nonce").digest("hex");
  await writeFile(storePath, JSON.stringify({ pending: [{ nonceHash: staleHash, returnPath: "admin", createdBy: null, createdAt: 1, expiresAt: 2 }] }));

  t.check(consumeGoogleOAuthState({ boxRoot, nonce: "stale-nonce" }), null);
});
