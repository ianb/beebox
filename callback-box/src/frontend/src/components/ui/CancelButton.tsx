import { Button } from "./Button";

export interface CancelButtonProps {
  onClick: () => void;
  /** Custom label. Default `"Cancel"`. */
  children?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  /** Outer-layout classes (margin, padding, flex item, sizing, position). */
  className?: string;
}

export function CancelButton({ onClick, children = "Cancel", disabled = false, size = "md", className }: CancelButtonProps) {
  return (
    <Button type="button" intent="secondary" size={size} disabled={disabled} onClick={onClick} className={className}>
      {children}
    </Button>
  );
}
