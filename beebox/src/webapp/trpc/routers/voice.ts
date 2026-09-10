/**
 * What this box's voice services can actually use right now — the query the
 * pickers read so they never offer a choice whose only outcome is a 500 on
 * every pass (boxholder, 2026-09-09: "Even being able to select the model
 * without the key is wrong").
 *
 * `ownerProcedure`, not `publicProcedure` like `transcription.config` and
 * `tts.config`: those expose the selected service, which the chat shows to
 * everyone, while this exposes whether the box can resolve provider
 * credentials — box-scoped grant metadata, the owner's to see and nobody
 * else's. Not `authenticatedOwnerProcedure` either: nothing here is the
 * machine store, so a box that lets agent browsing act as its owner may read
 * it, which is what lets the picker be driven in a browser test.
 */

import { serviceCapabilities } from "../../../core/model-capabilities.js";
import { ownerProcedure, router } from "../trpc.js";

export const voiceRouter = router({
  capabilities: ownerProcedure.query(({ ctx }) => serviceCapabilities(ctx.boxRoot)),
});
