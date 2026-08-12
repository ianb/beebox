import type { Dispatch, SetStateAction } from "react";
import type { RouterOutput } from "../../../lib/trpc";
import { formatBytes } from "../../../lib/format-bytes";
import { Card } from "../../../components/ui/Card";
import { Row } from "../../../components/ui/Row";
import { Stack } from "../../../components/ui/Stack";
import { TabBar } from "../../../components/ui/TabBar";
import { Text } from "../../../components/ui/Text";
import { InventoryTable } from "./InventoryTable";
import { InventoryTreemap } from "./InventoryTreemap";

type Inventory = RouterOutput["inventory"]["summary"];
type Projection = "grouped" | "direct";
type Metric = "count" | "bytes";
type LinkStatus = "all" | "linked" | "unlinked";

interface InventoryContentProps {
  data: Inventory;
  metric: Metric;
  linkStatus: LinkStatus;
  projection: Projection;
  setMetric: Dispatch<SetStateAction<Metric>>;
  setLinkStatus: Dispatch<SetStateAction<LinkStatus>>;
  setProjection: Dispatch<SetStateAction<Projection>>;
}

export function InventoryContent({ data, metric, linkStatus, projection, setMetric, setLinkStatus, setProjection }: InventoryContentProps) {
  if (data.totals.files === 0) return <InventoryEmpty />;
  const slice = linkStatus === "all" ? data : data.byLinkStatus[linkStatus];
  const items = projection === "grouped" ? slice.grouped : slice.direct;
  return (
    <>
      <InventorySummary data={data} linkStatus={linkStatus} />
      <InventoryArea
        items={items}
        metric={metric}
        linkStatus={linkStatus}
        projection={projection}
        setMetric={setMetric}
        setLinkStatus={setLinkStatus}
        setProjection={setProjection}
      />
      <InventoryDataTable items={items} linkStatus={linkStatus} projection={projection} />
      <InventoryRules data={data} />
    </>
  );
}

function InventoryEmpty() {
  return (
    <Card>
      <Text as="h2" size="lg" weight="semibold">No content files found</Text>
      <Text as="p" tone="muted" className="mt-1">The scan excludes runtime and dependency directories.</Text>
    </Card>
  );
}

function InventorySummary({ data, linkStatus }: { data: Inventory; linkStatus: LinkStatus }) {
  return (
    <Card as="section" aria-label="Inventory summary">
      <Stack gap="md">
        {data.complete ? null : <Text as="p" tone="danger" size="sm">This scan is partial because {data.skippedPaths.toLocaleString()} filesystem path(s) could not be read. Totals are lower bounds.</Text>}
        {data.linkStatusComplete ? null : <Text as="p" tone="danger" size="sm">Incoming-reference detection is partial. Linked contains confirmed matches; Unlinked may include cards whose referrers could not be read.</Text>}
        <Text as="div" size="xs" tone="muted" uppercase>{linkStatus === "all" ? "Whole box" : "Whole-box totals"}</Text>
        <Row gap="lg" wrap>
          <InventoryStatistic value={data.totals.files.toLocaleString()} label="physical files" />
          <InventoryStatistic value={formatBytes(data.totals.bytes)} label="content size" />
          <InventoryStatistic value={data.totals.groupedItems.toLocaleString()} label="grouped items" />
        </Row>
      </Stack>
    </Card>
  );
}

function InventoryStatistic({ value, label }: { value: string; label: string }) {
  return (
    <Stack gap="none">
      <Text as="div" size="2xl" weight="bold">{value}</Text>
      <Text as="div" size="sm" tone="muted">{label}</Text>
    </Stack>
  );
}

function InventoryArea({ items, metric, linkStatus, projection, setMetric, setLinkStatus, setProjection }: {
  items: Inventory["direct"];
  metric: Metric;
  linkStatus: LinkStatus;
  projection: Projection;
  setMetric: Dispatch<SetStateAction<Metric>>;
  setLinkStatus: Dispatch<SetStateAction<LinkStatus>>;
  setProjection: Dispatch<SetStateAction<Projection>>;
}) {
  return (
    <Card as="section" aria-label="Inventory area view">
      <Stack gap="md">
        <Text as="h2" size="lg" weight="semibold">Area view</Text>
        <TabBar value={linkStatus} onChange={setLinkStatus} label="Incoming reference filter" tabs={[{ value: "all", label: "All" }, { value: "linked", label: "Linked" }, { value: "unlinked", label: "Unlinked" }]} />
        <Row justify="between" align="end" wrap>
          <TabBar value={projection} onChange={setProjection} label="Counting method" tabs={[{ value: "grouped", label: "Grouped" }, { value: "direct", label: "Direct" }]} />
          <TabBar value={metric} onChange={setMetric} label="Area metric" tabs={[{ value: "count", label: "By count" }, { value: "bytes", label: "By size" }]} />
        </Row>
        {items.length === 0 ? <Text as="p" tone="muted">{linkStatus === "all" ? "No content files found." : `No ${linkStatus} cards found.`}</Text> : <InventoryTreemap items={items} metric={metric} />}
      </Stack>
    </Card>
  );
}

function InventoryDataTable({ items, linkStatus, projection }: { items: Inventory["direct"]; linkStatus: LinkStatus; projection: Projection }) {
  return (
    <Card as="section" aria-label={`${projection} inventory table`}>
      <Stack gap="md">
        <Text as="h2" size="lg" weight="semibold">{linkStatus === "all" ? "All content" : `${linkStatus === "linked" ? "Linked" : "Unlinked"} cards`} — {projection === "grouped" ? "grouped" : "direct files"}</Text>
        {items.length === 0 ? <Text as="p" tone="muted">No matching cards.</Text> : <InventoryTable items={items} />}
      </Stack>
    </Card>
  );
}

function InventoryRules({ data }: { data: Inventory }) {
  return (
    <Card background="warm" as="section" aria-label="Counting rules">
      <Stack gap="sm">
        <Text as="h2" size="lg" weight="semibold">What the numbers mean</Text>
        <Text as="p" size="sm"><Text weight="semibold">Grouped:</Text> each <Text mono>Name.type.card</Text> and its sibling <Text mono>Name.attach/</Text> directory count as one item of that card type. Loose files remain grouped by extension.</Text>
        <Text as="p" size="sm"><Text weight="semibold">Direct:</Text> every regular file and symlink counts separately by card type or final extension. Symlink sizes follow their targets when available; dangling links use the link size.</Text>
        <Text as="p" size="sm"><Text weight="semibold">Linked:</Text> a card has at least one detected incoming reference from another card, authored Markdown file, or box view, using the same recognized ref forms as <Text mono>cb mv</Text>. References to its attachments count; self-references do not. Tooling/generated Markdown and temporary cards are not referrers. Loose files and orphan attachment directories appear only under All.</Text>
        <Text as="p" size="sm">Orphaned <Text mono>.attach/</Text> directories with no owning card appear as their own grouped row. Found: {data.orphanAttachmentDirectories.toLocaleString()}.</Text>
        <Text as="p" size="sm">Excluded from both views: {data.excludedDirectories.join(", ")}. Directories themselves are not counted. Last scanned {new Date(data.scannedAt).toLocaleString()}.</Text>
      </Stack>
    </Card>
  );
}
