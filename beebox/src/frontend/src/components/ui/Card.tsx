import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type CardPadding = "none" | "sm" | "md" | "lg";
export type CardBackground = "white" | "warm" | "info" | "transparent";
export type CardBorder = "none" | "subtle" | "default";
export type CardRounding = "none" | "default" | "lg";

export interface CardProps {
  children: ReactNode;
  /** Inner padding. Default `"md"` (1rem). */
  padding?: CardPadding;
  /** Background color. Default `"white"`. */
  background?: CardBackground;
  /** Border weight. Default `"default"` (warm-200). */
  border?: CardBorder;
  /** Corner rounding. Default `"lg"`. */
  rounding?: CardRounding;
  /** Drop shadow. Default false. */
  shadow?: boolean;
  /** Dim to indicate inactive/archived content. Default false. */
  muted?: boolean;
  /** Take background and border from the enclosing card's material (`white` becomes the raised sheet, `warm` the tint). */
  material?: boolean;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
  /** Render as a different element. Use `"section"` (with `aria-label`) for landmark grouping. Default `"div"`. */
  as?: "div" | "section" | "article";
  /** Stable `bbx-` address for a landmark card (see lib/ui-scan). */
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** Marks the card as busy (e.g. still loading) for assistive tech. */
  "aria-busy"?: boolean;
}

const PADDING_CLASSES: Record<CardPadding, string> = {
  none: "",
  sm: "p-2",
  md: "p-4",
  lg: "p-6",
};

const BACKGROUND_CLASSES: Record<CardBackground, string> = {
  white: "bg-white",
  warm: "bg-warm-50",
  info: "bg-info-50",
  transparent: "",
};

const BORDER_CLASSES: Record<CardBorder, string> = {
  none: "",
  subtle: "border border-warm-200",
  default: "border border-warm-300",
};

const MATERIAL_BACKGROUND_CLASSES: Record<CardBackground, string> = {
  white: "bg-card-sheet",
  warm: "bg-card-tint",
  info: "bg-card-tint",
  transparent: "",
};

const MATERIAL_BORDER_CLASSES: Record<CardBorder, string> = {
  none: "",
  subtle: "border border-card-rule",
  default: "border border-card-rule",
};

const ROUNDING_CLASSES: Record<CardRounding, string> = {
  none: "",
  default: "rounded",
  lg: "rounded-lg",
};

export function Card({
  children,
  padding,
  background,
  border,
  rounding,
  shadow,
  muted,
  material,
  className,
  as: asArg,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-busy": ariaBusy,
}: CardProps) {
  padding = padding ?? "md";
  background = background ?? "white";
  border = border ?? "default";
  rounding = rounding ?? "lg";
  shadow = shadow ?? false;
  muted = muted ?? false;
  const Tag = asArg ?? "div";
  const classes = cn(
    PADDING_CLASSES[padding],
    material === true ? MATERIAL_BACKGROUND_CLASSES[background] : BACKGROUND_CLASSES[background],
    material === true ? MATERIAL_BORDER_CLASSES[border] : BORDER_CLASSES[border],
    ROUNDING_CLASSES[rounding],
    shadow ? "shadow" : "",
    muted ? "opacity-60" : "",
    className,
  );
  return <Tag id={id} className={classes} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} aria-busy={ariaBusy}>{children}</Tag>;
}
