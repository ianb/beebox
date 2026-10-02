/**
 * The boxholder's close mark for the CURRENT chat, as a session-menu item.
 * Extracted from `SessionChip.tsx` for its line budget.
 */

import { useEffect, useState } from "react";
import { MenuItem } from "../../../ui/dropdown-menu-item";
import { useDropdownClose } from "../../../ui/Dropdown";
import { getChatSessionIdentity, markChatDone } from "../../../../api-chat";

/**
 * The boxholder's close mark: "Mark done" / "Mark active" for the CURRENT
 * chat. Done is a state, not a deletion — the chat stays resumable and only
 * sorts below live ones — so this lives beside "New chat", not in Advanced.
 *
 * Loads its own done mark on mount (the dropdown content exists only while
 * open, so the fetch runs per open, not per keystroke anywhere). A load or
 * mutate failure says so in the console and renders nothing rather than a
 * wrong-way toggle.
 */
export function MarkDoneItem({ sessionId }: { sessionId: string | null }) {
  const close = useDropdownClose();
  // null until loaded, and stays null for a chat with no card (nothing to mark).
  const [done, setDone] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (sessionId === null) return;
    let active = true;
    getChatSessionIdentity(sessionId)
      .then((identity) => { if (active) setDone(identity.done); })
      .catch((e) => { console.error("Could not read this chat's done mark:", e); });
    return () => { active = false; };
  }, [sessionId]);

  if (sessionId === null || done === null) return null;

  return (
    <MenuItem
      id="bbx-session-done"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        markChatDone(sessionId, !done)
          .then(() => close())
          .catch((e) => {
            console.error("Could not change this chat's done mark:", e);
            setBusy(false);
          });
      }}
    >
      {done ? "Mark active" : "Mark done"}
    </MenuItem>
  );
}

