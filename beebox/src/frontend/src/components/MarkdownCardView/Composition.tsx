/**
 * The read view of a doc card's composition (`docs/plans/composition-editor.md`,
 * Track 3): `CompositionBlock` frames the piece with Copy and Compose, and
 * `EditorialInline` / `EditorialBlock` show the agent's marks inside it.
 *
 * The block copies the composition's source text, not its rendered children,
 * so it reads the card body from `CompositionCardContext`, which `CardBody`
 * provides. With no single region in the body (two compositions, an unclosed
 * tag) it shows neither button; `bbx validate` warns on the card.
 */

import { createContext, useContext, useId, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { findComposition } from "@shared/composition/region";
import { EDITORIAL_KINDS } from "@shared/composition/tags";
import { compositionPlainText } from "@shared/composition/text";
import { Button } from "../ui/Button";
import { VisuallyHidden } from "../ui/VisuallyHidden";

/** What the composition editor (Track 5) gets when it replaces the block. It reads the region itself. */
export interface ComposeEditorProps {
  cardPath: string;
  onClose: () => void;
}

export interface CompositionCard {
  /** The card's whole body, as on disk. */
  body: string;
  cardPath: string;
  /** Shown in place of the block in compose mode; without one there is no Compose button. A module constant. */
  composeEditor: ComponentType<ComposeEditorProps> | null;
}

export const CompositionCardContext = createContext<CompositionCard | null>(null);

function copyLabel(openMarks: number): string {
  if (openMarks === 0) return "Copy";
  return `Copy (${String(openMarks)} open mark${openMarks === 1 ? "" : "s"})`;
}

export function CompositionBlock({ children }: { children?: ReactNode }): ReactNode {
  const card = useContext(CompositionCardContext);
  const [composing, setComposing] = useState(false);
  const plain = useMemo(() => {
    if (card === null) return null;
    const region = findComposition(card.body);
    return "problem" in region ? null : compositionPlainText(region.text);
  }, [card]);
  const Editor = card?.composeEditor ?? null;
  if (composing && card !== null && Editor !== null) {
    return <Editor cardPath={card.cardPath} onClose={() => setComposing(false)} />;
  }
  return (
    <section aria-label="Composition" className="bbx-composition my-4 rounded border border-card-rule">
      {plain === null ? null : (
        <div className="flex justify-end gap-2 border-b border-card-rule px-2 py-1 print:hidden">
          <Button size="sm" intent="secondary" flash={{ label: "Copied" }} aria-live="polite" onClick={() => navigator.clipboard.writeText(plain.text)}>
            {copyLabel(plain.openMarks)}
          </Button>
          {Editor === null ? null : (
            <Button size="sm" intent="secondary" onClick={() => setComposing(true)}>Compose</Button>
          )}
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
