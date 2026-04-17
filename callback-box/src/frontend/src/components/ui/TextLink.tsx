import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export type TextLinkTone = "default" | "subtle";

export interface TextLinkProps {
  to: string;
  children: ReactNode;
  /** Color. Default `"default"` (plum). `"subtle"` for dim contexts. */
  tone?: TextLinkTone;
  /** Underline the link text on hover. Default true. */
  underline?: boolean;
  onClick?: () => void;
  title?: string;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

const TONE_CLASSES: Record<TextLinkTone, string> = {
  default: "text-plum hover:text-plum-dark",
  subtle: "text-warm-600 hover:text-warm-900",
};

export function TextLink({
  to,
  children,
  tone = "default",
  underline = true,
  onClick,
  title,
  className,
}: TextLinkProps) {
  const classes = [
    TONE_CLASSES[tone],
    underline ? "hover:underline" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Link to={to} onClick={onClick} title={title} className={classes}>
      {children}
    </Link>
  );
}
