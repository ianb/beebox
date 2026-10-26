/**
 * The hub's answer to the phone's box screen for a sleeping box: the box's
 * own last `quickChat.home` answer, from the snapshot it left at shutdown
 * (`core/chat/routing/home-snapshot.ts`), without waking it
 * (docs/plans/ios-box-screen-stale-list.md, Track 3).
 *
 * Only a verified mobile credential that is also a bearer the snapshot lists
 * (a device whose pairer could open the box when it went to sleep), only
 * `GET quickChat.home`, and only while the provider's non-waking `get()` has
 * no endpoint. Anything else, or no
 * snapshot that opens, answers undefined and the request takes the ordinary
 * path, which wakes the box.
 */

import type { FastifyReply } from "fastify";
import { readHomeSnapshot } from "../../core/chat/routing/home-snapshot.js";
import { bearerMatchesHashes, readHubMeta } from "../../core/hub-meta.js";
import type { QuickChatHome } from "../../core/chat/routing/quick-chat-home.js";
import type { EndpointProvider } from "../endpoints.js";

/** The tRPC envelope the phone decodes, with the `asleep` marker. */
interface AsleepHomeAnswer {
  result: { data: QuickChatHome & { asleep: { savedAt: string } } };
}

interface AsleepHomeRequest {
  mobileAuthed: boolean;
  authorization: string | undefined;
  method: string;
  reqPath: string;
  slug: string | null;
  boxRootBySlug: ReadonlyMap<string, string>;
  secretFor: (slug: string | null) => string;
  endpoints: EndpointProvider;
}

/** Send the snapshot answer when this request gets one; true when it was sent. */
export function sendAsleepHome(reply: FastifyReply, args: AsleepHomeRequest): boolean {
  const answer = asleepHomeAnswer(args);
  if (answer === undefined) return false;
  void reply.status(200).header("cache-control", "no-store").send(answer);
  return true;
}

function sameMembers(published: readonly string[] | undefined, atShutdown: readonly string[]): boolean {
  return published !== undefined && published.length === atShutdown.length && published.every((email, i) => email === atShutdown[i]);
}

function asleepHomeAnswer(args: AsleepHomeRequest): AsleepHomeAnswer | undefined {
  const { slug } = args;
  if (!args.mobileAuthed || slug === null || args.method !== "GET" || args.reqPath !== `/${slug}/api/trpc/quickChat.home`) return undefined;
  const boxRoot = args.boxRootBySlug.get(slug);
  const hubSecret = args.secretFor(slug);
  if (boxRoot === undefined || hubSecret === "" || args.endpoints.get(slug) !== undefined) return undefined;
  const snapshot = readHomeSnapshot(boxRoot, { slug, hubSecret });
  if (snapshot === undefined || !bearerMatchesHashes(args.authorization, snapshot.deviceTokenHashes)) return undefined;
  // A member list changed while the box slept may have dropped this device's pairer; the box decides.
  if (!sameMembers(readHubMeta(boxRoot)?.allowedEmails, snapshot.allowedEmails)) return undefined;
  return { result: { data: { ...snapshot.home, asleep: { savedAt: snapshot.savedAt } } } };
}
