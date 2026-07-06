import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export type InlineActionIntent = "emphatic" | "subtle" | "danger";

interface FlashSpec {
  label: ReactNode;
  duration?: number;
}

export interface InlineActionProps {
  children: ReactNode;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  intent?: InlineActionIntent;
  disabled?: boolean;
  title?: string;
  flash?: FlashSpec;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

const INTENT_CLASSES: Record<InlineActionIntent, string> = {
  emphatic: "text-primary hover:text-primary-dark underline",
  subtle: "text-warm-600 hover:text-warm-900 underline",
  danger: "text-danger hover:text-danger-dark underline",
};

export function InlineAction({
  children,
  onClick,
  intent: intentArg,
  disabled: disabledArg,
  title,
  flash,
  className,
}: InlineActionProps) {
  const intent = intentArg ?? "emphatic";
  const disabled = disabledArg ?? false;
  const [pending, setPending] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const flashTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (flashTimeout.current !== null) clearTimeout(flashTimeout.current);
  }, []);

  const isBusy = disabled || pending || flashing;

  const handleClick = async (e: MouseEvent<HTMLButtonElement>) => {
    if (isBusy) return;
    const result = onClick(e);
    if (result instanceof Promise) {
      setPending(true);
      try {
        await result;
      } catch (err) {
        // Safety net for this shared primitive, same as Button.tsx: callers
        // are expected to surface their own user-visible errors.
        console.error("[InlineAction] onClick handler threw:", err);
      } finally {
        setPending(false);
      }
    }
    if (flash !== undefined) {
      setFlashing(true);
      if (flashTimeout.current !== null) clearTimeout(flashTimeout.current);
      flashTimeout.current = setTimeout(() => setFlashing(false), flash.duration !== undefined ? flash.duration : 2000);
    }
  };

  const content: ReactNode = flashing && flash !== undefined ? flash.label : children;

  return (
    <button
      type="button"
      onClick={(e) => void handleClick(e)}
      disabled={isBusy}
      title={title}
      className={cn(
        INTENT_CLASSES[intent],
        "cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm",
        className,
      )}
    >
      {content}
    </button>
  );
}
