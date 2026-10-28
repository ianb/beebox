/**
 * The read view of a doc card's composition (`docs/plans/composition-editor.md`,
 * Track 3): `CompositionBlock` frames the piece with Copy and Compose, and
 * `EditorialInline` / `EditorialBlock` show the agent's marks inside it.
 *
 * The block copies the composition's source text, not its rendered children,
 * so it reads the card body from `CompositionCardContext`, which `CardBody`
 * provides. With no single region in the body (two compositions, an unclosed
 * tag) it shows neither button; `bbx validate` warns on the card.
 *
 * Compose mode belongs to `CardBody` (`useComposeSession`), not to the block:
 * Markdoc renders the body's blocks without keys, so text added above the
 * composition remounts the block. The editor (its CodeMirror view, undo
 * history, and pending write) lives above the parsed tree and renders into
 * a host element the block provides while composing.
 */

import { createContext, useCallback, useContext, useId, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { controlAddress } from "@shared/ui-scan/control-address";
import { findComposition } from "@shared/composition/region";
import { EDITORIAL_KINDS } from "@shared/composition/tags";
import { compositionPlainText } from "@shared/composition/text";
import { Button } from "../ui/Button";
import { VisuallyHidden } from "../ui/VisuallyHidden";

/** What the composition editor (Track 5) gets. It reads the region itself and renders into `host`. */
export interface ComposeEditorProps {
  cardPath: string;
  onClose: () => void;
  /** Where the block stands while composing; null while the block is (re)mounting or gone. */
  host: HTMLElement | null;
  /** Encoded per-card-view key for control ids (`controlAddress`). */
  instance: string;
}

export interface CompositionCard {
  /** The card's whole body, as on disk. */
  body: string;
  cardPath: string;
  /** Shown in place of the block in compose mode; without one there is no Compose button. A module constant. */
  composeEditor: ComponentType<ComposeEditorProps> | null;
  composing: boolean;
  startCompose: () => void;
  /** Ref callback for the element the editor renders into. */
  composeHost: (element: HTMLElement | null) => void;
  instance: string;
}

/**
 * The compose session for one card view: whether it is composing, the host
 * element the block registers, and the editor element, which the caller
 * renders outside the Markdown tree so a remounted block does not end it.
 * When the body has no single region while composing (the agent removed or
 * broke it), `fallback` is a host for the top of the body, so the editor
 * still shows why it stopped, with Done.
 */
export function useComposeSession({ body, cardPath, composeEditor }: {
  body: string;
  cardPath: string;
  composeEditor: CompositionCard["composeEditor"];
}): {
  session: Pick<CompositionCard, "composing" | "startCompose" | "composeHost" | "instance">;
  editor: ReactNode;
  fallback: ReactNode;
} {
  const instance = useId();
  const [composing, setComposing] = useState(false);
  const [blockHost, setBlockHost] = useState<HTMLElement | null>(null);
  const [fallbackHost, setFallbackHost] = useState<HTMLElement | null>(null);
  const startCompose = useCallback(() => setComposing(true), []);
  const session = useMemo(() => ({ composing, startCompose, composeHost: setBlockHost, instance }), [composing, startCompose, instance]);
  const hasRegion = useMemo(() => !("problem" in findComposition(body)), [body]);
  const Editor = composeEditor;
  const active = composing && Editor !== null;
  const host = hasRegion ? blockHost : fallbackHost;
  return {
    session,
    editor: active ? <Editor cardPath={cardPath} host={host} instance={instance} onClose={() => setComposing(false)} /> : null,
    fallback: active && !hasRegion ? <ComposeHost register={setFallbackHost} /> : null,
  };
}

export const CompositionCardContext = createContext<CompositionCard | null>(null);

function copyLabel(openMarks: number): string {
  if (openMarks === 0) return "Copy";
  return `Copy (${String(openMarks)} open mark${openMarks === 1 ? "" : "s"})`;
}

/** The element the compose editor renders into (`useComposeSession`). */
function ComposeHost({ register }: { register: (element: HTMLElement | null) => void }): ReactNode {
  return <div ref={register} />;
}

export function CompositionBlock({ children }: { children?: ReactNode }): ReactNode {
  const card = useContext(CompositionCardContext);
  const plain = useMemo(() => {
    if (card === null) return null;
    const region = findComposition(card.body);
    return "problem" in region ? null : compositionPlainText(region.text);
  }, [card]);
  const canCompose = card !== null && card.composeEditor !== null;
  if (canCompose && card.composing && plain !== null) return <ComposeHost register={card.composeHost} />;
  const handleCompose = () => card?.startCompose();
  return (
    <section aria-label="Composition" className="bbx-composition my-4 rounded border border-card-rule">
      {plain === null || card === null ? null : (
        <div className="flex justify-end gap-2 border-b border-card-rule px-2 py-1 print:hidden">
          <Button id={controlAddress("bbx-composition-copy", card.instance)} size="sm" intent="secondary" flash={{ label: "Copied" }} aria-live="polite" onClick={() => navigator.clipboard.writeText(plain.text)}>
            {copyLabel(plain.openMarks)}
          </Button>
          {canCompose ? (
            <Button id={controlAddress("bbx-composition-compose", card.instance)} size="sm" intent="secondary" onClick={handleCompose}>Compose</Button>
          ) : null}
        </div>
      )}
      <div className="px-4">{children}</div>
    </section>
  );
}

const KNOWN_KINDS: ReadonlySet<string> = new Set(EDITORIAL_KINDS);

const CHIP = "rounded bg-card-tint text-card-ink";
const LABEL = "mr-1 text-xs font-medium text-card-soft";
const KIND_CLASSES: Record<string, string> = {
  joiner: "underline decoration-dotted decoration-card-soft underline-offset-4",
  gap: CHIP,
  note: CHIP,
  check: "underline decoration-wavy decoration-card-pen underline-offset-4",
};
const UNKNOWN = "rounded border border-dashed border-card-danger text-card-danger";

interface EditorialProps {
  kind?: string;
  note?: string;
  children?: ReactNode;
}

function Editorial({ kind: givenKind, note, children, block }: EditorialProps & { block: boolean }): ReactNode {
  const kind = givenKind ?? "";
  const noteId = useId();
  const Tag = block ? "div" : "span";
  const pad = block ? "my-2 block px-3 py-1" : "px-1";
  if (!KNOWN_KINDS.has(kind)) {
    return <Tag data-editorial={kind} className={`${UNKNOWN} ${pad}`}><span className={LABEL}>unknown mark: {kind}</span>{children}</Tag>;
  }
  const kindClass = KIND_CLASSES[kind] ?? "";
  if (kind === "gap" || kind === "note") {
    return <Tag data-editorial={kind} className={`${kindClass} ${pad}`}><span className={LABEL}>{kind}:</span>{children}</Tag>;
  }
  if (kind === "check") {
    const hasNote = note !== undefined && note !== "";
    return (
      <Tag data-editorial={kind} className={kindClass} title={note} aria-describedby={hasNote ? noteId : undefined}>
        {children}
        {hasNote ? <span id={noteId} hidden>{note}</span> : null}
      </Tag>
    );
  }
  return <Tag data-editorial={kind} className={kindClass} title="agent's words"><VisuallyHidden>agent's words: </VisuallyHidden>{children}</Tag>;
}

export function EditorialInline(props: EditorialProps): ReactNode {
  return <Editorial {...props} block={false} />;
}

export function EditorialBlock(props: EditorialProps): ReactNode {
  return <Editorial {...props} block />;
}
