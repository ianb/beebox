// # OpenRouter is a fallback, never an override
//
// `routeVia` (`src/core/openrouter.ts`) decides, for one workload, whether a
// request goes to the service's own provider or through OpenRouter. The rule is
// one sentence and these tests are the whole of it: **a service's own key wins.**
//
// Adding an OpenRouter key must never change what an already-working box does.
// For semantic search that is not a preference — the embedder's identity is
// hashed into every card's embed record, so a route that quietly changed the
// vectors would invalidate an index nobody asked to rebuild. Consolidating is
// therefore an explicit act: remove the direct key, and the service falls
// through.

import { test } from "tap";
import "agent-doctest/tap";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { routeVia, getOpenRouterKey } from "../../src/core/openrouter.js";
import { grantSecret, setSecret } from "../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../src/lib/box-slug.js";
import { makeTmpBox } from "../helpers/test-helpers.js";

async function useTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  return dir;
}

// ## With no key at all, there is no route
//
// A workload with neither credential is not broken — it is unconfigured, which is
// the state every caller here already handles by degrading (text-only search, the
// Claude scan backend, a CLI that says what to grant).
void test("A workload with neither credential is not broken — it is unconfigured, which...", async (t) => {
  // doctest:L37
  await useTempStore();
  const box = await makeTmpBox();

  // doctest:L41
  const nothing = await routeVia({ boxRoot: box.root, purpose: "embeddings", directKey: null });
  t.check(nothing, null);
});

// ## The direct key alone routes direct
void test("The direct key alone routes direct", async (t) => {
  // doctest:L49
  await useTempStore();
  const box = await makeTmpBox();

  // doctest:L52
  const direct = await routeVia({ boxRoot: box.root, purpose: "embeddings", directKey: "placeholder-openai-key" });
  t.check(direct, {
    via: "direct",
    apiKey: "placeholder-openai-key",
  });
});

// ## The OpenRouter key alone routes through OpenRouter
void test("The OpenRouter key alone routes through OpenRouter", async (t) => {
  // doctest:L60
  await useTempStore();
  const box = await makeTmpBox();
  const slug = await boxSlug(box.root);

  // doctest:L64
  await setSecret({ name: "openrouter", value: "placeholder-openrouter-key" });
  await grantSecret({ slug, name: "openrouter", access: "server" });

  // doctest:L67
  const fallback = await routeVia({ boxRoot: box.root, purpose: "embeddings", directKey: null });
  t.check(fallback, {
    via: "openrouter",
    apiKey: "placeholder-openrouter-key",
  });
});

// ## Both present: the direct key still wins
//
// This is the case the decision is about. The OpenRouter key is granted and
// usable, and it is not used — the box keeps the provider it already had.
void test("This is the case the decision is about.", async (t) => {
  // doctest:L78
  await useTempStore();
  const box = await makeTmpBox();
  const slug = await boxSlug(box.root);

  // doctest:L82
  await setSecret({ name: "openrouter", value: "placeholder-openrouter-key" });
  await grantSecret({ slug, name: "openrouter", access: "server" });

  // doctest:L85
  const both = await routeVia({ boxRoot: box.root, purpose: "embeddings", directKey: "placeholder-openai-key" });
  t.check(both, { via: "direct", apiKey: "placeholder-openai-key" });
  t.check(await getOpenRouterKey(box.root, { purpose: "embeddings", observe: false }), "placeholder-openrouter-key");
});

// ## An ungranted OpenRouter key is not a route
//
// Storing a secret on the machine is not granting it to a box, and there is no
// further arm to fall to — the box is simply unconfigured.
void test("Storing a secret on the machine is not granting it to a box, and there is no...", async (t) => {
  // doctest:L99
  await useTempStore();
  const box = await makeTmpBox();

  // doctest:L102
  await setSecret({ name: "openrouter", value: "placeholder-openrouter-key" });
  const ungranted = await routeVia({ boxRoot: box.root, purpose: "embeddings", directKey: null });
  t.check(ungranted, null);
});

// There is no env-var arm and no legacy file: secret custody retired both for
// every provider key, so a credential introduced after that migration is
// store-only from the start rather than born with a deprecated path.
void test("There is no env-var arm and no legacy file:", async (t) => {
  // doctest:L113
  await useTempStore();
  const box = await makeTmpBox();
  process.env.BBX_OPENROUTER_API_KEY = "placeholder-env-openrouter-key";

  // doctest:L117
  const ignored = await routeVia({ boxRoot: box.root, purpose: "embeddings", directKey: null });
  delete process.env.BBX_OPENROUTER_API_KEY;
  t.check(ignored, null);
});
