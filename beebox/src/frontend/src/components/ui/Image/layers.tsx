/**
 * The layers `Image` wraps around its img, inside-out: a quarter-turn frame
 * or an overlay wrapper, then a figure for the caption.
 */
import type { CSSProperties, ReactNode } from "react";
import { cn } from "../../../lib/cn";
import type { ImageRotation, ImageSize } from "./view";

/**
 * The box a quarter-turned image must fit, per size: the same caps as
 * `SIZE_CLASSES`, applied to the rotated shape. A thumb stays a square crop.
 */
const ROTATED_BOUNDS: Record<ImageSize, { width: string; height: string }> = {
  thumb: { width: "4rem", height: "4rem" },
  sm: { width: "20rem", height: "16rem" },
  md: { width: "100%", height: "24rem" },
  chat: { width: "100%", height: "70vh" },
  lg: { width: "100%", height: "32rem" },
};

export interface NaturalSize {
  width: number;
  height: number;
}

/**
 * A quarter turn (90 or 270). A CSS transform does not change the layout
 * box, so rotating the img alone overflowed sideways for a portrait photo and
 * left an overlay in the unrotated frame
 * (`issues/closed/bugs/2026-08-21-rotated-image-cards-overflow-and-misplace-bbox.md`).
 * Instead the outer box takes the rotated shape (width/height swapped from the
 * photo's natural size, capped by `ROTATED_BOUNDS`), and a frame with the
 * unrotated shape is centred in it and rotated as one piece with the overlay,
 * so overlay percentages stay in the photo's own coordinates. Until the photo
 * loads its shape is unknown and the box is square.
 */
function wrapQuarterTurn({ node, overlay, rotation, natural, size, extraClass }: {
  node: ReactNode;
  overlay: ReactNode;
  rotation: 90 | 270;
  natural: NaturalSize | null;
  size: ImageSize;
  extraClass?: string;
}): ReactNode {
  const bounds = ROTATED_BOUNDS[size];
  // Rotated width over rotated height: the photo's height over its width.
  const shape = size === "thumb" || natural === null ? { w: 1, h: 1 } : { w: natural.height, h: natural.width };
  const ratio = `${String(shape.w)} / ${String(shape.h)}`;
  return (
    <div
      className={cn("relative", extraClass)}
      style={{ width: `min(100%, ${bounds.width}, calc(${bounds.height} * ${ratio}))`, aspectRatio: ratio }}
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: `${String((shape.h / shape.w) * 100)}%`,
          height: `${String((shape.w / shape.h) * 100)}%`,
          transform: `translate(-50%, -50%) rotate(${String(rotation)}deg)`,
        }}
      >
        {node}
        {overlay}
      </div>
    </div>
  );
}

/** The overlay sits in the photo's frame; a half turn turns the two together. */
function wrapWithOverlay({ node, overlay, stretch, rotationStyle, extraClass }: { node: ReactNode; overlay: ReactNode; stretch: boolean; rotationStyle: CSSProperties | undefined; extraClass?: string }): ReactNode {
  return (
    <div className={cn("relative inline-block", stretch ? "w-full" : "", extraClass)} style={rotationStyle}>
      {node}
      {overlay}
    </div>
  );
}

function wrapInFigure({ node, caption, stretch, extraClass }: { node: ReactNode; caption: ReactNode; stretch: boolean; extraClass?: string }): ReactNode {
  return (
    <figure className={cn("inline-flex flex-col items-center", stretch ? "w-full" : "", extraClass)}>
      {node}
      <figcaption className="mt-1 max-w-full text-xs text-card-soft italic text-center">
        {caption}
      </figcaption>
    </figure>
  );
}

type OuterLayer = "figure" | "overlay" | "orthogonal" | "img";

interface AssembleOpts {
  base: ReactNode;
  caption: ReactNode;
  overlay: ReactNode;
  errored: boolean;
  rotation: ImageRotation;
  rotationStyle: CSSProperties | undefined;
  natural: NaturalSize | null;
  size: ImageSize;
  stretch: boolean;
  outerLayer: OuterLayer;
  className: string | undefined;
}

export function assembleImage({ base, caption, overlay, errored, rotation, rotationStyle, natural, size, stretch, outerLayer, className }: AssembleOpts): ReactNode {
  let node: ReactNode = base;
  if ((rotation === 90 || rotation === 270) && !errored) {
    node = wrapQuarterTurn({ node, overlay, rotation, natural, size, extraClass: outerLayer === "orthogonal" ? className : undefined });
  } else if (overlay !== undefined && !errored) {
    node = wrapWithOverlay({ node, overlay, stretch, rotationStyle, extraClass: outerLayer === "overlay" ? className : undefined });
  }
  if (caption !== undefined) {
    node = wrapInFigure({ node, caption, stretch, extraClass: className });
  }
  return node;
}

interface OuterLayerOpts {
  caption: ReactNode;
  overlay: ReactNode;
  errored: boolean;
  isOrthogonal: boolean;
}

export function pickOuterLayer({ caption, overlay, errored, isOrthogonal }: OuterLayerOpts): OuterLayer {
  if (caption !== undefined) return "figure";
  if (isOrthogonal && !errored) return "orthogonal";
  if (overlay !== undefined && !errored) return "overlay";
  return "img";
}
