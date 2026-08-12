import type { RouterOutput } from "../../../lib/trpc";
import { formatBytes } from "../../../lib/format-bytes";

type Summary = RouterOutput["inventory"]["summary"]["direct"][number];

export function InventoryTable({ items }: { items: Summary[] }) {
  const totalCount = items.reduce((sum, item) => sum + item.count, 0);
  const totalBytes = items.reduce((sum, item) => sum + item.bytes, 0);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead><tr className="border-b border-warm-300 text-left text-warm-600"><th className="py-2 pr-3 font-medium">Type</th><th className="py-2 px-3 text-right font-medium">Count</th><th className="py-2 pl-3 text-right font-medium">Size</th></tr></thead>
        <tbody>
          {items.map((item) => <tr key={item.type} className="border-b border-warm-200"><td className="py-2 pr-3 font-mono">{item.type}</td><td className="py-2 px-3 text-right tabular-nums">{item.count.toLocaleString()}</td><td className="py-2 pl-3 text-right tabular-nums">{formatBytes(item.bytes)}</td></tr>)}
        </tbody>
        <tfoot><tr className="font-semibold"><td className="pt-2 pr-3">Total</td><td className="pt-2 px-3 text-right tabular-nums">{totalCount.toLocaleString()}</td><td className="pt-2 pl-3 text-right tabular-nums">{formatBytes(totalBytes)}</td></tr></tfoot>
      </table>
    </div>
  );
}
