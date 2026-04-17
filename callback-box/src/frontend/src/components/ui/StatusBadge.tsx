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

export function StatusBadge({ status, size, children, className, title }: StatusBadgeProps) {
  const tone = (STATUS_TONE as Record<string, BadgeTone>)[status] ?? "neutral";
  return (
    <Badge tone={tone} size={size} className={className} title={title}>
      {children ?? status}
    </Badge>
  );
}
