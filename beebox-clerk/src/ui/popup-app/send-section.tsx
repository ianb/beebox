import { useCallback, useState } from "react";
import type { ClerkMessage, SendActionResult } from "../../domain/messages.js";
import {
  CHOOSE_LATER_TEXT,
  FORGOTTEN_TEXT,
  MAX_POPUP_CHOICES,
  UNCONFIRMED_TEXT,
  UNSUPPORTED_TEXT,
  sendChatUrl,
  sendConfirmed,
  sendViewText,
  type SendView,
} from "../../domain/send.js";
import { openBox } from "../../platform/open-box.js";
import { NoticeLine, toNotice, type Notice } from "./notice-line.js";
import { sendAction } from "./send-action.js";

type Busy = "send" | "retry" | "choose";

interface SendSectionProps {
  /** The active box, which the auth notice opens. */
  boxUrl: string;
  tabId: number | null;
  /** Why this tab can't be captured (same rules as Comment), or null. */
  blockedReason: string | null;
}

/** Send to box: a note, a Send button, and where the send stands. */
export function SendSection({ boxUrl, tabId, blockedReason }: SendSectionProps) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Busy | null>(null);
  const [last, setLast] = useState<SendActionResult | null>(null);
  /** The note that went with `last`, so Try again clears it once confirmed. */
  const [lastNote, setLastNote] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // The note a confirmed send carried: only that text is cleared, never words typed since.
  const run = useCallback((params: { busy: Busy; message: ClerkMessage; sentNote: string | null }) => {
    setBusy(params.busy);
    setNotice(null);
    void sendAction(params.message).then((response) => {
      setBusy(null);
      if (!response.ok || response.result?.kind !== "send") {
        setNotice(toNotice(response, ""));
        return;
      }
      const result = response.result;
      // A failed choice keeps the choices on screen, with the error under them.
      if (params.busy === "choose" && result.outcome.status !== "answered") {
        setNotice({ kind: "error", text: outcomeErrorText(result) });
        return;
      }
      setLast(result);
      if (params.busy === "send") setLastNote(params.sentNote);
      const { sentNote } = params;
      if (sentNote !== null && sendConfirmed(result.outcome)) setNote((current) => (current === sentNote ? "" : current));
    });
  }, []);

  const handleSend = useCallback(() => {
    if (tabId === null) return;
    run({ busy: "send", message: { type: "sendToBox", tabId, note }, sentNote: note });
  }, [note, run, tabId]);

  const handleRetry = useCallback(() => {
    if (last === null) return;
    run({ busy: "retry", message: { type: "retrySend", id: last.id }, sentNote: lastNote });
  }, [last, lastNote, run]);

  const handleChoose = useCallback(
    (candidateId: string) => {
      if (last === null) return;
      run({ busy: "choose", message: { type: "chooseSend", id: last.id, candidateId }, sentNote: null });
    },
    [last, run],
  );

  const handleNote = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setNote(e.target.value);
  }, []);

  const handleOpenBox = useCallback(() => {
    openBoxTab(last?.boxUrl ?? boxUrl);
  }, [boxUrl, last]);

  const blocked = blockedReason !== null || tabId === null;
  return (
    <div className="space-y-2 border-b border-gray-200 pb-3">
      <textarea
        value={note}
        onChange={handleNote}
        placeholder="Add a note (optional)"
        aria-label="Add a note (optional)"
        rows={2}
        disabled={blocked}
        className="w-full resize-y rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-800 disabled:bg-gray-50"
      />
      {/* The tooltip lives on the wrapper: a disabled button fires no mouse events. */}
      <span className="block" title={blockedReason ?? undefined}>
        <button
          onClick={handleSend}
          disabled={busy !== null || blocked}
          className="w-full rounded bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
        >
          {busy === "send" ? "Sending…" : "Send to box"}
        </button>
      </span>
      {last !== null ? (
        <SendOutcomeLine
          result={last}
          busy={busy}
          onRetry={handleRetry}
          onSendAgain={handleSend}
          onChoose={handleChoose}
        />
      ) : null}
      {notice !== null ? <NoticeLine notice={notice} onOpenBox={handleOpenBox} /> : null}
    </div>
  );
}

function outcomeErrorText(result: SendActionResult): string {
  const { outcome } = result;
  if (outcome.status === "unsupported") return UNSUPPORTED_TEXT;
  if (outcome.status === "forgotten") return FORGOTTEN_TEXT;
  if (outcome.status === "answered") return sendViewText(outcome.view);
  return outcome.message;
}

function openTab(url: string): void {
  chrome.tabs.create({ url }).catch((err: unknown) => {
    console.error("[clerk] failed to open tab:", err);
  });
}

function openBoxTab(boxUrl: string): void {
  openBox(boxUrl).catch((err: unknown) => {
    console.error("[clerk] failed to open box:", err);
  });
}

interface SendOutcomeLineProps {
  result: SendActionResult;
  busy: Busy | null;
  onRetry: () => void;
  onSendAgain: () => void;
  onChoose: (candidateId: string) => void;
}

const LINK_BUTTON = "font-semibold underline disabled:text-gray-400";

function SendOutcomeLine(props: SendOutcomeLineProps) {
  const { result, busy, onRetry, onSendAgain, onChoose } = props;
  const { outcome, boxUrl } = result;
  const handleOpenBox = useCallback(() => {
    openBoxTab(boxUrl);
  }, [boxUrl]);
  if (outcome.status === "answered") {
    return <AnsweredLine view={outcome.view} boxUrl={boxUrl} busy={busy} onChoose={onChoose} />;
  }
  if (outcome.status === "unconfirmed") {
    return (
      <p className="text-sm text-red-700">
        {UNCONFIRMED_TEXT}{" "}
        <button onClick={onRetry} disabled={busy !== null} className={LINK_BUTTON}>
          {busy === "retry" ? "Trying again…" : "Try again"}
        </button>
      </p>
    );
  }
  if (outcome.status === "forgotten") {
    return (
      <p className="text-sm text-red-700">
        {FORGOTTEN_TEXT}{" "}
        <button onClick={onSendAgain} disabled={busy !== null} className={LINK_BUTTON}>
          Send again
        </button>
      </p>
    );
  }
  if (outcome.status === "unsupported") return <p className="text-sm text-red-700">{UNSUPPORTED_TEXT}</p>;
  if (outcome.status === "auth") {
    return <NoticeLine notice={toNotice({ ok: false, status: 401, message: outcome.message }, "")} onOpenBox={handleOpenBox} />;
  }
  return <p className="break-words text-sm text-red-700">{outcome.message}</p>;
}

interface AnsweredLineProps {
  view: SendView;
  boxUrl: string;
  busy: Busy | null;
  onChoose: (candidateId: string) => void;
}

function AnsweredLine({ view, boxUrl, busy, onChoose }: AnsweredLineProps) {
  const text = sendViewText(view);
  const chatUrl = view.state === "sent" ? sendChatUrl(boxUrl, view) : null;
  const handleOpen = useCallback(() => {
    if (chatUrl === null) openBoxTab(boxUrl);
    else openTab(chatUrl);
  }, [boxUrl, chatUrl]);
  if (view.state === "needs-choice") {
    const choices = (view.choices ?? []).slice(0, MAX_POPUP_CHOICES);
    return (
      <div className="space-y-1.5">
        <p className="text-sm text-gray-800">{text}</p>
        {choices.map((choice) => (
          <button
            key={choice.candidateId}
            onClick={() => onChoose(choice.candidateId)}
            disabled={busy !== null}
            title={choice.detail}
            className="w-full rounded border border-teal-600 px-2 py-1.5 text-left text-sm text-teal-700 hover:bg-teal-50 disabled:border-gray-300 disabled:text-gray-400"
          >
            {choice.label}
          </button>
        ))}
        <p className="text-xs text-gray-500">{CHOOSE_LATER_TEXT}</p>
      </div>
    );
  }
  const tone = view.state === "sending" && view.lastError !== undefined ? "text-red-700" : "text-teal-700";
  return (
    <p className={`break-words text-sm ${tone}`}>
      {text}{" "}
      <button onClick={handleOpen} className={LINK_BUTTON}>
        {chatUrl === null ? "Open box" : "Open chat"}
      </button>
    </p>
  );
}
