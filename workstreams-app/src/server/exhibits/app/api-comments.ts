// Comments from an exhibit page (docs/plans/exhibit-comments.md).
//
// POST /api/<ws>/<exhibit>/comments writes one remark to the comment store,
// addressed to the exhibit's workstream, through the same `bin/comments` the
// dashboard uses — this origin never touches the store itself. POST
// /api/transcribe turns a short recording into text for that remark.
//
// Nested inside the JSON half of api.ts so it inherits that plugin's body
// parser, its error handler, and the auth hook of the exhibits instance.

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import {
  DOCUMENT_BODY_LIMIT,
  ExhibitRequestError,
  lastLine,
  parseJsonBody,
  requireSegment,
  scopeDir,
  type ScopeParams,
} from "./api.js";
import { APPS_SEGMENT } from "../store.js";
import { CommentsCliError, type CommentsService } from "../../comments-service.js";
import type { TranscribeService } from "../../services.js";
import {
  MAX_AUDIO_BYTES,
  TranscriptionNotConfiguredError,
  TranscriptionRefusedError,
  TranscriptionShapeError,
  transcribeInputSchema,
} from "../../transcribe-contract.js";

export interface ExhibitCommentOptions {
  storeRoot: string;
  /** Writes through `bin/comments`; the exhibits origin is one more caller of that CLI. */
  comments: Pick<CommentsService, "add">;
  transcribe: TranscribeService;
}

/** The same field limits as the dashboard's tRPC `comments.add`. */
const commentBodySchema = z.object({
  body: z.string().min(1).max(10_000),
  origin: z.enum(["typed", "voice"]).default("typed"),
  quoted: z.string().max(10_000).optional(),
  section: z.string().max(500).optional(),
  fragment: z.string().max(4096).optional(),
});

function issuesOf(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`);
}

export const exhibitCommentRoutes: FastifyPluginAsync<ExhibitCommentOptions> = async (json, options) => {
  const { storeRoot, comments, transcribe } = options;

  json.post<{ Params: ScopeParams; Body: string }>(
    "/:ws/:exhibit/comments",
    { bodyLimit: DOCUMENT_BODY_LIMIT },
    async (request, reply) => {
      const workstream = requireSegment(request.params.ws, "workstream");
      const exhibit = requireSegment(request.params.exhibit, "exhibit name");
      // Before any store access: scopeDir creates an app's directory on first
      // use, and a refused comment must leave nothing behind.
      if (workstream === APPS_SEGMENT) {
        return reply.code(409).send({ message: "Apps have no workstream to send a comment to." });
      }
      await scopeDir(storeRoot, request.params);
      const parsed = commentBodySchema.safeParse(parseJsonBody(request.body, "comment"));
      if (!parsed.success) {
        throw new ExhibitRequestError(400, "A comment is { body, origin?, quoted?, section?, fragment? }.").withIssues(
          issuesOf(parsed.error),
        );
      }
      const { body, origin, quoted, section, fragment } = parsed.data;
      try {
        const { id } = await comments.add({
          target: { exhibit: { workstream, exhibit } },
          body,
          origin,
          workstream,
          ...(quoted === undefined ? {} : { quoted }),
          ...(section === undefined ? {} : { section }),
          ...(fragment === undefined ? {} : { fragment }),
        });
        return await reply.code(201).send({ id, workstream });
      } catch (error) {
        if (!(error instanceof CommentsCliError)) throw error;
        return reply.code(409).send({ message: "The comment was not saved.", detail: lastLine(error.message) });
      }
    },
  );

  json.post<{ Body: string }>("/transcribe", { bodyLimit: DOCUMENT_BODY_LIMIT }, async (request, reply) => {
    const parsed = transcribeInputSchema.safeParse(parseJsonBody(request.body, "transcribe"));
    if (!parsed.success) {
      throw new ExhibitRequestError(400, "A transcription request is { audio: <base64>, mimeType? }.").withIssues(
        issuesOf(parsed.error),
      );
    }
    const audio = Buffer.from(parsed.data.audio, "base64");
    // Capped in bytes, the same rule as the dashboard route: the client stops
    // recording before this, so reaching it means a client that did not.
    if (audio.byteLength > MAX_AUDIO_BYTES) {
      throw new ExhibitRequestError(
        413,
        `That recording is ${String(Math.round(audio.byteLength / 1000))} kB; the limit is ${String(Math.round(MAX_AUDIO_BYTES / 1000))} kB.`,
      );
    }
    try {
      return await reply.code(200).send(await transcribe.transcribe({ audio, mimeType: parsed.data.mimeType }));
    } catch (error) {
      // Each of these leaves the recording in the page, so the message says
      // what to do next (the contract's wording), and the status says why.
      if (error instanceof TranscriptionNotConfiguredError) throw new ExhibitRequestError(412, error.message);
      if (error instanceof TranscriptionRefusedError || error instanceof TranscriptionShapeError) {
        throw new ExhibitRequestError(502, error.message);
      }
      throw error;
    }
  });
};
