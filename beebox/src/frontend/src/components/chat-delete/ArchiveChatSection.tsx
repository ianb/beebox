/**
 * The archive half of the chat confirmation surface.
 *
 * Archiving sits beside deleting because it is the same decision made
 * differently — the boxholder is looking at a chat they no longer want in
 * their lists — but it removes nothing: the card moves to
 * `_content/chat/archive/`, which is enough to take it out of every list and out
 * of the review corpus (`docs/implemented-plans/chat-session-identity.md`, Track 3).
 *
 * Offered only for a chat whose transcript is gone. Archiving a live chat
 * would hide a conversation that can still be opened, so the state is read
 * here rather than trusted from the caller — every surface that shows this
 * dialog would otherwise have to thread it through correctly.
 */

import { trpc } from "../../lib/trpc";
import { Button } from "../ui/Button";

export function ArchiveChatSection({ sessionId, huskPath, busy, onArchived }: {
  sessionId: string;
  huskPath: string | undefined;
  busy: boolean;
  onArchived: () => void;
}) {
  const utils = trpc.useUtils();
  const availability = trpc.chat.sessionAvailability.useQuery({ sessionId });
  const mutation = trpc.chat.archive.useMutation();
  if (availability.data === undefined) return null;
  const dead = availability.data.kind === "unavailable" && availability.data.reason === "missing-local-transcript";

  const archive = async (): Promise<void> => {
    const result = await mutation.mutateAsync({ sessionId });
    await Promise.all([
      utils.chat.sessions.invalidate(),
      utils.chat.byLandmark.invalidate(),
      utils.chat.placeMenu.invalidate(),
      utils.chat.sessionAvailability.invalidate({ sessionId }),
      ...(huskPath === undefined ? [] : [utils.card.get.invalidate({ path: huskPath })]),
    ]);
    if (result.status === "archived" || result.status === "already-archived") onArchived();
  };

  return (
    <section className="mt-4 border-t border-subtle pt-4 text-sm text-warm-700">
      <h3 className="font-semibold text-warm-900">Archive instead</h3>
      <p className="mt-1">
        {dead
          ? "Moves this chat’s card to _content/chat/archive/; nothing is deleted."
          : "This conversation can still be opened, so there is nothing to archive yet."}
      </p>
      {mutation.error ? (
        <p className="mt-2 rounded border border-danger-light bg-danger-50 p-2 text-danger-dark" role="alert">
          {mutation.error.message}
        </p>
      ) : null}
      <Button
        id="bbx-chat-archive"
        className="mt-3"
        intent="secondary"
        disabled={!dead || busy}
        loading={mutation.isPending}
        loadingLabel="Archiving…"
        onClick={archive}
      >
        Archive conversation
      </Button>
    </section>
  );
}
