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
      <RepositorySummary data={data} />
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

function RepositorySummary({ data }: { data: Inventory }) {
  const { repository } = data;
  const annexedPercent = percent(repository.storage.all.annexed.bytes, repository.storage.all);
  return (
    <Card as="section" aria-label="Git repository summary">
      <Stack gap="md">
        <Text as="h2" size="lg" weight="semibold">Git storage</Text>
        <Row gap="lg" wrap>
          <InventoryStatistic value={formatBytes(repository.checkoutDiskBytes)} label="repository footprint" />
          <InventoryStatistic value={formatBytes(repository.gitDiskBytes)} label="of that, Git storage" />
          <InventoryStatistic value={repository.annexed ? repository.annexQueryAvailable ? `${annexedPercent}%` : "Unavailable" : "Not enabled"} label="logical content annexed" />
        </Row>
        {repository.complete ? null : <Text as="p" tone="danger" size="sm">Repository footprint is a lower bound because some paths could not be read.</Text>}
        {repository.annexed && !repository.annexQueryAvailable ? <Text as="p" tone="danger" size="sm">Git-annex accounting is unavailable; no annex percentage or breakdown is shown.</Text> : null}
        {repository.annexed && repository.annexQueryAvailable ? <StorageTable storage={repository.storage} /> : repository.annexed ? null : <Text as="p" tone="muted" size="sm">This repository is not using Git-annex.</Text>}
      </Stack>
    </Card>
  );
}

function percent(bytes: number, storage: Inventory["repository"]["storage"]["all"]): string {
  const total = storage.annexed.bytes + storage.regular.bytes;
  return total === 0 ? "0" : (bytes / total * 100).toFixed(1);
}

function StorageTable({ storage }: { storage: Inventory["repository"]["storage"] }) {
  const columns = [
    { label: "All", value: storage.all },
    { label: "Linked", value: storage.linked },
    { label: "Unlinked", value: storage.unlinked },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-b border-warm-300 text-left text-warm-600"><th className="py-2 pr-3 font-medium">Storage</th>{columns.map((column) => <th key={column.label} className="py-2 px-3 text-right font-medium">{column.label}</th>)}</tr></thead>
        <tbody>
          <StorageRow label="Annexed" columns={columns.map((column) => column.value.annexed)} />
          <StorageRow label="Regular Git" columns={columns.map((column) => column.value.regular)} />
        </tbody>
      </table>
      <Text as="p" size="xs" tone="muted" className="mt-2">Cells show logical content size and physical file count; annex sizes include content not fetched locally. Repository footprint includes dependencies and Git storage, and Git storage is part of that total. Loose files appear only under All.</Text>
    </div>
  );
}

function StorageRow({ label, columns }: { label: string; columns: Array<{ files: number; bytes: number }> }) {
  return (
    <tr className="border-b border-warm-200">
      <td className="py-2 pr-3 font-medium">{label}</td>
      {columns.map((column, index) => <td key={index} className="py-2 px-3 text-right tabular-nums">{formatBytes(column.bytes)} <span className="text-warm-500">· {column.files.toLocaleString()}</span></td>)}
    </tr>
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
        <TabBar value={linkStatus} onChange={setLinkStatus} idPrefix="bbx-inventory-link-status" label="Incoming reference filter" tabs={[{ value: "all", label: "All" }, { value: "linked", label: "Linked" }, { value: "unlinked", label: "Unlinked" }]} />
        <Row justify="between" align="end" wrap>
          <TabBar value={projection} onChange={setProjection} idPrefix="bbx-inventory-projection" label="Counting method" tabs={[{ value: "grouped", label: "Grouped" }, { value: "direct", label: "Direct" }]} />
          <TabBar value={metric} onChange={setMetric} idPrefix="bbx-inventory-metric" label="Area metric" tabs={[{ value: "count", label: "By count" }, { value: "bytes", label: "By size" }]} />
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
        <Text as="p" size="sm"><Text weight="semibold">Linked:</Text> a card has at least one detected incoming reference from another card, authored Markdown file, or box view, using the same recognized ref forms as <Text mono>bbx mv</Text>. References to its attachments count; self-references do not. Tooling/generated Markdown and temporary cards are not referrers. Loose files and orphan attachment directories appear only under All.</Text>
        <Text as="p" size="sm">Orphaned <Text mono>.attach/</Text> directories with no owning card appear as their own grouped row. Found: {data.orphanAttachmentDirectories.toLocaleString()}.</Text>
        <Text as="p" size="sm">Excluded from both views: {data.excludedDirectories.join(", ")}. Directories themselves are not counted. Last scanned {new Date(data.scannedAt).toLocaleString()}.</Text>
      </Stack>
    </Card>
  );
}
