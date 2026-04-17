import { useEffect, useRef, useState, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export type ButtonIntent =
  | "primary"
  | "secondary"
  | "destructive"
  | "accent"
  | "success"
  | "ghost";

export type ButtonShape = "rect" | "circle";
export type ButtonSize = "sm" | "md" | "lg";

interface FlashSpec {
  label: ReactNode;
  /** Milliseconds to display after the action completes. Default 2000. */
  duration?: number;
}

type NativeButtonPassThrough = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "type" | "disabled" | "children" | "className" | "aria-label" | "aria-busy"
>;

interface CommonButtonProps extends NativeButtonPassThrough {
  /** `"button"` is explicit to avoid accidental form submission. */
  type: "button" | "submit" | "reset";
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  intent?: ButtonIntent;
  shape?: ButtonShape;
  size?: ButtonSize;
  disabled?: boolean;
  /** External override. Implicitly set while an `onClick` Promise is pending. */
  loading?: boolean;
  /**
   * Content shown in place of children while loading. Pass a function to opt
   * into the elapsed-seconds timer: `(secs) => \`Uploading… ${secs.toFixed(1)}s\``.
   */
  loadingLabel?: ReactNode | ((elapsedSeconds: number) => ReactNode);
  /** Brief post-click feedback ("Copied!" etc.). Fires after `onClick` resolves. */
  flash?: FlashSpec;
  /** `true` stretches the button to fill its parent's width. */
  fullWidth?: boolean;
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

interface LabeledButtonProps extends CommonButtonProps {
  children: ReactNode;
  icon?: ReactNode;
  /** Optional aria-label override. By default the visible text is used. */
  label?: string;
}

interface IconOnlyButtonProps extends CommonButtonProps {
  icon: ReactNode;
  /** Required for icon-only buttons — used as both `aria-label` and `title`. */
  label: string;
  children?: undefined;
}

export type ButtonProps = LabeledButtonProps | IconOnlyButtonProps;

// ---------- styling ----------

const INTENT_CLASSES: Record<ButtonIntent, string> = {
  primary: "bg-primary text-white hover:bg-primary-dark",
  secondary: "bg-warm-200 text-warm-800 hover:bg-warm-300",
  destructive: "bg-danger text-white hover:bg-danger-dark",
  accent: "bg-accent text-white hover:bg-accent-dark",
  success: "bg-success text-white hover:bg-success-dark",
  ghost: "bg-transparent text-warm-700 hover:bg-warm-100",
};

const RECT_SIZE: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-sm gap-1",
  md: "px-4 py-2 text-base gap-1.5",
  lg: "px-6 py-3 text-lg gap-2",
};

const CIRCLE_SIZE: Record<ButtonSize, string> = {
  sm: "w-8 h-8",
  md: "w-12 h-12",
  lg: "w-16 h-16",
};

const ICON_ONLY_RECT_SIZE: Record<ButtonSize, string> = {
  sm: "w-7 h-7",
  md: "w-9 h-9",
  lg: "w-11 h-11",
};

const BASE_CLASSES =
  "inline-flex items-center justify-center font-medium transition-colors select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:cursor-not-allowed";

interface ClassBuildOpts {
  intent: ButtonIntent;
  shape: ButtonShape;
  size: ButtonSize;
  iconOnly: boolean;
  fullWidth: boolean;
  extra: string | undefined;
}

function buildClasses({ intent, shape, size, iconOnly, fullWidth, extra }: ClassBuildOpts): string {
  const shapeClass = shape === "circle" ? "rounded-full" : "rounded";
  const sizeClass =
    shape === "circle"
      ? CIRCLE_SIZE[size]
      : iconOnly
        ? ICON_ONLY_RECT_SIZE[size]
        : RECT_SIZE[size];
  const widthClass = fullWidth && shape === "rect" ? "w-full" : "";
  return cn(BASE_CLASSES, INTENT_CLASSES[intent], shapeClass, sizeClass, widthClass, extra);
}

// ---------- spinner ----------

function Spinner() {
  return (
    <svg
      className="animate-spin w-4 h-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

// ---------- hooks ----------

function useElapsedSeconds(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const [prevActive, setPrevActive] = useState(active);
  if (prevActive !== active) {
    setPrevActive(active);
    if (!active) setElapsed(0);
  }
  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsed((Date.now() - start) / 1000);
    }, 100);
    return () => clearInterval(interval);
  }, [active]);
  return elapsed;
}

function useFlashState(): { flashing: boolean; triggerFlash: (duration: number) => void } {
  const [flashing, setFlashing] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
  }, []);
  const triggerFlash = (duration: number) => {
    setFlashing(true);
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setFlashing(false), duration);
  };
  return { flashing, triggerFlash };
}

// ---------- component ----------

export function Button(props: ButtonProps) {
  const {
    type,
    onClick,
    intent = "secondary",
    shape = "rect",
    size = "md",
    disabled = false,
    loading: loadingProp = false,
    loadingLabel,
    flash,
    fullWidth = false,
    icon,
    label,
    className,
    ...rest
  } = props;
  const children = "children" in props ? props.children : undefined;

  const [asyncLoading, setAsyncLoading] = useState(false);
  const loading = loadingProp || asyncLoading;
  const elapsed = useElapsedSeconds(loading && typeof loadingLabel === "function");
  const { flashing, triggerFlash } = useFlashState();

  const iconOnly = children === undefined;
  const isDisabled = disabled || loading;

  const handleClick = async (e: MouseEvent<HTMLButtonElement>) => {
    if (isDisabled || flashing) return;
    if (onClick === undefined) return;
    const result = onClick(e);
    if (result instanceof Promise) {
      setAsyncLoading(true);
      try {
        await result;
      } finally {
        setAsyncLoading(false);
      }
    }
    if (flash !== undefined) {
      triggerFlash(flash.duration !== undefined ? flash.duration : 2000);
    }
  };

  // Content rendering
  let content: ReactNode;
  if (flashing && flash !== undefined) {
    content = <span>{flash.label}</span>;
  } else if (loading) {
    const resolvedLoading = typeof loadingLabel === "function" ? loadingLabel(elapsed) : loadingLabel;
    content = (
      <>
        <Spinner />
        {resolvedLoading !== undefined ? <span>{resolvedLoading}</span> : children !== undefined ? <span>{children}</span> : null}
      </>
    );
  } else if (iconOnly) {
    content = icon;
  } else {
    content = (
      <>
        {icon !== undefined ? icon : null}
        <span>{children}</span>
      </>
    );
  }

  const ariaLabel = label !== undefined ? label : undefined;
  const titleFallback = iconOnly && label !== undefined ? label : undefined;

  return (
    <button
      {...rest}
      type={type}
      disabled={isDisabled}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      title={"title" in rest && rest.title !== undefined ? rest.title : titleFallback}
      className={buildClasses({ intent, shape, size, iconOnly, fullWidth, extra: className })}
      onClick={handleClick}
    >
      {content}
    </button>
  );
}
