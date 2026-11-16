/**
 * Copy on a composition's read view (`plan:composition-copy-and-accept-all`,
 * Track 4). Copy gives the publishing copy: the agent's words as plain text.
 * An open gap, note, or check blocks it, and Copy then lists what is left,
 * each with its way through. Nothing here accepts the agent's words: that
 * stays a separate act in the editor (boxholder decision, 2026-11-16, so
 * publishing never pushes a person to pass the agent's words off as theirs).
 * "More copy options" holds the labelled draft copy in every state.
 */
import { useMemo, useState, type ReactNode } from "react";
import { controlAddress } from "@shared/ui-scan/control-address";
import { draftCopy, publishingCopy, type BlockerKind, type OpenMark } from "@shared/composition/marks/copy";
import type { ResolveRequest } from "@shared/composition/marks/resolve";
import { errorMessage } from "@shared/error-guards";
import { trpcClient } from "../../lib/trpc/client";
import { Button } from "../ui/Button";
import { ErrorText } from "../ui/ErrorText";
import { Menu } from "../ui/Menu";
import { MenuItem } from "../ui/menu-item";
import { Popover } from "../ui/Popover";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { toastError } from "../ui/toast-store";

/** An open mark the editor should select when it opens. */
export type MarkTarget = Pick<OpenMark, "index" | "kind">;

type Blocker = OpenMark & { kind: BlockerKind };

const CHANGED = "The composition just changed. Look again.";

type ResolveResult = Awaited<ReturnType<typeof trpcClient.card.resolveComposition.mutate>>;

/** What the person reads after a resolve action; `null` when it worked and the list updates itself. */
export function resultMessage(result: ResolveResult): string | null {
  switch (result.status) {
    case "resolved": return result.commitWarning;
    case "conflict": return result.committedEdits === null ? CHANGED : "Your edits were committed; nothing else changed. Look again.";
    case "problem": return CHANGED;
    case "nothing": return "There is nothing left of that kind.";
    case "refused": return "That could not be changed here. Use Go to it and edit it.";
    case "commit-failed": return "Committing your edits failed, so nothing was changed.";
  }
}

async function runResolve({ cardPath, regionText, request }: { cardPath: string; regionText: string; request: ResolveRequest }): Promise<string | null> {
  const read = await trpcClient.card.readComposition.query({ path: cardPath });
  // The person decided on the text on screen; a newer text on disk is a different decision.
  if (!("text" in read) || read.text !== regionText) return CHANGED;
  return resultMessage(await trpcClient.card.resolveComposition.mutate({ path: cardPath, baseRegionHash: read.regionHash, request }));
}

function describe(blocker: Blocker): string {
  const words = blocker.words === "" ? "(no words yet)" : `“${blocker.words}”`;
  switch (blocker.kind) {
    case "gap": return `A gap: ${words}. Write it, or remove the gap.`;
    case "note": return `A note from the agent: ${words}`;
    case "check": return `The agent asked about ${words}${blocker.note === null ? "" : `: ${blocker.note}`}`;
  }
}

function rowAction(blocker: Blocker): { label: string; request: ResolveRequest } | null {
  switch (blocker.kind) {
    case "gap": return null;
    case "note": return { label: "Remove note", request: { action: "remove-note", index: blocker.index } };
    case "check": return { label: "Keep as written", request: { action: "keep-check", index: blocker.index } };
  }
}

interface ResolveListProps {
  blockers: Blocker[];
  cardPath: string;
  regionText: string;
  instance: string;
  /** `null` when there is no editor to go to. */
  onGoTo: ((target: MarkTarget) => void) | null;
  onDraft: () => Promise<void>;
}

function ResolveList({ blockers, cardPath, regionText, instance, onGoTo, onDraft }: ResolveListProps): ReactNode {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const run = async (request: ResolveRequest) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await runResolve({ cardPath, regionText, request }));
    } catch (error) {
      console.error(`Composition: resolving ${request.action} in ${cardPath} failed:`, error);
      setMessage(`That did not work: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };
  const count = (kind: BlockerKind) => blockers.filter((b) => b.kind === kind).length;
  return (
    // The panel sits inside the card's prose: keep its paragraph margins out.
    <Stack gap="sm" className="not-prose">
      <Text as="p" size="sm" weight="semibold">{`Before you publish: ${String(blockers.length)} ${blockers.length === 1 ? "thing" : "things"} to resolve`}</Text>
      {blockers.map((blocker) => {
        const action = rowAction(blocker);
        return (
          <Stack key={blocker.index} gap="xs">
            <Text as="p" size="sm">{describe(blocker)}</Text>
            <Row gap="sm" wrap>
              {action === null ? null : (
                <Button id={controlAddress(`bbx-composition-resolve-${String(blocker.index)}`, instance)} label={`${action.label}: ${blocker.words}`} size="sm" intent="secondary" disabled={busy} onClick={() => run(action.request)}>{action.label}</Button>
              )}
              {onGoTo === null ? null : (
                <Button id={controlAddress(`bbx-composition-goto-${String(blocker.index)}`, instance)} label={`Go to it: ${blocker.words}`} size="sm" intent="secondary" disabled={busy} onClick={() => onGoTo({ index: blocker.index, kind: blocker.kind })}>Go to it</Button>
              )}
            </Row>
          </Stack>
        );
      })}
      {count("note") > 1 || count("check") > 1 ? (
        <Row gap="sm" wrap>
          {count("note") > 1 ? <Button id={controlAddress("bbx-composition-remove-notes", instance)} label="Remove all notes" size="sm" intent="secondary" disabled={busy} onClick={() => run({ action: "remove-notes" })}>Remove all notes</Button> : null}
          {count("check") > 1 ? <Button id={controlAddress("bbx-composition-keep-checks", instance)} label="Keep all checked words as written" size="sm" intent="secondary" disabled={busy} onClick={() => run({ action: "keep-checks" })}>Keep all checked words</Button> : null}
        </Row>
      ) : null}
      {message === null ? null : <ErrorText>{message}</ErrorText>}
      <Button id={controlAddress("bbx-composition-copy-draft-from-list", instance)} label="Copy the draft with its marks labelled" size="sm" intent="secondary" className="self-start" flash={{ label: "Copied", failLabel: "Copy failed" }} onClick={onDraft}>Copy draft with marks</Button>
    </Stack>
  );
}

export interface CompositionCopyProps {
  cardPath: string;
  /** The region's text as on disk. */
  regionText: string;
  instance: string;
  /** Open the editor with this mark selected; `null` when there is no editor. */
  onGoTo: ((target: MarkTarget) => void) | null;
}

export function CompositionCopy({ cardPath, regionText, instance, onGoTo }: CompositionCopyProps): ReactNode {
  const copy = useMemo(() => publishingCopy(regionText), [regionText]);
  const onDraft = () => navigator.clipboard.writeText(draftCopy(regionText));
  if (copy.status === "malformed") {
    return <Text as="span" size="xs" tone="danger" material>A tag in this composition is broken. Edit it to fix the tag.</Text>;
  }
  const copyId = controlAddress("bbx-composition-copy", instance);
  return (
    <>
      {copy.status === "ready" ? (
        <Button id={copyId} label="Copy composition" size="sm" intent="secondary" flash={{ label: "Copied", failLabel: "Copy failed" }} onClick={() => navigator.clipboard.writeText(copy.text)}>Copy</Button>
      ) : (
        <Popover
          label="Before you publish"
          align="right"
          width="lg"
          trigger={({ toggle, ariaProps }) => (
            <Button id={copyId} label={`Copy composition: ${String(copy.blockers.length)} to resolve first`} size="sm" intent="secondary" onClick={toggle} {...ariaProps}>Copy</Button>
          )}
        >
          {(close) => (
            <ResolveList
              blockers={copy.blockers}
              cardPath={cardPath}
              regionText={regionText}
              instance={instance}
              onDraft={onDraft}
              onGoTo={onGoTo === null ? null : (target) => {
                close();
                onGoTo(target);
              }}
            />
          )}
        </Popover>
      )}
      <Menu
        align="right"
        trigger={({ toggle, ariaProps }) => (
          <Button id={controlAddress("bbx-composition-copy-more", instance)} label="More copy options" size="sm" intent="secondary" onClick={toggle} {...ariaProps}>▾</Button>
        )}
      >
        <MenuItem
          id={controlAddress("bbx-composition-copy-draft", instance)}
          onClick={() => onDraft().catch((error: unknown) => {
            console.error("Composition: copying the draft failed:", error);
            toastError("Copying the draft failed", { cause: errorMessage(error) });
          })}
          title="Every open mark labelled, for another reader">Copy draft with marks</MenuItem>
      </Menu>
    </>
  );
}
