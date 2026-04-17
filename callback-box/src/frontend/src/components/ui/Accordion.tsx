import { useId, useState, type ReactNode } from "react";

export interface AccordionProps {
  /** Content shown in the collapsed header row. */
  title: ReactNode;
  children: ReactNode;
  /** Initial open state when uncontrolled. Default `false`. */
  defaultOpen?: boolean;
  /** Controlled open state. When provided, use with `onOpenChange`. */
  open?: boolean;
  /** Called when the user toggles the accordion. */
  onOpenChange?: (open: boolean) => void;
  /** Visual style. Default `"bordered"` — a boxed card. `"plain"` has no border/padding. */
  variant?: "bordered" | "plain";
  disabled?: boolean;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`text-warm-400 text-xs transition-transform ${open ? "rotate-90" : ""}`}
    >
      &#9654;
    </span>
  );
}

export function Accordion({
  title,
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  variant = "bordered",
  disabled = false,
}: AccordionProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen !== undefined ? controlledOpen : uncontrolledOpen;
  const bodyId = useId();

  const toggle = () => {
    if (disabled) return;
    const next = !open;
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    if (onOpenChange !== undefined) onOpenChange(next);
  };

  const shellClass =
    variant === "bordered" ? "border border-warm-200 rounded-lg overflow-hidden" : "";
  const buttonClass =
    variant === "bordered"
      ? "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-warm-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-60 disabled:cursor-not-allowed"
      : "w-full flex items-center gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-60 disabled:cursor-not-allowed";
  const bodyClass = variant === "bordered" ? "border-t border-warm-200 px-3 py-2" : "mt-2";

  return (
    <div className={shellClass}>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={bodyId}
        className={buttonClass}
      >
        <Chevron open={open} />
        <span className="flex-1 min-w-0">{title}</span>
      </button>
      {open ? (
        <div id={bodyId} role="region">
          {variant === "bordered" ? (
            <div className={bodyClass}>{children}</div>
          ) : (
            <div className={bodyClass}>{children}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
