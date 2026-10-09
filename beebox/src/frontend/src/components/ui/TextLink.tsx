import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type TextLinkTone = "default" | "subtle";

export interface TextLinkProps {
  to: string;
  /** Query state for routes whose path is built dynamically. */
  search?: never;
  /** Stable `bbx-` control address for the rendered link (see lib/ui-scan). */
  id?: string;
  children: ReactNode;
  /** Color. Default `"default"` (primary). `"subtle"` for dim contexts. */
  tone?: TextLinkTone;
  /** Underline the link text on hover. Default true. */
  underline?: boolean;
  onClick?: () => void;
  title?: string;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
  /** Take the colours from the enclosing card's material. */
  material?: boolean;
}

const TONE_CLASSES: Record<TextLinkTone, string> = {
  default: "text-primary hover:text-primary-dark",
  subtle: "text-warm-600 hover:text-warm-900",
};

const MATERIAL_TONE_CLASSES: Record<TextLinkTone, string> = {
  default: "text-card-pen hover:text-card-ink",
  subtle: "text-card-soft hover:text-card-ink",
};

export function TextLink({
  to,
  search,
  id,
  children,
  tone: toneArg,
  underline: underlineArg,
  onClick,
  title,
  className,
  material,
}: TextLinkProps) {
  const tone = toneArg ?? "default";
  const underline = underlineArg ?? true;
  const classes = cn(material === true ? MATERIAL_TONE_CLASSES[tone] : TONE_CLASSES[tone], underline ? "hover:underline" : "", className);
  return (
    <Link id={id} to={to} search={search} onClick={onClick} title={title} className={classes}>
      {children}
    </Link>
  );
}
