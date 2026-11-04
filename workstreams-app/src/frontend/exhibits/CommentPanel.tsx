import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";

import { MAX_AUDIO_BYTES } from "../../server/transcribe-contract.js";
import { recorderAvailability, startRecording } from "../lib/recorder.js";
import { captureElement, highlightRanges, largerCommentTarget, type SelectionAnchor } from "../lib/selection-anchor.js";
import { CommentOverlay, commentComposerStyle, scrollToComment, useCommentPicker, useCommentPositions, type CommentLocation } from "../components/comment-pointing.js";
import { commentSchema, type Comment } from "../../shared/comments.js";
import {
  appendTranscript,
  commentRequest,
  responseProblem,
  savedMessage,
  type CommentOrigin,
} from "./comment-requests.js";

type Session = Awaited<ReturnType<typeof startRecording>>;

function useFocusComment(input: { listRef: RefObject<HTMLDivElement | null>; focusedId: string | null; listOpen: boolean }): void {
  const { listRef, focusedId, listOpen } = input;
  useEffect(() => {
    if (!listOpen || focusedId === null) return;
    const row = Array.from(listRef.current?.children ?? []).find((child) => child.getAttribute("data-comment-id") === focusedId);
    row?.scrollIntoView({ block: "center" });
  }, [listRef, listOpen, focusedId]);
}

const BUTTON = "rounded-md border border-stone-400 bg-white px-3 py-1.5 text-sm font-semibold text-stone-800 hover:bg-stone-100 disabled:opacity-60";
const BUTTON_ON = "rounded-md border border-stone-800 bg-stone-800 px-3 py-1.5 text-sm font-semibold text-white hover:bg-stone-700";

async function postJson(url: string, payload: unknown): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch (_error) {
    // Not JSON (a 204, a proxy page): the status line carries the report.
  }
  return { ok: response.ok, status: response.status, body };
}

/**
 * The draft: quoted text (or the whole exhibit), a textarea, Speak, Comment,
 * Cancel. Speech is appended to whatever is typed, and the origin records how
 * the text ARRIVED, not that it is verbatim — the boxholder may fix the
 * transcript before sending.
 */
function Composer({ anchor, onCancel, onSubmit, pending }: {
  anchor: SelectionAnchor | null;
  onCancel: () => void;
  onSubmit: (body: string, origin: CommentOrigin) => void;
  pending: boolean;
}): ReactNode {
  const [body, setBody] = useState("");
  const [origin, setOrigin] = useState<CommentOrigin>("typed");
  const [session, setSession] = useState<Session | null>(null);
  // Between the Speak click and the permission answer: a second click must not
  // open a second microphone that nothing holds a handle to.
  const [starting, setStarting] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const mic = recorderAvailability();
  // Whether this composer still wants a microphone. The permission prompt can
  // outlive the composer, so a session that resolves after Cancel is released
  // on arrival rather than left recording with no owner.
  const wanted = useRef(true);
  const live = useRef<Session | null>(null);
  useEffect(() => {
    wanted.current = true;
    return () => {
      wanted.current = false;
      live.current?.cancel();
    };
  }, []);

  async function toggleRecording(): Promise<void> {
    setProblem(null);
    if (session !== null) {
      const recording = await session.stop();
      live.current = null;
      setSession(null);
      setTranscribing(true);
      try {
        const result = await postJson("/api/transcribe", { audio: recording.base64, mimeType: recording.mimeType });
        if (!result.ok) {
          setProblem(responseProblem(result));
          return;
        }
        const text = typeof result.body === "object" && result.body !== null && "text" in result.body && typeof result.body.text === "string"
          ? result.body.text
          : "";
        setBody((current) => appendTranscript(current, text));
        setOrigin("voice");
      } catch (error) {
        setProblem(error instanceof Error ? error.message : String(error));
      } finally {
        setTranscribing(false);
      }
      return;
    }
    if (starting) return;
    setStarting(true);
    try {
      const started = await startRecording(MAX_AUDIO_BYTES);
      if (!wanted.current) {
        started.cancel();
        return;
      }
      live.current = started;
      setSession(started);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-stone-300 bg-stone-50 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (body.trim() !== "") onSubmit(body, origin);
      }}
    >
      {anchor === null
        ? <p className="m-0 text-sm text-stone-600">Commenting on the whole exhibit.</p>
        : (
          <blockquote className="m-0 border-l-4 border-stone-400 pl-3 text-sm text-stone-700">
            {anchor.section === undefined ? null : <span className="mr-2 font-semibold">{anchor.section}:</span>}
            {anchor.quoted.slice(0, 220)}{anchor.quoted.length > 220 ? "…" : ""}
          </blockquote>
        )}
      <textarea
        autoFocus
        className="min-h-20 w-full rounded-md border border-stone-300 p-2 text-sm"
        onChange={(event) => { setBody(event.target.value); }}
        placeholder="What about it?"
        rows={3}
        value={body}
      />
      <p className="m-0 flex flex-wrap items-center gap-2">
        <button className={BUTTON_ON} disabled={pending || body.trim() === ""} type="submit">
          {pending ? "Saving…" : "Comment"}
        </button>
        {mic.available
          ? (
            <button
              className={session === null ? BUTTON : `${BUTTON} border-red-700 text-red-800`}
              disabled={transcribing || starting}
              onClick={() => { void toggleRecording(); }}
              type="button"
            >
              {session !== null ? "Stop" : transcribing ? "Transcribing…" : starting ? "Starting…" : "Speak"}
            </button>
          )
          : <button className={BUTTON} disabled title={mic.reason} type="button">Speak</button>}
        <button className={BUTTON} onClick={onCancel} type="button">Cancel</button>
        {mic.available ? null : <span className="text-sm text-stone-600">{mic.reason}</span>}
      </p>
      {problem === null ? null : <p className="m-0 text-sm text-red-900" role="alert">{problem}</p>}
    </form>
  );
}

/**
 * Commenting on an exhibit page (`docs/implemented-plans/exhibit-comments.md`). Off by
 * default, because selecting text is ordinary reading. On, a selection inside
 * `contentRef` opens the composer with the quoted text and the heading above
 * it; "the whole exhibit" opens it with no anchor. The comment goes to the
 * exhibit's workstream through the exhibits origin, and the agent reads it with
 * `bin/comments` — nothing is read back here.
 */
export function CommentPanel({ scope, contentRef }: {
  scope: string;
  contentRef: RefObject<HTMLElement | null>;
}): ReactNode {
  const [active, setActive] = useState(false);
  const [draft, setDraft] = useState<{ anchor: SelectionAnchor | null } | null>(null);
  const [pending, setPending] = useState(false), [notice, setNotice] = useState<{ kind: "saved" | "problem"; text: string } | null>(null);
  const [readProblem, setReadProblem] = useState<string | null>(null);
  const [items, setItems] = useState<Comment[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [location, setLocation] = useState<CommentLocation | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  useFocusComment({ listRef, focusedId, listOpen });
  const positions = useCommentPositions({ rootRef: contentRef, items, active });
  const picker = useCommentPicker({
    rootRef: contentRef,
    active,
    composing: draft !== null,
    onPick: (anchor, target) => { setNotice(null); setDraft({ anchor }); setLocation(target); },
  });
  const handleWidenDraft = (): void => {
    const root = contentRef.current;
    if (root === null || !(location instanceof Element)) return;
    const larger = largerCommentTarget(location, root);
    if (larger === null) return;
    setLocation(larger);
    setDraft({ anchor: captureElement(root, larger) });
  };

  useEffect(() => {
    highlightRanges(positions.anchored.flatMap(({ location: target }) => target instanceof Range ? [target] : []));
    return () => { highlightRanges([]); };
  }, [positions.anchored]);

  useEffect(() => {
    let current = true;
    const read = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/${scope}/comments`);
        const body: unknown = await response.json();
        if (!response.ok) {
          if (current) setReadProblem(responseProblem({ status: response.status, body }));
          return;
        }
        const parsed = commentSchema.array().safeParse(typeof body === "object" && body !== null && "comments" in body ? body.comments : null);
        if (!parsed.success) {
          if (current) setReadProblem("The comment list was invalid.");
          return;
        }
        if (current) { setItems(parsed.data); setReadProblem(null); }
      } catch (error) {
        if (current) setReadProblem(error instanceof Error ? error.message : String(error));
      }
    };
    void read();
    return () => { current = false; };
  }, [scope]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (draft !== null) setDraft(null);
      else setActive(false);
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [active, draft]);

  async function submit(body: string, origin: CommentOrigin): Promise<void> {
    setPending(true);
    try {
      const result = await postJson(`/api/${scope}/comments`, commentRequest({ anchor: draft?.anchor ?? null, body, origin }));
      if (!result.ok) {
        setNotice({ kind: "problem", text: responseProblem(result) });
        return;
      }
      const workstream = typeof result.body === "object" && result.body !== null && "workstream" in result.body && typeof result.body.workstream === "string"
        ? result.body.workstream
        : scope.split("/")[0] ?? scope;
      setDraft(null);
      setLocation(null);
      setNotice({ kind: "saved", text: savedMessage(workstream) });
      try {
        const updated = await fetch(`/api/${scope}/comments`);
        const data: unknown = await updated.json();
        if (!updated.ok) setReadProblem(responseProblem({ status: updated.status, body: data }));
        else {
          const parsed = commentSchema.array().safeParse(typeof data === "object" && data !== null && "comments" in data ? data.comments : null);
          if (parsed.success) { setItems(parsed.data); setReadProblem(null); }
          else setReadProblem("The comment list was invalid.");
        }
      } catch (error) {
        setReadProblem(error instanceof Error ? error.message : String(error));
      }
    } catch (error) {
      setNotice({ kind: "problem", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" aria-label="Comments">
      <p className="m-0 flex flex-wrap items-center gap-2">
        <button
          className={active ? BUTTON_ON : BUTTON}
          onClick={() => { setActive((current) => !current); setDraft(null); setLocation(null); setNotice(null); }}
          type="button"
        >
          {active ? `Done commenting · ${readProblem === null ? `${String(items.length)} open` : "count unavailable"}` : `Comment · ${readProblem === null ? `${String(items.length)} open` : "count unavailable"}`}
        </button>
        {active && draft === null
          ? (
            <>
              <span className="text-sm text-stone-600">Point to a part, or select text.</span>
              <button className={BUTTON} onClick={() => { setNotice(null); setDraft({ anchor: null }); }} type="button">
                comment on the whole exhibit
              </button>
            </>
          )
          : null}
        {items.length > 0 ? <button className={BUTTON} onClick={() => { setListOpen((value) => !value); }} type="button">{listOpen ? "Hide comments" : "Show all comments"}</button> : null}
      </p>
      {active ? <CommentOverlay hovered={picker.hovered ?? (draft !== null && location instanceof Element ? location : null)} anchored={positions.anchored} layoutKey={`${String(draft !== null)}:${String(listOpen)}`} onMarker={(comment) => { setFocusedId(comment.id); setListOpen(true); }} /> : null}
      {draft === null
        ? null
        : <div className="comment-draft-position" style={commentComposerStyle(location)}>
          {location instanceof Element ? <button className={BUTTON} onClick={handleWidenDraft} type="button">Larger target</button> : null}
          <Composer anchor={draft.anchor} onCancel={() => { setDraft(null); }} onSubmit={(body, origin) => void submit(body, origin)} pending={pending} />
        </div>}
      {listOpen ? <div className="comment-all-list" aria-label="All comments" ref={listRef}>
        <p className="m-0 text-sm text-stone-600">{String(positions.unresolved)} without a current marker</p>
        {items.map((comment) => <div className={focusedId === comment.id ? "comment-focused" : undefined} data-comment-id={comment.id} key={comment.id}>
          {positions.anchored.find((entry) => entry.comment.id === comment.id)?.location === undefined ? null : <button className={BUTTON} onClick={() => {
            const target = positions.anchored.find((entry) => entry.comment.id === comment.id)?.location;
            if (target !== undefined) scrollToComment(target);
            setFocusedId(comment.id);
          }} type="button">Go to target</button>}
          {comment.quoted === undefined ? null : <blockquote className="m-0 text-sm text-stone-600">{comment.quoted}</blockquote>}
          <p className="m-0 text-sm">{comment.body}</p>
        </div>)}
      </div> : null}
      {notice === null
        ? null
        : (
          <p className={notice.kind === "saved" ? "m-0 text-sm text-green-900" : "m-0 text-sm text-red-900"} role={notice.kind === "saved" ? "status" : "alert"}>
            {notice.text}
          </p>
        )}
      {readProblem === null ? null : <p className="m-0 text-sm text-red-900" role="alert">Couldn’t read comments: {readProblem}</p>}
    </div>
  );
}
