import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ErrorText } from "../ui/ErrorText";
import { Hint } from "../ui/Hint";
import { Row } from "../ui/Row";
import { Stack } from "../ui/Stack";
import { Text } from "../ui/Text";
import { ADMIN_SCOPE_LABELS, ADMIN_SECTIONS, type AdminSectionId } from "./admin-sections";
import type { AdminSectionStatus } from "./use-admin-overview";

function SectionStatus({ status }: { status: AdminSectionStatus }) {
  switch (status.state) {
    case "loading":
      return <span aria-busy="true"><Text size="sm" tone="muted">Checking…</Text></span>;
    case "error":
      return <ErrorText>{status.message}</ErrorText>;
    case "ready":
      return <Badge tone={status.tone} className="break-words">{status.summary}</Badge>;
  }
}

/** One section on the overview: its name (opens it), where it applies, its state, and what it is for. */
export function AdminOverviewRow({ id, status, onOpen }: { id: AdminSectionId; status: AdminSectionStatus; onOpen: () => void }) {
  const section = ADMIN_SECTIONS[id];
  return (
    <Stack gap="xs">
      <Row wrap gap="sm" justify="between">
        <Row wrap gap="xs">
          <Button intent="ghost" size="sm" id={`bbx-admin-overview-${id}`} className="-ml-2.5" onClick={onOpen}>{section.title}</Button>
          <Badge size="sm">{ADMIN_SCOPE_LABELS[section.scope]}</Badge>
        </Row>
        <SectionStatus status={status} />
      </Row>
      <Hint>{section.blurb}</Hint>
    </Stack>
  );
}
