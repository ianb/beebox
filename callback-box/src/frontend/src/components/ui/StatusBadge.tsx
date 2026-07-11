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
}

function isCardStatus(status: string): status is CardStatus {
  return status in STATUS_TONE;
}

export function StatusBadge({ status, size, children, className, title }: StatusBadgeProps) {
  const tone = isCardStatus(status) ? STATUS_TONE[status] : "neutral";
  return (
    <Badge tone={tone} size={size} className={className} title={title}>
      {children ?? status}
    </Badge>
  );
}
