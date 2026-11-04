import { useEffect, useMemo, useRef, useState } from "react";

import { highlightRanges, type SelectionAnchor } from "../lib/selection-anchor.js";
import { appendCommentTranscript, commentBody, commentDraftText } from "../lib/comment-draft.js";
import { CommentOverlay, scrollToComment, useCommentPicker, useCommentPositions, type CommentLocation } from "./comment-pointing.js";
import { recorderAvailability, startRecording } from "../lib/recorder.js";
import { MAX_AUDIO_BYTES } from "../../server/transcribe-contract.js";
import { Button, Pill } from "./ui.js";
import { trpc } from "../trpc.js";
import type { Comment } from "../types.js";

/**
 * Commenting on a rendered document (`docs/plans/document-comments.md`).
 *
 * Comments are a communication medium, not a document medium: the boxholder
 * leaves a remark, an agent reads it, acts, and clears it. Nothing here
 * maintains them — no threads, no resolution state, no re-anchoring.
 *
 * The affordance is a TOGGLE rather than an always-on handler. Selecting text
 * never conflicts with a page's own behaviour, but a comment layer that reacts
 * to every selection would fight ordinary reading and copying. Off is the
 * default; on, a selection opens the composer.
 */
function CommentBody({ comment, onClear, onGo, focused }: { comment: Comment; onClear: () => void; onGo: (() => void) | null; focused: boolean }) {
  return (
    <li id={`comment-${comment.id}`} className={`comment-item${focused ? " comment-focused" : ""}`}>
      <p className="comment-meta">
        <Pill tone={comment.origin === "voice" ? "accent" : "neutral"}>{comment.origin}</Pill>
        {comment.workstream === null
          ? <Pill tone="warning">unrouted</Pill>
          : <Pill tone="info">{comment.workstream}</Pill>}
        <span className="muted">{comment.at.slice(0, 16).replace("T", " ")}</span>
        {onGo === null ? null : <Button intent="quiet" onClick={onGo}>Go to target</Button>}
        <Button intent="quiet" onClick={onClear}>clear</Button>
      </p>
      {comment.quoted === undefined ? null : <blockquote className="comment-quote">{comment.quoted}</blockquote>}
      <p className="comment-text">{comment.body}</p>
    </li>
  );
}

function Composer({ anchor, onCancel, onSubmit, pending }: {
  anchor: SelectionAnchor | null;
  onCancel: () => void;
  onSubmit: (body: string, origin: "typed" | "voice") => void;
  pending: boolean;
}) {
  const [body, setBody] = useState(() => commentDraftText(anchor));
  // `origin` records how the text ARRIVED, not that it is verbatim — the
  // boxholder may correct the transcript, which is the point of the split.
  const [origin, setOrigin] = useState<"typed" | "voice">("typed");
  const [session, setSession] = useState<Awaited<ReturnType<typeof startRecording>> | null>(null);
  const [recordingProblem, setRecordingProblem] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const mic = recorderAvailability();
  const transcribe = trpc.comments.transcribe.useMutation();

  // A microphone left open is a bug people notice by the indicator light rather
  // than by an error. Every path out of the composer — Cancel, submitting typed
  // text, toggling commenting off, navigating away — unmounts this component,
  // so releasing here covers all of them.
  useEffect(() => () => { session?.cancel(); }, [session]);
  useEffect(() => {
    textarea.current?.focus();
    textarea.current?.scrollIntoView({ block: "nearest" });
  }, []);

  async function toggleRecording(): Promise<void> {
    setRecordingProblem(null);
    if (session !== null) {
      const recording = await session.stop();
      setSession(null);
      try {
        const result = await transcribe.mutateAsync({
          audio: recording.base64,
          mimeType: recording.mimeType,
        });
        // Appended, not replaced: a second take adds to what is there rather
        // than discarding a correction already made.
        setBody((current) => appendCommentTranscript(current, result.text));
        setOrigin("voice");
      } catch (e) {
        // The recording is gone but the composer is not — say so, and let the
        // boxholder type instead of losing the thought.
        setRecordingProblem(e instanceof Error ? e.message : "transcription failed");
      }
      return;
    }
    try {
      setSession(await startRecording(MAX_AUDIO_BYTES));
    } catch (e) {
      setRecordingProblem(e instanceof Error ? e.message : "could not start recording");
    }
  }

  return (
    <form
      className="comment-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (commentBody(body, anchor) !== "") onSubmit(commentBody(body, anchor), origin);
      }}
    >
      <textarea
        className="comment-input"
        rows={3}
        value={body}
        placeholder="What about it?"
        ref={textarea}
        onChange={(event) => { setBody(event.target.value); }}
      />
      <p className="comment-actions">
        <Button type="submit" intent="primary" disabled={pending || commentBody(body, anchor) === ""}>
          {pending ? "Saving…" : "Comment"}
        </Button>
        {mic.available
          ? <Button
              type="button"
              intent={session === null ? "secondary" : "danger"}
              disabled={transcribe.isPending}
              onClick={() => { void toggleRecording(); }}
            >
              {session !== null ? "Stop" : transcribe.isPending ? "Transcribing…" : "Speak"}
            </Button>
          : <Button type="button" intent="quiet" disabled title={mic.reason}>Speak</Button>}
        <Button
          type="button"
          intent="quiet"
          onClick={() => { session?.cancel(); setSession(null); onCancel(); }}
        >
          Cancel
        </Button>
      </p>
      {/* Disabled AND reasoned: a control that vanishes teaches the wrong
          lesson about why it is missing. */}
      {mic.available ? null : <p className="muted">{mic.reason}</p>}
      {recordingProblem === null ? null : <p className="action-error" role="alert">{recordingProblem}</p>}
    </form>
  );
}

export function CommentLayer({ relPath, workstream, changedIn, contentRef }: {
  relPath: string;
  workstream: string | null;
  /** Workstreams that changed this file — the routing ladder's input. */
  changedIn: string[];
  contentRef: React.RefObject<HTMLElement | null>;
}) {
  const [active, setActive] = useState(false);
  const [anchor, setAnchor] = useState<SelectionAnchor | null>(null);
  const [composing, setComposing] = useState(false);
  const [location, setLocation] = useState<CommentLocation | null>(null);
  const [showList, setShowList] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const utils = trpc.useUtils();
  // `worktree` is the lens being read; `workstream` below is who the remark is
  // for. Usually the same name, but not always, and conflating them files a
  // comment where nobody will look for it.
  const comments = trpc.comments.forDocument.useQuery({ relPath, worktree: workstream });
  const add = trpc.comments.add.useMutation({
    onSuccess: async () => {
      setComposing(false);
      setAnchor(null);
      setLocation(null);
      await utils.comments.forDocument.invalidate({ relPath, worktree: workstream });
    },
  });
  const clear = trpc.comments.clear.useMutation({
    onSuccess: async () => {
      await utils.comments.forDocument.invalidate({ relPath, worktree: workstream });
    },
  });

  // Memoized because the highlight effect depends on it: a fresh `[]` every
  // render would re-run the effect forever.
  const items = useMemo(() => comments.data?.comments ?? [], [comments.data]);
  const positions = useCommentPositions({ rootRef: contentRef, items, active });
  const picker = useCommentPicker({
    rootRef: contentRef,
    active,
    composing,
    onPick: (picked, target) => { setAnchor(picked); setLocation(target); setComposing(true); },
  });
  // Highlight whatever still resolves. What does not resolve is NOT dropped —
  // it is counted below and listed with its quoted text, because an anchoring
  // system whose failure mode is a silently vanished annotation is the bug this
  // design exists to avoid.
  useEffect(() => {
    const root = contentRef.current;
    if (root === null) return;
    const ranges = [
      ...positions.anchored.flatMap(({ location: target }) => target instanceof Range ? [target] : []),
      ...(composing && location instanceof Range ? [location] : []),
    ];
    highlightRanges(ranges);
    return () => { highlightRanges([]); };
  }, [positions.anchored, contentRef, composing, location]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (composing) { setComposing(false); setAnchor(null); setLocation(null); }
      else setActive(false);
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [active, composing]);

  /**
   * The routing ladder (`document-comments.md`, Track 4a), which never guesses
   * silently: an explicit lens wins; one modifying workstream is inferred;
   * several take the most recent, shown and changeable; none means unrouted,
   * which is how new work starts rather than an error.
   */
  const routed = workstream ?? changedIn[0] ?? null;

  function submit(body: string, origin: "typed" | "voice"): void {
    add.mutate({
      relPath,
      body,
      origin,
      workstream: routed,
      worktree: workstream,
      ...(anchor?.quoted === undefined ? {} : { quoted: anchor.quoted }),
      ...(anchor?.section === undefined ? {} : { section: anchor.section }),
      ...(anchor?.fragment === undefined ? {} : { fragment: anchor.fragment }),
    });
  }

  const unresolved = positions.unresolved;
  useEffect(() => {
    if (focusedId !== null && showList) document.getElementById(`comment-${focusedId}`)?.scrollIntoView({ block: "nearest" });
  }, [focusedId, showList]);

  return (
    <aside className="comment-layer" aria-label="Comments">
      <p className="comment-toolbar">
        <Button
          intent={active ? "primary" : "secondary"}
          onClick={() => { setActive((current) => !current); setComposing(false); setLocation(null); }}
        >
          {active ? `Done commenting · ${comments.isError ? "count unavailable" : `${String(items.length)} open`}` : `Comment · ${comments.isError ? "count unavailable" : `${String(items.length)} open`}`}
        </Button>
        {active ? <span className="muted">Point to a part, or select text.</span> : null}
        {active && !composing
          ? <Button intent="quiet" onClick={() => { setAnchor(null); setLocation(null); setComposing(true); }}>
              On the whole document
            </Button>
          : null}
        {routed === null
          ? <span className="muted">unrouted — no workstream has changed this file</span>
          : <span className="muted">→ {routed}</span>}
        {items.length > 0 ? <Button intent="quiet" onClick={() => { setShowList((value) => !value); }}>{showList ? "Hide comments" : "Show all comments"}</Button> : null}
      </p>

      {active ? <CommentOverlay hovered={picker.hovered ?? (composing && location instanceof Element ? location : null)} anchored={positions.anchored} layoutKey={`${String(composing)}:${String(showList)}`} onMarker={(comment) => {
        setFocusedId(comment.id);
        setShowList(true);
      }} /> : null}

      {composing ? <Composer anchor={anchor} pending={add.isPending} onCancel={() => { setComposing(false); setAnchor(null); setLocation(null); }} onSubmit={submit} /> : null}
      {add.isError ? <p className="action-error" role="alert">Couldn’t save: {add.error.message}</p> : null}
      {comments.isError ? <p className="action-error" role="alert">Couldn’t read comments: {comments.error.message}</p> : null}

      {items.length === 0 || !showList ? null : (
        <>
          <h2 className="comment-heading">
            comments <small>{items.length}</small>
            {unresolved === 0 ? null : (
              // Not dropped, and not pretending to be anchored either.
              <span className="muted"> · {unresolved} not anchored to a span</span>
            )}
          </h2>
          <ul className="comment-list">
            {items.map((comment) => {
              const target = positions.anchored.find((entry) => entry.comment.id === comment.id)?.location ?? null;
              return <CommentBody key={comment.id} comment={comment} focused={focusedId === comment.id}
                onGo={target === null ? null : () => { scrollToComment(target); setFocusedId(comment.id); }}
                onClear={() => { clear.mutate({ relPath, worktree: workstream, id: comment.id }); }} />;
            })}
          </ul>
        </>
      )}
    </aside>
  );
}
