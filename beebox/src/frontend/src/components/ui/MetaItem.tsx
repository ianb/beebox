import type { ReactNode } from "react";
import { Text } from "./Text";

/** Small uppercase label followed by its value, for a document's metadata row. */
export function MetaItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Text size="xs" tone="muted">
      <span className="uppercase tracking-wide">{label}</span>{" "}
      <span className="text-warm-700">{children}</span>
    </Text>
  );
}
