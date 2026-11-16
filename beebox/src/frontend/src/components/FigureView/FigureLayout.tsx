/**
 * The figure card's layout around one slot. The slot holds the mounted
 * figure, its loading status, or a notice; the layout around it is the same
 * in every state, so a figure that cannot draw keeps the card's description
 * (page) or the embed's `![caption]` (embed).
 *
 * The notices (canvas-loop box figures plan, "When it goes wrong"): a sketch
 * written for the earlier canvas-loop and a device without WebGPU each get a
 * plain-words warning; any other failure keeps the technical "Figure error".
 */

import type { ReactNode } from "react";
import type { RendererProps } from "../../file-type-registry";
import type { FigureNotice as NoticeInfo } from "../../lib/figure-canvas-loop";
import { Notice } from "../ui/Notice";
import { Pre } from "../ui/Pre";
import { Text } from "../ui/Text";

interface FigureLayoutProps {
  mode: RendererProps["mode"];
  /** The embed's `![caption]`. */
  caption: string | undefined;
  /** The card's description, rendered; null when it has none. Shown in page and companion modes. */
  description: ReactNode;
  /** The slot: the figure, its loading status, or a notice. */
  children: ReactNode;
}

/**
 * As a card of its own (the full page, or a tab beside the chat), the slot is
 * inset with the description below it. Embedded (in a message), the slot has
 * minimal chrome and the caption beneath, like a captioned image. (FileView's
 * page header already offers the Source toggle.)
 */
export function FigureLayout({ mode, caption, description, children }: FigureLayoutProps) {
  if (mode === "page" || mode === "companion") {
    return (
      <div className="p-4">
        {children}
        {description !== null ? <div className="mt-3 max-w-2xl text-card-soft">{description}</div> : null}
      </div>
    );
  }
  if (caption !== undefined && caption.trim() !== "") {
    return <CaptionedFigure caption={caption}>{children}</CaptionedFigure>;
  }
  return children;
}

/** An embedded figure with its `![caption]` beneath, in the surrounding material's soft ink. */
export function CaptionedFigure({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="my-2">
      {children}
      <figcaption className="text-xs text-card-soft mt-1 text-center">{caption}</figcaption>
    </figure>
  );
}

const CANNOT_DRAW = "This figure can't draw on this device";

/** The warning texts, by kind. */
const WARNINGS = {
  outdated: {
    heading: "This figure needs updating",
    text: "It was made for an earlier version of the canvas-loop drawing library. The box's agent can regenerate it.",
  },
  "no-webgpu": {
    heading: CANNOT_DRAW,
    text: "It draws with WebGPU, which this browser or device does not offer. Updating the browser or the operating system may add it, or the figure may work on another device.",
  },
  "no-adapter": {
    heading: CANNOT_DRAW,
    text: "This browser has WebGPU turned off, or has no graphics hardware it can use for it.",
  },
} as const;

export function FigureNotice({ notice }: { notice: NoticeInfo }) {
  if (notice.kind === "error") return <FigureError message={notice.detail} />;
  const { heading, text } = WARNINGS[notice.kind];
  return (
    <Notice tone="warning">
      <h3 className="font-medium mb-1">{heading}</h3>
      <Text as="p" size="sm">{text}</Text>
      {notice.kind === "outdated" ? <Text as="p" size="xs" mono tone="muted" className="mt-2">{notice.detail}</Text> : null}
    </Notice>
  );
}

function FigureError({ message }: { message: string }) {
  return (
    <Notice tone="error">
      <h3 className="text-danger-dark font-medium mb-2">Figure error</h3>
      <Pre size="sm" error>{message}</Pre>
    </Notice>
  );
}
