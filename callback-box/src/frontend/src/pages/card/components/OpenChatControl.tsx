/**
 * "Chat about this card" control for the full-page card viewer.
 *
 * Resolves the nearest enclosing landmark directory server-side (`chat.openForCard`)
 * and navigates into the existing chat layout with this card attached as the
 * companion document (`?card=`). Two affordances:
 *
 *  - **Chat** — opens the most-recent session bound to that directory, or a new
 *    one if none exists yet.
 *  - **New** — always starts a fresh session bound to the same directory.
 *
 * Mirrors the switch menu's resume-or-start action (`useOpenLandmarkChat`) but
 * adds the card-path resolver, the attached card, the "new" affordance, and —
 * unlike that precedent — a visible error state when the resolve/navigate
 * fails.
 */

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { href, toSearch } from "../../../lib/routing";
import { trpc } from "../../../lib/trpc";
import { Button } from "../../../components/ui/Button";
import { Row } from "../../../components/ui/Row";
import { Text } from "../../../components/ui/Text";

export function OpenChatControl({ boxSlug, cardPath }: { boxSlug: string; cardPath: string }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [error, setError] = useState<string | null>(null);

  const open = async (mode: "recent" | "new") => {
    setError(null);
    try {
      const { contextDir, sessionId } = await utils.chat.openForCard.fetch({ cardPath });
      // A bare card path *is* its own serialized view URL (serializeViewUrl of a
      // path with no viewer/zoom/params returns the path), so it's a valid
      // `?card=` value as-is.
      const card = cardPath;
      // navigate()'s promise only rejects on a superseded/redirected
      // navigation (not a user-facing failure) -- fire-and-forget.
      if (mode === "recent" && sessionId) {
        void navigate({ to: href(`/${boxSlug}/chat`), search: toSearch({ session: sessionId, card }) });
        return;
      }
      void navigate({
        to: href(`/${boxSlug}/chat`),
        search: toSearch({ session: "new", contextDir, card }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open chat");
    }
  };

  return (
    <Row gap="sm" align="center">
      <Button intent="secondary" size="sm" onClick={() => open("recent")}>
        Chat
      </Button>
      <Button intent="ghost" size="sm" onClick={() => open("new")}>
        New
      </Button>
      {error !== null ? <Text as="span" size="xs" tone="danger">{error}</Text> : null}
    </Row>
  );
}
