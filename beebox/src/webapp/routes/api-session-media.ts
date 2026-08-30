/**
 * `GET /api/session-media/<sessionId>/<entryUuid>/<index>` — serve one image
 * that lives inline in a session transcript.
 *
 * A photo attached in chat is written into the transcript's own JSONL line as
 * base64 and stored nowhere else, and the history path strips those payloads
 * rather than carry megabytes per read (`cli/lib/session-oversize.ts`). Before
 * this route the stripped block became `[image not displayed]`, so a reloaded
 * conversation showed placeholders where the user's photographs had been
 * (`issues/bugs/2026-08-24-reloaded-conversation-hides-the-photos-you-sent.md`).
 *
 * The photograph was never lost — only left behind. This is the door back to
 * it: history hands the client coordinates, and the client asks for the bytes
 * per image, when it needs them. A photo scrolled past is never fetched, so a
 * long scrollback costs what it did before; a photo looked at costs one line.
 *
 * **What one request costs, and why that is bounded.** Reaching one photo means
 * materializing the line it lives on: up to `MAX_MEDIA_LINE_BYTES` (8 MB,
 * ~1.3 MB in practice for a single-photo turn), plus the structure string with
 * the payloads swapped out, plus the one decoded image. `extractSessionMedia`
 * holds payload *offsets* rather than copies, so a turn carrying several photos
 * does not multiply that. Typical peak is a few MB; worst case is in the tens.
 *
 * Concurrency is bounded by the client rather than here: images render with
 * `loading="lazy"`, so only what is near the viewport is requested at all, and
 * a browser opens ~6 connections per origin. That is a different order from the
 * 2026-08 OOM, where EVERY oversize line in a transcript was parsed on EVERY
 * history request and identical requests stacked. If this ever needs a harder
 * ceiling, an in-flight limiter belongs here — it is deliberately absent while
 * the reachable peak stays this small.
 *
 * Auth is the box's own wall — this route sits under `/api/*` like every
 * other, so the same session gates it (`server-box-scope.ts`). It reads only
 * transcripts belonging to sessions this box knows about: `resolveSessionLogPath`
 * answers from the box's own session history, and the ids are constrained to
 * characters that cannot leave that directory (`shared/session-media.ts`).
 */

import type { FastifyInstance } from "fastify";
import { findTranscriptLineByUuid } from "../../cli/lib/session-line-scan.js";
import { extractSessionMedia } from "../../cli/lib/session-media-extract.js";
import { resolveSessionLogPath } from "../../core/chat/session/history.js";
import { parseSessionMediaRef, SESSION_MEDIA_ROUTE } from "../../shared/session-media.js";

/**
 * How long a client may reuse a fetched image without asking again.
 *
 * A transcript line is append-only and identified by a uuid the writer never
 * reuses, so the bytes behind one reference cannot change. `immutable` is
 * therefore literally true here, and it is what makes scrolling back through a
 * long conversation a second time cost nothing. Private: the image is one
 * box's conversation, and must not be held by a shared cache.
 */
const CACHE_CONTROL = "private, max-age=31536000, immutable";

export function registerApiSessionMediaRoutes({
  server,
  boxRoot,
}: {
  server: FastifyInstance;
  boxRoot: string;
}): void {
  server.get<{ Params: { "*": string | undefined } }>(
    `/api/${SESSION_MEDIA_ROUTE}/*`,
    { exposeHeadRoute: true },
    async (request, reply) => {
      const ref = parseSessionMediaRef(request.params["*"] ?? "");
      if (ref === null) return reply.status(400).send({ error: "Malformed media reference" });

      const logPath = await resolveSessionLogPath(boxRoot, ref.sessionId);
      const lookup = await findTranscriptLineByUuid({ logPath, uuid: ref.entryUuid });
      if (!lookup.found) {
        if (lookup.reason === "too-large") {
          return reply.status(413).send({ error: "Transcript entry too large to read" });
        }
        return reply.status(404).send({ error: "Not found" });
      }

      const extracted = extractSessionMedia({ line: lookup.line, index: ref.index });
      if (!extracted.ok) {
        // `no-payload` is the honest 404 too: the block is there, the bytes
        // never were. Saying so more precisely would only describe someone
        // else's failed upload back to them.
        return reply.status(404).send({ error: "Not found" });
      }

      return reply
        .header("Content-Type", extracted.media.mediaType)
        .header("Cache-Control", CACHE_CONTROL)
        // The bytes are a user's photograph, not a document to render: keep a
        // browser from ever treating this response as active content.
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Disposition", "inline")
        .send(extracted.media.bytes);
    },
  );
}
