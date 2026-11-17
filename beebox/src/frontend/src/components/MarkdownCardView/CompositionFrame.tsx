import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { controlAddress } from "@shared/ui-scan/control-address";
import { Button } from "../ui/Button";
import { ErrorText } from "../ui/ErrorText";
import { Row } from "../ui/Row";

/** The editor's frame, rendered where the composition block stands; nothing while the block is not mounted. */
export function CompositionFrame({ host, children }: { host: HTMLElement | null; children: ReactNode }): ReactNode {
  if (host === null) return null;
  return createPortal(<section aria-label="Composition editor" className="bbx-composition bbx-composition-editor my-4 rounded border border-card-pen">{children}</section>, host);
}

/** Failed-read body shared by the editor and its development specimen. */
export function CompositionReadError({ message, instance, onClose }: { message: string; instance: string; onClose: () => void }): ReactNode {
  return <Row gap="sm" align="center" justify="between" className="px-2 py-1">
    <ErrorText>{message}</ErrorText>
    <Button id={controlAddress("bbx-composition-close", instance)} label="Done editing composition" size="sm" intent="secondary" onClick={onClose}>Done</Button>
  </Row>;
}
