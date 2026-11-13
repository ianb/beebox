/**
 * Ack badges shown alongside a user message — one per `<ack>` the agent
 * emitted in its reply. Each badge opens a popover with the ack label
 * and an optional ref link.
 */

import { Popover } from "../ui/Popover";
import { getAckKind, type AckIndication } from "../../lib/structured-output-parsing";
import { parseViewUrl } from "../../lib/view-url";
import type { OnZoomView } from "./markdown-rendering";

/**
 * Small ack badges shown alongside a user message — one per `<ack>` the
 * agent emitted in its reply. Same background as the user bubble so they
 * read as part of it. Renders inline, no positioning of its own — the
 * caller places this in the bubble's absolutely-positioned corner row,
 * shared with `AudioOverlayBadgeCluster` (audio-overlay-badge.tsx),
 * ack badges first.
 */
export function AckBadgeCluster({ acks, onZoomView }: { acks: AckIndication[] | undefined; onZoomView?: OnZoomView }) {
  if (!acks || acks.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5">
      {acks.map((ack, i) => (
        <AckBadge key={i} ack={ack} onZoomView={onZoomView} />
      ))}
    </span>
  );
}

function AckBadge({ ack, onZoomView }: { ack: AckIndication; onZoomView?: OnZoomView }) {
  const descriptor = getAckKind(ack.kind);
  if (!descriptor) return null;
  const label = ack.text ? `${descriptor.defaultPhrase} — ${ack.text}` : descriptor.defaultPhrase;

  return (
    <Popover
      label={label}
      trigger={({ toggle, ariaProps }) => (
        <button
          type="button"
          onClick={toggle}
          aria-label={label}
          {...ariaProps}
          className="group inline-flex items-center justify-center w-6 h-6 -my-[5px] rounded-full text-white text-[0.5625rem] leading-none cursor-pointer"
        >
          <span aria-hidden className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-info ring-1 ring-warm-50">{descriptor.icon}</span>
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="font-medium text-warm-900">{label}</div>
          {ack.ref ? (
            onZoomView ? (
              <button
                type="button"
                onClick={() => {
                  if (!ack.ref) return;
                  const target = parseViewUrl(ack.ref);
                  onZoomView({ target, label: target.path });
                  close();
                }}
                className="mt-1 block text-left text-info hover:underline break-all font-mono text-[0.6875rem]"
              >
                {ack.ref}
              </button>
            ) : (
              <div className="mt-1 text-warm-700 break-all font-mono text-[0.6875rem]">{ack.ref}</div>
            )
          ) : null}
        </>
      )}
    </Popover>
  );
}
