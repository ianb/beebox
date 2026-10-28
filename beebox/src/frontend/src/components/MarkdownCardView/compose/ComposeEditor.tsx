/**
 * Compose mode: a CodeMirror editor over a doc card's composition text, in
 * place of the read view's block (`docs/plans/composition-editor.md`,
 * Track 5). Lazy-loaded from `type-markdown.ts`, so readers who never press
 * Compose do not download CodeMirror. `sync.ts` owns autosave, Save, and
 * merging; this file wires it to the view, the toolbar, and the page.
 * `CardBody` renders this outside the parsed body and passes the block's
 * element as `host`, so the editor survives the block remounting.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { errorMessage } from "@shared/error-guards";
import { normalizeComposition } from "@shared/composition/text";
import { controlAddress } from "@shared/ui-scan/control-address";
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

/** The editor's frame, rendered where the composition block stands; nothing while the block is not mounted. */
function Frame({ host, children }: { host: HTMLElement | null; children: ReactNode }): ReactNode {
  if (host === null) return null;
  return createPortal(<section aria-label="Composition editor" className="bbx-composition my-4 rounded border border-card-rule">{children}</section>, host);
}

interface Session {
  view: EditorView;
  sync: CompositionSync;
}

function createSession({ cardPath, initial, onState, onMalformed, focused }: {
  cardPath: string;
  initial: { text: string; regionHash: string };
  onState: (state: SaveState) => void;
  onMalformed: (malformed: boolean) => void;
  focused: { current: boolean };
}): Session {
  let sync: CompositionSync | null = null;
  const view = new EditorView({
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
        if (update.focusChanged) focused.current = update.view.hasFocus;
        if (!update.docChanged) return;
        onMalformed(isMalformed(update.state));
        if (!update.transactions.some((tr) => tr.annotation(Transaction.remote) === true)) sync?.localChanged();
      }),
    ],
  });
  onMalformed(isMalformed(view.state));
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
    onState,
    initial,
    autosaveMs: AUTOSAVE_MS,
    retryMs: RETRY_MS,
  });
  return { view, sync };
}

/** Puts the session's editor DOM into the frame, and takes it out again without destroying it. */
function Attach({ view, focused }: { view: EditorView; focused: { current: boolean } }): ReactNode {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    slot.current?.append(view.dom);
    // Moved to a remounted block: give back the focus the move took.
    if (focused.current && !view.hasFocus) view.focus();
    return () => view.dom.remove();
  }, [view, focused]);
  return <div ref={slot} className="not-prose" />;
}

function Editor({ cardPath, onClose, host, instance, initial }: ComposeEditorProps & { initial: { text: string; regionHash: string } }): ReactNode {
  const [session, setSession] = useState<Session | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [malformed, setMalformed] = useState(false);
  const focused = useRef(false);

  // The session lives as long as this component, which `CardBody` keeps
  // mounted while composing; the frame around it may move between hosts.
  useEffect(() => {
    const created = createSession({ cardPath, initial, onState: setSaveState, onMalformed: setMalformed, focused });
    setSession(created);
    let ended = false;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (created.sync.hasUnsaved() || (!ended && openConflictCount(created.view.state) > 0)) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      ended = true;
      // A flush that never gets through keeps the leave warning on.
      void created.sync.dispose().then((flushed) => {
        if (flushed) window.removeEventListener("beforeunload", beforeUnload);
      });
      created.view.destroy();
    };
  }, [cardPath, initial]);

  useLiveRefresh({ when: fileChangeAt(cardPath), refresh: () => session?.sync.remoteChanged() });

  const done = async () => {
    if (session === null || await session.sync.close()) onClose();
  };
  const stateText = saveStateText(saveState);
  const alarming = saveState.kind === "not-saved" || saveState.kind === "not-synced" || saveState.kind === "removed";
  return (
    <Frame host={host}>
      <Row gap="sm" align="center" justify="end" wrap className="border-b border-card-rule px-2 py-1 print:hidden">
        <span role="status" aria-live="polite" className="mr-auto">
          <Text as="span" size="xs" tone={alarming ? "danger" : "muted"} material>{stateText}</Text>
        </span>
        <Button id={controlAddress("bbx-composition-save", instance)} size="sm" intent="primary" disabled={saveState.kind === "removed"} onClick={async () => { await session?.sync.save(); }}>Save</Button>
        <Button id={controlAddress("bbx-composition-done", instance)} size="sm" intent="secondary" onClick={done}>Done</Button>
      </Row>
      {malformed ? <ErrorText className="px-4 pt-2">A tag in this composition is malformed, so its marks show as raw text.</ErrorText> : null}
      {session === null ? null : <Attach view={session.view} focused={focused} />}
    </Frame>
  );
}

export function ComposeEditor({ cardPath, onClose, host, instance }: ComposeEditorProps): ReactNode {
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
  if (read === null) return <Frame host={host}><StatusMessage>Loading…</StatusMessage></Frame>;
  if ("text" in read) return <Editor cardPath={cardPath} onClose={onClose} host={host} instance={instance} initial={read} />;
  const message = "error" in read ? `The composition could not be loaded: ${read.error}` : saveStateText({ kind: "removed", problem: read.problem });
  return (
    <Frame host={host}>
      <Row gap="sm" align="center" justify="between" className="px-2 py-1">
        <ErrorText>{message}</ErrorText>
        <Button id={controlAddress("bbx-composition-done", instance)} size="sm" intent="secondary" onClick={onClose}>Done</Button>
      </Row>
    </Frame>
  );
}
