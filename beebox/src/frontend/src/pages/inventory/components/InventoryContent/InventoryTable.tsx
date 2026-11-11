import type { RouterOutput } from "../../../../lib/trpc/client";
import { humanBytes } from "@shared/human-bytes";
import { Table, Td, Th } from "../../../../components/ui/Table";

type Summary = RouterOutput["inventory"]["summary"]["direct"][number];

export function InventoryTable({ items }: { items: Summary[] }) {
  const totalCount = items.reduce((sum, item) => sum + item.count, 0);
  const totalBytes = items.reduce((sum, item) => sum + item.bytes, 0);
  return (
    <Table caption="Inventory by type" captionHidden className="text-sm">
      <thead><tr><Th scope="col">Type</Th><Th scope="col" numeric>Count</Th><Th scope="col" numeric>Size</Th></tr></thead>
      <tbody>
        {items.map((item) => <tr key={item.type}><Td className="font-mono">{item.type}</Td><Td numeric>{item.count.toLocaleString()}</Td><Td numeric>{humanBytes(item.bytes)}</Td></tr>)}
      </tbody>
      <tfoot><tr className="font-semibold"><Td>Total</Td><Td numeric>{totalCount.toLocaleString()}</Td><Td numeric>{humanBytes(totalBytes)}</Td></tr></tfoot>
    </Table>
  );
}
