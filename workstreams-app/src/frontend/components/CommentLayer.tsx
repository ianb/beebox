import { useEffect, useMemo, useState } from "react";

import { captureSelection, findAnchoredRange, highlightRanges, type SelectionAnchor } from "../lib/selection-anchor.js";
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
function CommentBody({ comment, onClear }: { comment: Comment; onClear: () => void }) {
  return (
    <li className="comment-item">
      <p className="comment-meta">
        <Pill tone={comment.origin === "voice" ? "accent" : "neutral"}>{comment.origin}</Pill>
        {comment.workstream === null
          ? <Pill tone="warning">unrouted</Pill>
          : <Pill tone="info">{comment.workstream}</Pill>}
        <span className="muted">{comment.at.slice(0, 16).replace("T", " ")}</span>
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
  const [body, setBody] = useState("");
  // `origin` records how the text ARRIVED, not that it is verbatim — the
  // boxholder may correct the transcript, which is the point of the split.
  const [origin, setOrigin] = useState<"typed" | "voice">("typed");
  const [session, setSession] = useState<Awaited<ReturnType<typeof startRecording>> | null>(null);
  const [recordingProblem, setRecordingProblem] = useState<string | null>(null);
  const mic = recorderAvailability();
  const transcribe = trpc.comments.transcribe.useMutation();

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
        setBody((current) => (current === "" ? result.text : `${current} ${result.text}`));
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
        if (body.trim() !== "") onSubmit(body.trim(), origin);
      }}
    >
      {anchor === null
        ? <p className="muted">Commenting on the whole document.</p>
        : <blockquote className="comment-quote">{anchor.quoted}</blockquote>}
      <textarea
        className="comment-input"
        autoFocus
        rows={3}
        value={body}
        placeholder="What about it?"
        onChange={(event) => { setBody(event.target.value); }}
      />
      <p className="comment-actions">
        <Button type="submit" intent="primary" disabled={pending || body.trim() === ""}>
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
        <Button type="button" intent="quiet" onClick={onCancel}>Cancel</Button>
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
  const utils = trpc.useUtils();
  const comments = trpc.comments.forDocument.useQuery({ relPath });
  const add = trpc.comments.add.useMutation({
    onSuccess: async () => {
      setComposing(false);
      setAnchor(null);
      await utils.comments.forDocument.invalidate({ relPath });
    },
  });
  const clear = trpc.comments.clear.useMutation({
    onSuccess: async () => { await utils.comments.forDocument.invalidate({ relPath }); },
  });

  // Memoized because the highlight effect depends on it: a fresh `[]` every
  // render would re-run the effect forever.
  const items = useMemo(() => comments.data?.comments ?? [], [comments.data]);
  // Highlight whatever still resolves. What does not resolve is NOT dropped —
  // it is counted below and listed with its quoted text, because an anchoring
  // system whose failure mode is a silently vanished annotation is the bug this
  // design exists to avoid.
  useEffect(() => {
    const root = contentRef.current;
    if (root === null) return;
    const ranges: Range[] = [];
    for (const comment of items) {
      if (comment.fragment === undefined) continue;
      const range = findAnchoredRange(root, comment.fragment);
      if (range !== null) ranges.push(range);
    }
    highlightRanges(ranges);
    return () => { highlightRanges([]); };
  }, [items, contentRef]);

  useEffect(() => {
    if (!active) return;
    const root = contentRef.current;
    if (root === null) return;
    const onMouseUp = (): void => {
      const captured = captureSelection(root);
      if (captured !== null) {
        setAnchor(captured);
        setComposing(true);
      }
    };
    root.addEventListener("mouseup", onMouseUp);
    return () => { root.removeEventListener("mouseup", onMouseUp); };
  }, [active, contentRef]);

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
      ...(anchor?.quoted === undefined ? {} : { quoted: anchor.quoted }),
      ...(anchor?.section === undefined ? {} : { section: anchor.section }),
      ...(anchor?.fragment === undefined ? {} : { fragment: anchor.fragment }),
    });
  }

  const unresolved = items.filter((comment) => comment.fragment === undefined).length;

  return (
    <aside className="comment-layer" aria-label="Comments">
      <p className="comment-toolbar">
        <Button
          intent={active ? "primary" : "secondary"}
          onClick={() => { setActive((current) => !current); setComposing(false); }}
        >
          {active ? "Commenting on" : "Comment"}
        </Button>
        {active ? <span className="muted">Select text to comment on it.</span> : null}
        {active && !composing
          ? <Button intent="quiet" onClick={() => { setAnchor(null); setComposing(true); }}>
              On the whole document
            </Button>
          : null}
        {routed === null
          ? <span className="muted">unrouted — no workstream has changed this file</span>
          : <span className="muted">→ {routed}</span>}
      </p>

      {composing
        ? <Composer anchor={anchor} pending={add.isPending} onCancel={() => { setComposing(false); }} onSubmit={submit} />
        : null}
      {add.isError ? <p className="action-error" role="alert">Couldn’t save: {add.error.message}</p> : null}

      {items.length === 0 ? null : (
        <>
          <h2 className="comment-heading">
            comments <small>{items.length}</small>
            {unresolved === 0 ? null : (
              // Not dropped, and not pretending to be anchored either.
              <span className="muted"> · {unresolved} not anchored to a span</span>
            )}
          </h2>
          <ul className="comment-list">
            {items.map((comment) => (
              <CommentBody
                key={comment.id}
                comment={comment}
                onClear={() => { clear.mutate({ relPath, id: comment.id }); }}
              />
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
