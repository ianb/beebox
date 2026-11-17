/**
 * Compose mode: a CodeMirror editor over a doc card's composition text, in
 * place of the read view's block (`plan:composition-editor`,
 * Track 5). Lazy-loaded from `type-markdown.ts`, so readers who never press
 * Compose do not download CodeMirror. `sync.ts` owns autosave, Save, and
 * merging; this file wires it to the view, the toolbar, and the page.
 * `CardBody` renders this outside the parsed body and passes the block's
 * element as `host`, so the editor survives the block remounting.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CompositionFrame as Frame, CompositionReadError } from "../CompositionFrame";
import { Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { errorMessage } from "@shared/error-guards";
import { normalizeComposition } from "@shared/composition/marks/text";
import { controlAddress } from "@shared/ui-scan/control-address";
import { trpcClient } from "../../../lib/trpc/client";
import { displayName } from "../../../lib/display-name";
import { toastError } from "../../ui/toast-store";
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
import { acceptSelection, canAccept, isMalformed, markWidgets, openMarkRanges, selectOpenMark, type OpenMarkRange } from "./widgets";
import { MarksMenu } from "./MarksMenu";
import { registerReloadBlocker } from "../../../lib/reload-blockers";

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

interface Session {
  view: EditorView;
  sync: CompositionSync;
}

function createSession({ cardPath, initial, onState, onMalformed, onAcceptable, onMarks, focused }: {
  cardPath: string;
  initial: { text: string; regionHash: string };
  onState: (state: SaveState) => void;
  onMalformed: (malformed: boolean) => void;
  onAcceptable: (acceptable: boolean) => void;
  onMarks: (marks: OpenMarkRange[]) => void;
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
      // The sticky header bar (the frame's first child) covers the top of
      // the pane down to its sticky offset plus its height; keep the cursor below it.
      EditorView.scrollMargins.of((editor) => {
        const bar = editor.dom.closest(".bbx-composition")?.firstElementChild;
        if (bar === null || bar === undefined) return null;
        return { top: (Number.parseFloat(getComputedStyle(bar).top) || 0) + bar.getBoundingClientRect().height };
      }),
      markWidgets(),
      conflictWidgets(),
      theme,
      EditorView.updateListener.of((update) => {
        if (update.focusChanged) focused.current = update.view.hasFocus;
        if (update.docChanged || update.selectionSet) onAcceptable(canAccept(update.state));
        if (!update.docChanged) return;
        onMalformed(isMalformed(update.state));
        onMarks(openMarkRanges(update.state));
        if (!update.transactions.some((tr) => tr.annotation(Transaction.remote) === true)) sync?.localChanged();
      }),
    ],
  });
  onMalformed(isMalformed(view.state));
  onAcceptable(canAccept(view.state));
  onMarks(openMarkRanges(view.state));
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

function Editor({ cardPath, onClose, host, instance, initialMark, initial }: ComposeEditorProps & { initial: { text: string; regionHash: string } }): ReactNode {
  const [session, setSession] = useState<Session | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [malformed, setMalformed] = useState(false);
  const [acceptable, setAcceptable] = useState(false);
  const [marks, setMarks] = useState<OpenMarkRange[]>([]);
  const [resolveMessage, setResolveMessage] = useState<string | null>(null);
  const focused = useRef(false);

  // The session lives as long as this component, which `CardBody` keeps
  // mounted while composing; the frame around it may move between hosts.
  useEffect(() => {
    const created = createSession({ cardPath, initial, onState: setSaveState, onMalformed: setMalformed, onAcceptable: setAcceptable, onMarks: setMarks, focused });
    setSession(created);
    let ended = false;
    const losesEdits = () => created.sync.hasUnsaved() || (!ended && openConflictCount(created.view.state) > 0);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (losesEdits()) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    const unblockReload = registerReloadBlocker("compose-edits", losesEdits);
    return () => {
      ended = true;
      // A flush that never gets through keeps the leave warning on, and says
      // so where the person will see it: the editor is already gone.
      void created.sync.dispose().then((flushed) => {
        if (flushed.ok) {
          window.removeEventListener("beforeunload", beforeUnload);
          unblockReload();
          return;
        }
        console.error(`Compose: the final write of ${cardPath} failed:`, flushed.error);
        toastError(`Your composition edits to ${displayName(cardPath)} were not saved`, { cause: flushed.error, persist: true });
      });
      created.view.destroy();
    };
  }, [cardPath, initial]);

  useLiveRefresh({ when: fileChangeAt(cardPath), refresh: () => session?.sync.remoteChanged() });

  // Copy's "Go to it": select that mark once the editor is in the page (the
  // child `Attach` has placed it by the time this effect runs). Once per session.
  const wentTo = useRef<Session | null>(null);
  useEffect(() => {
    if (session === null || initialMark === null || wentTo.current === session) return;
    wentTo.current = session;
    selectOpenMark(session.view, initialMark);
  }, [session, initialMark]);

  const done = async () => {
    if (session === null || await session.sync.close()) onClose();
  };
  // A save of malformed text always fails: say what fixes it, not "retrying".
  const stateText = malformed && saveState.kind === "not-saved" ? "Not saved until the broken tag is fixed" : saveStateText(saveState);
  const alarming = saveState.kind === "not-saved" || saveState.kind === "not-synced" || saveState.kind === "removed";
  return (
    <Frame host={host}>
      {/* Sticky at the pane's top. When the card has its own sticky Contents
          button (z-index 3, shorter than the bar), the bar keeps its right
          end clear and the button sits there, above the bar. */}
      <Row gap="sm" align="center" justify="end" wrap className="sticky top-0 z-[2] [.bbx-card-front:has(>.bbx-card-contents)_&]:pr-12 rounded-t border-b border-card-pen bg-card-tint px-2 py-0.5 print:hidden">
        <span className="text-sm font-semibold text-card-pen">Composition</span>
        <span role="status" aria-live="polite" className="mr-auto">
          <Text as="span" size="xs" tone={alarming ? "danger" : "muted"} material>{stateText}</Text>
        </span>
        <Button
          id={controlAddress("bbx-composition-accept", instance)}
          label="Accept marked words as yours"
          title="Accept the selected marked words as yours, or the whole mark at the cursor (Ctrl/⌘+Shift+Enter)"
          aria-keyshortcuts="Control+Shift+Enter Meta+Shift+Enter"
          size="sm"
          intent="secondary"
          disabled={!acceptable}
          // Keep the editor's focus and selection through the press.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (session === null) return;
            acceptSelection(session.view);
            session.view.focus();
          }}
        >
          Accept
        </Button>
        {session === null ? null : <MarksMenu view={session.view} sync={session.sync} marks={marks} cardPath={cardPath} instance={instance} onMessage={setResolveMessage} />}
        <Button id={controlAddress("bbx-composition-commit", instance)} label="Commit composition" title="Commit: record this version in the card's history. Edits save to disk on their own." size="sm" intent="primary" disabled={saveState.kind === "removed"} onClick={async () => { await session?.sync.save(); }}>Commit</Button>
        <Button id={controlAddress("bbx-composition-done", instance)} label="Done editing composition" size="sm" intent="secondary" onClick={done}>Done</Button>
      </Row>
      {resolveMessage === null ? null : <ErrorText className="px-4 pt-2">{resolveMessage}</ErrorText>}
      {malformed ? <ErrorText className="px-4 pt-2">A tag in this composition is broken, so the marks show as raw text and nothing saves. Undo (Ctrl/⌘+Z), or fix the tag in the text: each opening tag needs its closing tag.</ErrorText> : null}
      {session === null ? null : <Attach view={session.view} focused={focused} />}
    </Frame>
  );
}

export function ComposeEditor({ cardPath, onClose, host, instance, initialMark }: ComposeEditorProps): ReactNode {
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
  if (read === null) return <Frame host={host}><StatusMessage busy>Loading…</StatusMessage></Frame>;
  if ("text" in read) return <Editor cardPath={cardPath} onClose={onClose} host={host} instance={instance} initialMark={initialMark} initial={read} />;
  const message = "error" in read ? `The composition could not be loaded: ${read.error}` : saveStateText({ kind: "removed", problem: read.problem });
  return (
    <Frame host={host}>
      <CompositionReadError message={message} instance={instance} onClose={onClose} />
    </Frame>
  );
}
