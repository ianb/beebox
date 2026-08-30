import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type AvatarSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: "w-6 h-6 text-[10px]",
  md: "w-7 h-7 text-xs",
  lg: "w-10 h-10 text-sm",
};

export interface AvatarProps {
  /** Display name — used for the initial fallback and as the default aria-label. */
  name: string | null;
  /** Email — used for the initial fallback when no name is provided. */
  email?: string | null;
  /** Profile image URL. Falls back to initial if omitted or fails to load. */
  picture?: string | null;
  size?: AvatarSize;
  /** Fill styling for the initial/empty state — useful for dark nav contexts. */
  fallbackClassName?: string;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

function GenericUserIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-full h-full p-0.5" aria-hidden="true">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 8.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM10 9.5c-2.5 0-4 1.5-4 3v.5h8v-.5c0-1.5-1.5-3-4-3z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Avatar({
  name,
  email,
  picture,
  size,
  fallbackClassName,
  className,
}: AvatarProps) {
  size = size ?? "md";
  fallbackClassName = fallbackClassName ?? "bg-warm-200 text-warm-700";
  const altText = name !== null ? name : email !== null && email !== undefined ? email : "User";
  const initialSource = name !== null && name !== "" ? name : email !== null && email !== undefined ? email : null;
  const initial = initialSource !== null ? initialSource.charAt(0).toUpperCase() : null;

  if (picture !== null && picture !== undefined && picture !== "") {
    return (
      <img
        src={picture}
        alt={altText}
        className={cn(SIZE_CLASSES[size], "rounded-full object-cover", className)}
        referrerPolicy="no-referrer"
      />
    );
  }

  const fallbackContent: ReactNode = initial !== null ? initial : <GenericUserIcon />;
  return (
    <span
      aria-label={altText}
      role="img"
      className={cn(SIZE_CLASSES[size], "rounded-full font-bold flex items-center justify-center select-none", fallbackClassName, className)}
    >
      {fallbackContent}
    </span>
  );
}
