import type { ReactNode } from "react";
import { Badge, type BadgeSize, type BadgeTone } from "./Badge";

export type CardStatus = "new" | "pending" | "answered" | "processing" | "processed";

const STATUS_TONE: Record<CardStatus, BadgeTone> = {
  new: "info",
  pending: "warning",
  answered: "success",
  processing: "accent",
  processed: "neutral",
};

export interface StatusBadgeProps {
  status: string;
  size?: BadgeSize;
  children?: ReactNode;
  className?: string;
  title?: string;
  /** On a card's material: the material's tint and soft ink, in place of the status color. */
  material?: boolean;
}

function isCardStatus(status: string): status is CardStatus {
  return status in STATUS_TONE;
}

export function StatusBadge({ status, size, children, className, title, material }: StatusBadgeProps) {
  const tone = material === true || !isCardStatus(status) ? "neutral" : STATUS_TONE[status];
  return (
    <Badge tone={tone} size={size} className={className} title={title} material={material}>
      {children ?? status}
    </Badge>
  );
}
