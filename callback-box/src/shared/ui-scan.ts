/**
 * The wire contract of `cb chat ui`: what a connected client sends back when
 * the agent asks what controls are on the user's screen.
 *
 * Lives in `shared/` for the same reason `chat-channel.ts` does — the client
 * produces the payload and the route layer validates it, so both halves must
 * name one shape. The Zod schema *is* the contract: the answer route parses a
 * client body with it (`strict()`, so an old or hostile client's extra field is
 * a 400 rather than something the dump silently carries), and the entry type is
 * inferred from it rather than restated.
 *
 * The frontend's `lib/ui-scan/types.ts` `ControlEntry` is the producing shape;
 * it is assigned into {@link UiScanEntry} at the send site, so a drift between
 * the scan and the wire is a compile error there.
 */

import { z } from "zod";
import { CHAT_CHANNELS } from "./chat-channel.js";

/**
 * How much of the surface the scan actually saw.
 *
 * - `dom` — a web client: the page is the whole surface.
 * - `dom+native` — the iOS shell answered the native half too (Track 5).
 * - `dom-native-unavailable` — running inside the native shell, but the native
 *   control inventory could not be obtained, so the composer/mic/capture and
 *   the box switcher are missing from the dump. Stated out loud in the dump
 *   rather than left to look like "this surface has no such controls".
 */
export const UI_SCAN_COVERAGES = ["dom", "dom+native", "dom-native-unavailable"] as const;

export type UiScanCoverage = (typeof UI_SCAN_COVERAGES)[number];

/** What a `control:` pointer may ask the app to do with an element. */
export const controlActionSchema = z.enum(["point", "focus", "reveal"]);

/**
 * `cb-` plus kebab-case segments — the same address grammar the frontend
 * resolver enforces (`lib/ui-scan/resolve.ts`), restated here because this is
 * the boundary. An id that is not a real address must never reach the dump: it
 * would be printed as a `control:` link the app cannot honour.
 */
const CONTROL_ID_PATTERN = /^cb(?:-[\da-z]+)+$/;

/**
 * Text a client may put in front of the agent. Control characters (newlines
 * included) are rejected rather than stripped: a scan is machine-generated
 * from an accessible name, so a newline in one means either a broken client
 * or an attempt to forge extra dump lines. Brackets are legal — a name may
 * genuinely contain one — and the dump escapes them where it builds a link.
 */
const plainText = (max: number): z.ZodString =>
  z
    .string()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
    .regex(/^[^\u0000-\u001F\u007F]+$/, "must be single-line text");

/** One control or landmark, as the client reports it. */
export const uiScanEntrySchema = z
  .object({
    kind: z.enum(["control", "landmark"]),
    /** The element's `cb-` DOM id, or null for a control with no address. */
    id: z.string().max(120).regex(CONTROL_ID_PATTERN).nullable(),
    role: plainText(60),
    name: plainText(300),
    container: plainText(300).nullable(),
    does: plainText(600).nullable(),
    actions: z.array(controlActionSchema).max(3),
    disabled: z.boolean(),
    offscreen: z.boolean(),
  })
  .strict();

export type UiScanEntry = z.infer<typeof uiScanEntrySchema>;

/**
 * Server-side cap on reported entries and on the duplicate-address list,
 * matching the client scan's own `MAX_ENTRIES`. The client truncates and says
 * so; this is the boundary's refusal to accept more than that from a client
 * that didn't.
 */
export const MAX_SCAN_ENTRIES = 200;

/** A client's successful answer: the inventory plus the facts the dump states. */
export const uiScanPayloadSchema = z
  .object({
    entries: z.array(uiScanEntrySchema).max(MAX_SCAN_ENTRIES),
    /** Visible controls dropped because they yielded no accessible name. */
    omittedUnnamed: z.number().int().nonnegative(),
    /** Visible elements dropped because their explicit `role` isn't one we report. */
    omittedUnknownRole: z.number().int().nonnegative(),
    /** `cb-` ids carried by more than one element — `getElementById` picks one. */
    duplicateIds: z.array(z.string().max(120).regex(CONTROL_ID_PATTERN)).max(MAX_SCAN_ENTRIES),
    /** True when the entry cap stopped the walk before the document ended. */
    truncated: z.boolean(),
    coverage: z.enum(UI_SCAN_COVERAGES),
    channel: z.enum(CHAT_CHANNELS),
    /**
     * Path + query of the page scanned. Path-only by construction and by
     * validation — an absolute URL here would let a client point the agent at
     * somewhere it never was.
     */
    url: plainText(2000).regex(/^\/\S*$/, "must be a path, not an absolute URL"),
    scannedAt: z.string().datetime(),
  })
  .strict();

export type UiScanPayload = z.infer<typeof uiScanPayloadSchema>;

/**
 * Everything a client may POST to `/api/chat/ui/:requestId`: the ack that
 * closes the server's `no-client` window, the payload, or a reason it could
 * not scan. There is no `declined` member — this flow has no consent prompt
 * (see `chat-ui-routes.ts`).
 */
export const uiScanAnswerSchema = z.union([
  z.object({ ack: z.literal(true) }).strict(),
  uiScanPayloadSchema,
  z.object({ failed: z.string().min(1).max(500) }).strict(),
]);

export type UiScanAnswer = z.infer<typeof uiScanAnswerSchema>;
