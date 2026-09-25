import { Card } from "../ui/Card";
import { Heading } from "../ui/Heading";
import { Hint } from "../ui/Hint";
import { Stack } from "../ui/Stack";
import { ADMIN_GROUPS, type AdminSectionId } from "./admin-sections";
import { AdminOverviewRow } from "./AdminOverviewRow";
import { useAdminOverview } from "./use-admin-overview";

/**
 * The admin page's default tab: one card per group, and for each section its
 * current state, so configured state is visible without opening every tab.
 */
export function AdminOverview({ onOpenSection }: { onOpenSection: (id: AdminSectionId) => void }) {
  const statuses = useAdminOverview();
  return (
    <Stack gap="lg">
      {ADMIN_GROUPS.map(group => (
        <Card key={group.tab} as="section" id={`bbx-admin-overview-${group.tab}`} aria-label={group.label} shadow>
          <Stack gap="md">
            <Stack gap="xs">
              <Heading level={2}>{group.label}</Heading>
              <Hint>{group.description}</Hint>
            </Stack>
            {group.sections.map(id => <AdminOverviewRow key={id} id={id} status={statuses[id]} onOpen={() => onOpenSection(id)} />)}
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}
