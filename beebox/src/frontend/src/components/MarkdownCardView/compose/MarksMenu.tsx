/**
 * The editor bar's "N marked" menu (`plan:composition-copy-and-accept-all`,
 * Track 5): every open mark in text order, each a jump, then the resolve
 * actions for the kinds present. Accept all agent words warns and asks once
 * first, since it changes who the words read as written by (boxholder:
 * "Warnings on that button are okay"). Each action writes the text on
 * screen, then commits it and the resolve separately on the server.
 */
import { useState, type ReactNode } from "react";
import { controlAddress } from "@shared/ui-scan/control-address";
import type { ResolveRequest } from "@shared/composition/marks/resolve";
import { errorMessage } from "@shared/error-guards";
import { trpcClient } from "../../../lib/trpc/client";
import { Button } from "../../ui/Button";
import { Menu } from "../../ui/Menu";
import { MenuItem } from "../../ui/menu-item";
import { Text } from "../../ui/Text";
import { resultMessage } from "../CompositionCopy";
import type { CompositionSync } from "./sync";
import { selectOpenMark, type OpenMarkRange } from "./widgets";
import type { EditorView } from "@codemirror/view";

const KIND_LABELS: Record<OpenMarkRange["kind"], string> = { joiner: "Agent words", gap: "Gap", note: "Note", check: "Check" };

function snippet(words: string): string {
  if (words === "") return "(empty)";
  return words.length > 40 ? `${words.slice(0, 39)}…` : words;
}

export interface MarksMenuProps {
  view: EditorView;
  sync: CompositionSync;
  marks: readonly OpenMarkRange[];
  cardPath: string;
  instance: string;
  /** Shows the outcome of a resolve action under the bar; `null` clears it. */
  onMessage: (message: string | null) => void;
}

export function MarksMenu({ view, sync, marks, cardPath, instance, onMessage }: MarksMenuProps): ReactNode {
  const [confirming, setConfirming] = useState(false);
  if (marks.length === 0) return null;
  const count = (kind: OpenMarkRange["kind"]) => marks.filter((mark) => mark.kind === kind).length;
  const joiners = count("joiner");
  const run = async (request: ResolveRequest) => {
    onMessage(null);
    try {
      const result = await sync.afterFlush((regionHash) => trpcClient.card.resolveComposition.mutate({ path: cardPath, baseRegionHash: regionHash, request }));
      onMessage(result === null ? "Your text is not saved, so nothing was changed." : resultMessage(result));
      // Take the change in now; the file-change notice would bring it too.
      sync.remoteChanged();
    } catch (error) {
      console.error(`Composition: ${request.action} in ${cardPath} failed:`, error);
      onMessage(`That did not work: ${errorMessage(error)}`);
    }
  };
  return (
    <Menu
      align="right"
      width="w-80 max-w-[calc(100vw-2rem)]"
      onClose={() => setConfirming(false)}
      trigger={({ toggle, ariaProps }) => (
        <Button id={controlAddress("bbx-composition-marks", instance)} label={`${String(marks.length)} marked: list the marks`} size="sm" intent="secondary" onClick={toggle} {...ariaProps}>
          {`${String(marks.length)} marked`}
        </Button>
      )}
    >
      {confirming ? (
        <>
          <Text as="p" size="sm" className="px-3 py-2">
            {`The agent's ${String(joiners)} ${joiners === 1 ? "passage" : "passages"} will read as yours, here and in the card's history.`}
          </Text>
          <MenuItem id={controlAddress("bbx-composition-accept-all-confirm", instance)} onClick={() => run({ action: "accept-joiners" })}>Yes, accept all agent words</MenuItem>
          <MenuItem keepOpen onClick={() => setConfirming(false)}>Cancel</MenuItem>
        </>
      ) : (
        <>
          {marks.map((mark) => (
            <MenuItem key={mark.index} id={controlAddress(`bbx-composition-mark-${String(mark.index)}`, instance)} title={mark.words} onClick={() => { selectOpenMark(view, mark); }}>
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 whitespace-nowrap text-xs font-medium text-card-soft">{KIND_LABELS[mark.kind]}</span>
                <span className="truncate">{snippet(mark.words)}</span>
              </span>
            </MenuItem>
          ))}
          {joiners > 0 ? (
            <MenuItem id={controlAddress("bbx-composition-accept-all", instance)} keepOpen title="Asks first: the agent's words will read as yours" onClick={() => setConfirming(true)}>Accept all agent words…</MenuItem>
          ) : null}
          {count("check") > 0 ? <MenuItem id={controlAddress("bbx-composition-marks-keep-checks", instance)} onClick={() => run({ action: "keep-checks" })}>Keep all checked words</MenuItem> : null}
          {count("note") > 0 ? <MenuItem id={controlAddress("bbx-composition-marks-remove-notes", instance)} onClick={() => run({ action: "remove-notes" })}>Remove all notes</MenuItem> : null}
        </>
      )}
    </Menu>
  );
}
