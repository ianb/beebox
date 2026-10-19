// # Voice pickers only offer what the box can use
//
// `voice.capabilities` says, per HQ transcription service and TTS backend,
// whether this box holds a credential that reaches it — the question the pickers
// ask before offering a choice. Choosing an unusable service still saves (a key
// may be granted later) but comes back with a warning the client must show.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appRouter } from "../../../../src/webapp/trpc/routers.js";
import type { TrpcContext } from "../../../../src/webapp/trpc/context.js";
import { grantSecret, setSecret } from "../../../../src/core/secrets/lifecycle.js";
import { boxSlug } from "../../../../src/lib/box-slug.js";
import { makeTmpBox } from "../../../helpers/test-helpers.js";
import { silentEventBus, trpcContext } from "../../../helpers/trpc-context.js";

const noBus: TrpcContext["eventBus"] = silentEventBus;
function owner(boxRoot: string) {
  return appRouter.createCaller(trpcContext({
    boxRoot,
    eventBus: noBus,
    user: { email: "owner@example.com", name: "Owner" },
    isAuthenticatedOwner: true,
  }));
}

// ## Nothing granted: everything is unusable, and each says what it needs
void test("Nothing granted: everything is unusable, and each says what it needs", async (t) => {
  t.teardown(async () => {
    try {
      await box.cleanup();
    } catch (error) {
      t.error(error);
    }
  });
  // doctest:L33
  const dir = await mkdtemp(join(tmpdir(), "bbx-secrets-"));
  process.env.BBX_SECRETS_FILE = join(dir, "secrets.json");
  const box = await makeTmpBox({ git: true });
  const caps = await owner(box.root).voice.capabilities();
  t.check({ mai: caps.hq["mai-diarized"], gemini: caps.tts.gemini, whisper: caps.hq.whisper }, {
    mai: {
      usable: false,
      needs: [
        "openrouter",
      ],
    },
    gemini: {
      usable: false,
      needs: [
        "gemini",
      ],
    },
    whisper: {
      usable: false,
      needs: [
        "openai-thinking",
        "openrouter",
      ],
    },
  });

  // Saving an unusable choice is allowed and warned about in the same response.

  // doctest:L44
  const chosen = await owner(box.root).transcription.setHqService({ hqService: "mai-diarized" });
  t.check(`${chosen.hqService} — ${String(chosen.warning)}`, "mai-diarized — This box has no key for mai-diarized yet; grant openrouter in Admin → Secrets or it will fail on every pass.");

  // ## One OpenRouter grant lights up everything it reaches
  //
  // Gemini speech is not among them: through OpenRouter it would lose the
  // personality card's speaking style, so choosing it still saves but warns.

  // doctest:L55
  await setSecret({ name: "openrouter", value: "sk-or-v1-placeholder-placeholder-placeholder-placeholder" });
  await grantSecret({ slug: await boxSlug(box.root), name: "openrouter", access: "server" });
  const lit = await owner(box.root).voice.capabilities();
  t.check({ mai: lit.hq["mai-diarized"].usable, gemini: lit.tts.gemini.usable, whisper: lit.hq.whisper.usable, voxtral: lit.hq.voxtral.usable, openaiTts: lit.tts.openai.usable }, {
    mai: true,
    gemini: false,
    whisper: true,
    voxtral: false,
    openaiTts: false,
  });

  // doctest:L61
  const ok = await owner(box.root).tts.setBackend({ backend: "gemini" });
  t.check(`${ok.backend} — ${String(ok.warning)}`, "gemini — This box has no key for gemini yet; grant gemini in Admin → Secrets or it will fail on every pass.");
});
