import type { ReactNode } from "react";
import { Card } from "../ui/Card";
import { Heading } from "../ui/Heading";
import { Hint } from "../ui/Hint";
import { Stack } from "../ui/Stack";
import { Row } from "../ui/Row";
import { Badge } from "../ui/Badge";
import { ADMIN_SCOPE_LABELS, ADMIN_SECTIONS, adminSectionElementId, adminSectionHeadingId, type AdminSectionId } from "./admin-sections";

/**
 * The landmark every admin section renders: a `section` named by its heading,
 * with the section's `bbx-admin-<id>` address. The heading text comes from
 * the registry so the name on the page, in the overview, and in the
 * accessibility tree is the same string. The scope badge (this box, whole
 * host, this device) comes from the registry too.
 */
export function AdminSectionCard({ id, description, busy, children }: { id: AdminSectionId; description?: ReactNode; busy?: boolean; children: ReactNode }) {
  const headingId = adminSectionHeadingId(id);
  const section = ADMIN_SECTIONS[id];
  return (
    <Card as="section" id={adminSectionElementId(id)} aria-labelledby={headingId} aria-busy={busy} shadow>
      <Stack gap="md">
        <Stack gap="xs">
          <Row wrap gap="sm" align="center">
            <Heading level={2} id={headingId}>{section.title}</Heading>
            <Badge size="sm">{ADMIN_SCOPE_LABELS[section.scope]}</Badge>
          </Row>
          {description === undefined ? null : <Hint>{description}</Hint>}
        </Stack>
        {children}
      </Stack>
    </Card>
  );
}
