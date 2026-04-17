import { Button } from "./Button";

export interface CancelButtonProps {
  onClick: () => void;
  /** Custom label. Default `"Cancel"`. */
  children?: string;
  disabled?: boolean;
  size?: "sm" | "md";
}

export function CancelButton({ onClick, children = "Cancel", disabled = false, size = "md" }: CancelButtonProps) {
  return (
    <Button type="button" intent="secondary" size={size} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  );
}
