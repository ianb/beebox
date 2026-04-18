import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type TextSize = "xs" | "sm" | "base" | "lg" | "xl" | "2xl";
export type TextTone = "default" | "muted" | "subtle" | "emphasis" | "strong" | "danger";
export type TextAs = "span" | "p" | "div" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
export type TextWeight = "normal" | "medium" | "semibold" | "bold";

export interface TextProps {
  children: ReactNode;
  /** Semantic color. Default `"default"` (warm-900). */
  tone?: TextTone;
  /** Base font size. Default `"base"`. */
  size?: TextSize;
  /** Font weight. Default `"normal"`. */
  weight?: TextWeight;
  /** Element to render. Default `"span"`. */
  as?: TextAs;
  italic?: boolean;
  /** Fixed-width / monospace font. */
  mono?: boolean;
  /** Truncate with ellipsis on overflow. Needs a constrained width from the caller. */
  truncate?: boolean;
  /** Center the text. */
  center?: boolean;
  /** Uppercase with wide letter-spacing — typical for small section headings. */
  uppercase?: boolean;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
  title?: string;
}

const TONE_CLASSES: Record<TextTone, string> = {
  default: "text-warm-900",
  muted: "text-warm-500",
  subtle: "text-warm-600",
  emphasis: "text-warm-700",
  strong: "text-warm-900",
  danger: "text-danger-dark",
};

const SIZE_CLASSES: Record<TextSize, string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
};

const WEIGHT_CLASSES: Record<TextWeight, string> = {
  normal: "",
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
};

export function Text({
  children,
  tone = "default",
  size = "base",
  weight = "normal",
  as = "span",
  italic = false,
  mono = false,
  truncate = false,
  center = false,
  uppercase = false,
  className,
  title,
}: TextProps) {
  const classes = cn(
    TONE_CLASSES[tone],
    SIZE_CLASSES[size],
    WEIGHT_CLASSES[weight],
    italic ? "italic" : "",
    mono ? "font-mono" : "",
    truncate ? "truncate" : "",
    center ? "text-center" : "",
    uppercase ? "uppercase tracking-wide" : "",
    className,
  );

  if (as === "p") return <p className={classes} title={title}>{children}</p>;
  if (as === "div") return <div className={classes} title={title}>{children}</div>;
  if (as === "h1") return <h1 className={classes} title={title}>{children}</h1>;
  if (as === "h2") return <h2 className={classes} title={title}>{children}</h2>;
  if (as === "h3") return <h3 className={classes} title={title}>{children}</h3>;
  if (as === "h4") return <h4 className={classes} title={title}>{children}</h4>;
  if (as === "h5") return <h5 className={classes} title={title}>{children}</h5>;
  if (as === "h6") return <h6 className={classes} title={title}>{children}</h6>;
  return <span className={classes} title={title}>{children}</span>;
}
