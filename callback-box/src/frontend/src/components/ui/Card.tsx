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
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
  /** Render as a different element. Use `"section"` (with `aria-label`) for landmark grouping. Default `"div"`. */
  as?: "div" | "section" | "article";
  "aria-label"?: string;
  "aria-labelledby"?: string;
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

const ROUNDING_CLASSES: Record<CardRounding, string> = {
  none: "",
  default: "rounded",
  lg: "rounded-lg",
};

export function Card({
  children,
  padding = "md",
  background = "white",
  border = "default",
  rounding = "lg",
  shadow = false,
  muted = false,
  className,
  as: Tag = "div",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: CardProps) {
  const classes = cn(
    PADDING_CLASSES[padding],
    BACKGROUND_CLASSES[background],
    BORDER_CLASSES[border],
    ROUNDING_CLASSES[rounding],
    shadow ? "shadow" : "",
    muted ? "opacity-60" : "",
    className,
  );
  return <Tag className={classes} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy}>{children}</Tag>;
}
