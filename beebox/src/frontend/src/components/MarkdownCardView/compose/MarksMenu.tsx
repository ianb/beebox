/**
 * The editor bar's "N marked" menu (`plan:composition-copy-and-accept-all`,
 * Track 5): every open mark in text order, each a jump, then the resolve
 * actions for the kinds present, ending with Accept all agent words. That
 * one warns and asks first, since it changes whose words they read as
 * (boxholder: "Warnings on that button are okay"). Each action writes the
 * text on screen, then commits it and the resolve separately on the server.
 */
import { useState, type ReactNode } from "react";
import { controlAddress } from "@shared/ui-scan/control-address";
import { errorMessage } from "@shared/error-guards";
import { trpcClient } from "../../../lib/trpc/client";
import { Button } from "../../ui/Button";
import { Menu } from "../../ui/Menu";
import { MenuItem } from "../../ui/menu-item";
import { Text } from "../../ui/Text";
import { resultMessage } from "../CompositionCopy";
import { openConflictCount } from "./conflicts";
import type { CompositionSync } from "./sync";
import { openMarkRanges, selectOpenMark, type OpenMarkRange } from "./widgets";
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

type BulkAction = "accept-joiners" | "keep-checks" | "remove-notes";

const ACTION_KIND: Record<BulkAction, OpenMarkRange["kind"]> = { "accept-joiners": "joiner", "keep-checks": "check", "remove-notes": "note" };

const CONFLICT_OPEN = "Choose a version for each conflict first; then try again.";
const MARKS_CHANGED = "The marks changed while you were choosing. Look again.";

/** The words of the open marks of one kind, in order: what the person is acting on. */
function wordsOf(marks: readonly OpenMarkRange[], kind: OpenMarkRange["kind"]): string[] {
  return marks.filter((mark) => mark.kind === kind).map((mark) => mark.words);
}

export function MarksMenu({ view, sync, marks, cardPath, instance, onMessage }: MarksMenuProps): ReactNode {
  // The agent words the confirm named when it opened; `null` while it is closed.
  const [confirming, setConfirming] = useState<string[] | null>(null);
  if (marks.length === 0) return null;
  const count = (kind: OpenMarkRange["kind"]) => marks.filter((mark) => mark.kind === kind).length;
  const joiners = count("joiner");
  /**
   * Run a bulk action on the marks the person saw (`seen`). An open merge
   * conflict is a choice not yet made, so it stops the action, as do marks
   * that changed meanwhile; both are checked again after the flush, since
   * the flush can merge the agent's newest text in.
   */
  const run = async (action: BulkAction, seen: string[]) => {
    const kind = ACTION_KIND[action];
    const stale = (): string | null => {
      if (openConflictCount(view.state) > 0) return CONFLICT_OPEN;
      const now = wordsOf(openMarkRanges(view.state), kind);
      return now.length === seen.length && now.every((words, i) => words === seen[i]) ? null : MARKS_CHANGED;
    };
    const before = stale();
    if (before !== null) {
      onMessage(before);
      return;
    }
    onMessage(null);
    try {
      // `afterFlush` gives `null` for a failed write, so the step's own message (often `null`) travels wrapped.
      const result = await sync.afterFlush(async (regionHash) => {
        const after = stale();
        if (after !== null) return { message: after };
        return { message: resultMessage(await trpcClient.card.resolveComposition.mutate({ path: cardPath, baseRegionHash: regionHash, request: { action } })) };
      });
      onMessage(result === null ? "Your text is not saved, so nothing was changed." : result.message);
      // Take the change in now; the file-change notice would bring it too.
      sync.remoteChanged();
    } catch (error) {
      console.error(`Composition: ${action} in ${cardPath} failed:`, error);
      onMessage(`That did not work: ${errorMessage(error)}`);
    }
  };
  return (
    <Menu
      align="right"
      width="w-80 max-w-[calc(100vw-2rem)]"
      onClose={() => setConfirming(null)}
      trigger={({ toggle, ariaProps }) => (
        <Button id={controlAddress("bbx-composition-marks", instance)} label={`${String(marks.length)} marked: list the marks`} size="sm" intent="secondary" onClick={toggle} {...ariaProps}>
          {`${String(marks.length)} marked`}
        </Button>
      )}
    >
      {confirming === null ? (
        <>
          {marks.map((mark) => (
            <MenuItem key={mark.index} id={controlAddress(`bbx-composition-mark-${String(mark.index)}`, instance)} title={mark.words} onClick={() => { selectOpenMark(view, mark); }}>
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 whitespace-nowrap text-xs font-medium text-card-soft">{KIND_LABELS[mark.kind]}</span>
                <span className="truncate">{snippet(mark.words)}</span>
              </span>
            </MenuItem>
          ))}
          {count("check") > 0 ? <MenuItem id={controlAddress("bbx-composition-marks-keep-checks", instance)} onClick={() => run("keep-checks", wordsOf(marks, "check"))}>Keep all checked words</MenuItem> : null}
          {count("note") > 0 ? <MenuItem id={controlAddress("bbx-composition-marks-remove-notes", instance)} onClick={() => run("remove-notes", wordsOf(marks, "note"))}>Remove all notes</MenuItem> : null}
          {joiners > 0 ? (
            <MenuItem id={controlAddress("bbx-composition-accept-all", instance)} keepOpen title="Asks first: the agent's words will be marked as yours" onClick={() => setConfirming(wordsOf(marks, "joiner"))}>Accept all agent words…</MenuItem>
          ) : null}
        </>
      ) : (
        <>
          <Text as="p" size="sm" className="px-3 py-2">
            {`The agent's ${String(confirming.length)} ${confirming.length === 1 ? "passage" : "passages"} will be marked as yours from now on. A new commit records it; earlier versions keep the marks.`}
          </Text>
          <MenuItem id={controlAddress("bbx-composition-accept-all-confirm", instance)} onClick={() => run("accept-joiners", confirming)}>Yes, accept all agent words</MenuItem>
          <MenuItem keepOpen onClick={() => setConfirming(null)}>Cancel</MenuItem>
        </>
      )}
    </Menu>
  );
}
