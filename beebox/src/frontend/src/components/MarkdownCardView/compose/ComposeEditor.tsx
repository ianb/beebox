/**
 * Compose mode: a CodeMirror editor over a doc card's composition text, in
 * place of the read view's block (`docs/plans/composition-editor.md`,
 * Track 5). Lazy-loaded from `type-markdown.ts`, so readers who never press
 * Compose do not download CodeMirror. `sync.ts` owns autosave, Save, and
 * merging; this file wires it to the view, the toolbar, and the page.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { errorMessage } from "@shared/error-guards";
import { normalizeComposition } from "@shared/composition/text";
import { trpcClient } from "../../../lib/trpc/client";
import { fileChangeAt } from "../../../lib/live-refresh";
import { useLiveRefresh } from "../../../hooks/useLiveRefresh";
import { Button } from "../../ui/Button";
import { ErrorText } from "../../ui/ErrorText";
import { Row } from "../../ui/Row";
import { StatusMessage } from "../../ui/StatusMessage";
import { Text } from "../../ui/Text";
import type { ComposeEditorProps } from "../Composition";
import { addConflicts, conflictWidgets, openConflictCount } from "./conflicts";
import { CompositionSync, saveStateText, type ReadResult, type SaveState, type Schedule } from "./sync";
import { isMalformed, markWidgets } from "./widgets";

const AUTOSAVE_MS = 800;
const RETRY_MS = 3000;

const schedule: Schedule = (fn, ms) => {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
};

const theme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "inherit", fontSize: "inherit" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "inherit" },
  ".cm-content": { padding: "0.75rem 1rem", caretColor: "currentColor" },
});

function Frame({ children }: { children: ReactNode }): ReactNode {
  return <section aria-label="Composition editor" className="bbx-composition my-4 rounded border border-card-rule">{children}</section>;
}

function Editor({ cardPath, onClose, initial }: ComposeEditorProps & { initial: { text: string; regionHash: string } }): ReactNode {
  const host = useRef<HTMLDivElement>(null);
  const syncRef = useRef<CompositionSync | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [malformed, setMalformed] = useState(false);

  useEffect(() => {
    const parent = host.current;
    if (parent === null) return;
    let sync: CompositionSync | null = null;
    const view = new EditorView({
      parent,
      doc: normalizeComposition(initial.text),
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": "Composition text" }),
        markWidgets(),
        conflictWidgets(),
        theme,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          setMalformed(isMalformed(update.state));
          if (!update.transactions.some((tr) => tr.annotation(Transaction.remote) === true)) sync?.localChanged();
        }),
      ],
    });
    setMalformed(isMalformed(view.state));
    sync = new CompositionSync({
      client: {
        read: () => trpcClient.card.readComposition.query({ path: cardPath }),
        write: (input) => trpcClient.card.writeComposition.mutate({ path: cardPath, ...input }),
      },
      editor: {
        text: () => view.state.doc.toString(),
        applyRemote: ({ changes, conflicts }) => view.dispatch({
          changes,
          effects: conflicts.length > 0 ? addConflicts.of(conflicts) : [],
          annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)],
        }),
      },
      schedule,
      onState: setSaveState,
      initial,
      autosaveMs: AUTOSAVE_MS,
      retryMs: RETRY_MS,
    });
    const current = sync;
    syncRef.current = current;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (current.hasUnsaved() || openConflictCount(view.state) > 0) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      current.dispose();
      syncRef.current = null;
      view.destroy();
    };
  }, [cardPath, initial]);

  useLiveRefresh({ when: fileChangeAt(cardPath), refresh: () => syncRef.current?.remoteChanged() });

  const done = async () => {
    const sync = syncRef.current;
    if (sync === null || await sync.close()) onClose();
  };
  const stateText = saveStateText(saveState);
  return (
    <Frame>
      <Row gap="sm" align="center" justify="end" wrap className="border-b border-card-rule px-2 py-1 print:hidden">
        <span role="status" aria-live="polite" className="mr-auto">
          <Text as="span" size="xs" tone={saveState.kind === "not-saved" || saveState.kind === "removed" ? "danger" : "muted"} material>{stateText}</Text>
        </span>
        <Button id="bbx-compose-save" size="sm" intent="primary" disabled={saveState.kind === "removed"} onClick={async () => { await syncRef.current?.save(); }}>Save</Button>
        <Button id="bbx-compose-done" size="sm" intent="secondary" onClick={done}>Done</Button>
      </Row>
      {malformed ? <ErrorText className="px-4 pt-2">A tag in this composition is malformed, so its marks show as raw text.</ErrorText> : null}
      <div ref={host} className="not-prose" />
    </Frame>
  );
}

export function ComposeEditor({ cardPath, onClose }: ComposeEditorProps): ReactNode {
  const [read, setRead] = useState<ReadResult | { error: string } | null>(null);
  useEffect(() => {
    let live = true;
    trpcClient.card.readComposition.query({ path: cardPath }).then(
      (result) => { if (live) setRead(result); },
      (e: unknown) => { if (live) setRead({ error: errorMessage(e) }); },
    );
    return () => {
      live = false;
    };
  }, [cardPath]);
  if (read === null) return <Frame><StatusMessage>Loading…</StatusMessage></Frame>;
  if ("text" in read) return <Editor cardPath={cardPath} onClose={onClose} initial={read} />;
  const message = "error" in read ? `The composition could not be loaded: ${read.error}` : saveStateText({ kind: "removed", problem: read.problem });
  return (
    <Frame>
      <Row gap="sm" align="center" justify="between" className="px-2 py-1">
        <ErrorText>{message}</ErrorText>
        <Button id="bbx-compose-done" size="sm" intent="secondary" onClick={onClose}>Done</Button>
      </Row>
    </Frame>
  );
}
