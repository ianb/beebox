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

interface InventoryContentProps {
  data: Inventory;
  metric: Metric;
  projection: Projection;
  setMetric: Dispatch<SetStateAction<Metric>>;
  setProjection: Dispatch<SetStateAction<Projection>>;
}

export function InventoryContent({ data, metric, projection, setMetric, setProjection }: InventoryContentProps) {
  if (data.totals.files === 0) return <InventoryEmpty />;
  const items = projection === "grouped" ? data.grouped : data.direct;
  return (
    <>
      <InventorySummary data={data} />
      <InventoryArea
        items={items}
        metric={metric}
        projection={projection}
        setMetric={setMetric}
        setProjection={setProjection}
      />
      <InventoryDataTable items={items} projection={projection} />
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

function InventorySummary({ data }: { data: Inventory }) {
  return (
    <Card as="section" aria-label="Inventory summary">
      <Stack gap="md">
        {data.complete ? null : <Text as="p" tone="danger" size="sm">This scan is partial because {data.skippedPaths.toLocaleString()} filesystem path(s) could not be read. Totals are lower bounds.</Text>}
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

function InventoryArea({ items, metric, projection, setMetric, setProjection }: {
  items: Inventory["direct"];
  metric: Metric;
  projection: Projection;
  setMetric: Dispatch<SetStateAction<Metric>>;
  setProjection: Dispatch<SetStateAction<Projection>>;
}) {
  return (
    <Card as="section" aria-label="Inventory area view">
      <Stack gap="md">
        <Text as="h2" size="lg" weight="semibold">Area view</Text>
        <Row justify="between" align="end" wrap>
          <TabBar value={projection} onChange={setProjection} label="Counting method" tabs={[{ value: "grouped", label: "Grouped" }, { value: "direct", label: "Direct" }]} />
          <TabBar value={metric} onChange={setMetric} label="Area metric" tabs={[{ value: "count", label: "By count" }, { value: "bytes", label: "By size" }]} />
        </Row>
        <InventoryTreemap items={items} metric={metric} />
      </Stack>
    </Card>
  );
}

function InventoryDataTable({ items, projection }: { items: Inventory["direct"]; projection: Projection }) {
  return (
    <Card as="section" aria-label={`${projection} inventory table`}>
      <Stack gap="md">
        <Text as="h2" size="lg" weight="semibold">{projection === "grouped" ? "Grouped content" : "Direct disk files"}</Text>
        <InventoryTable items={items} />
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
        <Text as="p" size="sm">Orphaned <Text mono>.attach/</Text> directories with no owning card appear as their own grouped row. Found: {data.orphanAttachmentDirectories.toLocaleString()}.</Text>
        <Text as="p" size="sm">Excluded from both views: {data.excludedDirectories.join(", ")}. Directories themselves are not counted. Last scanned {new Date(data.scannedAt).toLocaleString()}.</Text>
      </Stack>
    </Card>
  );
}
