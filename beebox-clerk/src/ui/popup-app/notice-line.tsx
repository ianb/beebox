import type { ActionResponse } from "../../domain/messages.js";
import { AUTH_TEXT } from "../../domain/send.js";

export interface Notice {
  kind: "ok" | "error" | "auth";
  text: string;
}

export function toNotice(response: ActionResponse, okText: string): Notice {
  if (response.ok) return { kind: "ok", text: okText };
  if (response.status === 401 || response.status === 403) {
    return { kind: "auth", text: AUTH_TEXT };
  }
  return { kind: "error", text: response.message };
}

interface NoticeLineProps {
  notice: Notice;
  onOpenBox: () => void;
}

export function NoticeLine({ notice, onOpenBox }: NoticeLineProps) {
  if (notice.kind === "ok") {
    return <p className="text-sm text-teal-700">{notice.text}</p>;
  }
  if (notice.kind === "auth") {
    return (
      <p className="text-sm text-red-700">
        {notice.text}{" "}
        <button onClick={onOpenBox} className="underline">
          Open box
        </button>
      </p>
    );
  }
  return <p className="break-words text-sm text-red-700">{notice.text}</p>;
}
