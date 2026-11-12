// Table: a required, non-empty name; one scroll container, which is a named,
// focusable region; header cells with a scope; cell attributes forwarded. The
// two JSX content renderers (Docling tables and SheetTable) use the grid
// variant under the same contract.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount, type Mounted } from "../../helpers/dom-harness.js";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { Table, Td, Th, type TableProps } from "../../../src/components/ui/Table.js";
import { DoclingPageSection } from "../../../src/components/DoclingView/DoclingPageSection.js";
import { SheetTable } from "../../../src/components/SheetTable.js";

/** The scroll wrapper, the table, and how each is named. */
function shape(view: Mounted): { region: { role: string | null; tabindex: string | null; name: string; classes: string[] }; table: { labelledby: string | null; caption: string | null; captionClasses: string[] } } {
  const wrapper = view.container.querySelector("[role=region]");
  const table = view.container.querySelector("table");
  const caption = table?.querySelector("caption") ?? null;
  const labelledBy = wrapper?.getAttribute("aria-labelledby") ?? "";
  return {
    region: {
      role: wrapper?.getAttribute("role") ?? null,
      tabindex: wrapper?.getAttribute("tabindex") ?? null,
      name: document.getElementById(labelledBy)?.textContent ?? "",
      classes: [...(wrapper?.classList ?? [])],
    },
    table: {
      labelledby: table?.getAttribute("aria-labelledby") ?? null,
      caption: caption?.textContent ?? null,
      captionClasses: [...(caption?.classList ?? [])],
    },
  };
}

const body = (): ReactNode => h("tbody", null, h("tr", null, h(Td, null, "1")));
const FOCUS = ["focus:outline-none", "focus-visible:ring-2", "focus-visible:ring-inset", "focus-visible:ring-accent"];

void test("a caption names both the table and its scroll region", async (t) => {
  const view = await mount(h(Table, { caption: "Inventory by type", children: body() }));
  t.check(shape(view), {
    region: { role: "region", tabindex: "0", name: "Inventory by type", classes: ["overflow-x-auto", ...FOCUS] },
    table: { labelledby: null, caption: "Inventory by type", captionClasses: ["pb-1", "text-left", "text-sm", "text-warm-700"] },
  });
  await view.unmount();
});

void test("a hidden caption is for screen readers only", async (t) => {
  const view = await mount(h(Table, { caption: "Batch records", captionHidden: true, children: body() }));
  t.check(shape(view).table.captionClasses, ["sr-only"]);
  await view.unmount();
});

void test("labelledBy names the table and region by a visible heading", async (t) => {
  const view = await mount(h("div", null,
    h("h2", { id: "runs-heading" }, "Runs"),
    h(Table, { labelledBy: "runs-heading", scroll: "both", className: "text-sm", children: body() })));
  t.check(shape(view), {
    region: { role: "region", tabindex: "0", name: "Runs", classes: ["overflow-auto", ...FOCUS, "text-sm"] },
    table: { labelledby: "runs-heading", caption: null, captionClasses: [] },
  });
  await view.unmount();
});

void test("an empty caption fails", async (t) => {
  const props: TableProps = { caption: " ", children: body() };
  await t.checkThrows(() => renderToStaticMarkup(h(Table, props)), "InvariantError: Table caption must not be empty");
});

void test("header cells carry their scope; cells forward spans, headers, ids and data attributes", async (t) => {
  const view = await mount(h(Table, { caption: "Storage", children: [
    h("thead", { key: "head" }, h("tr", null, h(Th, { scope: "col", id: "c1" }, "Kind"), h(Th, { scope: "col", numeric: true }, "Size"))),
    h("tbody", { key: "body" }, h("tr", null,
      h(Th, { scope: "row" }, "Annexed"),
      h(Td, { numeric: true, colSpan: 2, rowSpan: 3, headers: "c1", "data-cb-source": "x" }, "1 KB"))),
  ] }));
  const cells = [...view.container.querySelectorAll("th, td")].map((cell) => ({
    tag: cell.tagName.toLowerCase(),
    attributes: Object.fromEntries([...cell.attributes].map((attribute) => [attribute.name, attribute.value])),
  }));
  t.check(cells, [
    { tag: "th", attributes: { scope: "col", class: "pb-2 pr-3 last:pr-0 align-bottom font-medium text-warm-700 text-left", id: "c1" } },
    { tag: "th", attributes: { scope: "col", class: "pb-2 pr-3 last:pr-0 align-bottom font-medium text-warm-700 text-right tabular-nums" } },
    { tag: "th", attributes: { scope: "row", class: "py-2 pr-3 align-top font-medium text-left" } },
    { tag: "td", attributes: { class: "py-2 pr-3 last:pr-0 align-top text-right tabular-nums", colspan: "2", rowspan: "3", headers: "c1", "data-cb-source": "x" } },
  ]);
  await view.unmount();
});

void test("a Docling table with no caption is named by its page and keeps its spans", async (t) => {
  const view = await mount(h(DoclingPageSection, {
    page: 4,
    assets: { pageRender: null, figures: new Map() },
    items: [{
      kind: "table",
      ref: "#/tables/0",
      label: "table",
      page: 4,
      caption: null,
      rows: [
        [{ text: "Year", colSpan: 1, rowSpan: 1, header: true }, { text: "Total", colSpan: 2, rowSpan: 1, header: true }],
        [{ text: "2024", colSpan: 1, rowSpan: 2, header: false }, { text: "3", colSpan: 1, rowSpan: 1, header: false }],
      ],
    }],
  }));
  t.check(shape(view).region.name, "Table on page 4");
  t.check(shape(view).table.captionClasses, ["sr-only"]);
  t.check([...view.container.querySelectorAll("th, td")].map((cell) => [cell.tagName.toLowerCase(), cell.getAttribute("scope"), cell.getAttribute("colspan"), cell.getAttribute("rowspan")]), [
    ["th", "col", null, null],
    ["th", "col", "2", null],
    ["td", null, null, "2"],
    ["td", null, null, null],
  ]);
  await view.unmount();
});

void test("SheetTable has one scroll container, with its sticky header and row numbers inside it", async (t) => {
  const view = await mount(h(SheetTable, { caption: "Budget", rows: [["a", 1], [null, { f: "=B1", v: "1" }]] }));
  const scrollers = [...view.container.querySelectorAll<HTMLElement>("*")]
    .filter((el) => [...el.classList].some((name) => /^overflow-(auto|x-auto|y-auto|scroll)$/.test(name)));
  const region = view.container.querySelector("[role=region]");
  const sticky = [...view.container.querySelectorAll(".sticky")].map((el) => [
    el.tagName.toLowerCase(),
    el.getAttribute("scope"),
    region?.contains(el) ?? false,
  ]);
  t.check({ scrollers: scrollers.map((el) => el.getAttribute("role")), name: shape(view).region.name, sticky }, {
    scrollers: ["region"],
    name: "Budget",
    sticky: [
      ["tr", null, true],
      ["th", "col", true],
      ["th", "row", true],
      ["th", "row", true],
    ],
  });
  t.check(shape(view).region.classes, ["overflow-auto", ...FOCUS, "text-xs", "font-mono"]);
  await view.unmount();
});
