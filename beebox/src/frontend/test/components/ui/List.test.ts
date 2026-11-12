// List: the one `<ul>`/`<ol>`. An unmarked list keeps its list role (Safari
// drops it under `list-style: none`); a marked list is a `<ul>` or `<ol>` by
// its marker.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { List, type ListProps } from "../../../src/components/ui/List.js";

const LI = h("li", null, "item");

async function listOf(props: ListProps): Promise<{ tag: string; role: string | null; classes: string[]; attributes: Record<string, string> }> {
  const view = await mount(h(List, props));
  const element = view.container.firstElementChild;
  const result = {
    tag: element?.tagName.toLowerCase() ?? "",
    role: element?.getAttribute("role") ?? null,
    classes: [...(element?.classList ?? [])],
    attributes: Object.fromEntries([...(element?.attributes ?? [])]
      .filter((attribute) => attribute.name !== "class" && attribute.name !== "role")
      .map((attribute) => [attribute.name, attribute.value])),
  };
  await view.unmount();
  return result;
}

void test("each marker picks the element and the role", async (t) => {
  t.check(await listOf({ children: LI }), { tag: "ul", role: "list", classes: ["flex", "flex-col"], attributes: {} });
  t.check(await listOf({ children: LI, ordered: true }), { tag: "ol", role: "list", classes: ["flex", "flex-col"], attributes: {} });
  t.check(await listOf({ children: LI, marker: "disc" }), {
    tag: "ul",
    role: null,
    classes: ["flex", "flex-col", "list-disc", "list-outside", "pl-5", "marker:text-warm-400"],
    attributes: {},
  });
  t.check(await listOf({ children: LI, marker: "decimal" }), {
    tag: "ol",
    role: null,
    classes: ["flex", "flex-col", "list-decimal", "list-outside", "pl-5", "marker:text-warm-400"],
    attributes: {},
  });
});

void test("gap, direction and the caller's layout classes", async (t) => {
  t.check((await listOf({ children: LI, direction: "wrap", gap: "sm", className: "mt-2" })).classes, ["flex", "flex-row", "flex-wrap", "gap-2", "mt-2"]);
  t.check((await listOf({ children: LI, direction: "row", gap: "md" })).classes, ["flex", "flex-row", "gap-3"]);
});

void test("a divided list rules between items and pads each side of the rule", async (t) => {
  t.check((await listOf({ children: LI, marker: "decimal", divided: true })).classes, [
    "flex", "flex-col",
    "divide-y", "divide-warm-200", "[&>li]:py-2", "[&>li:first-child]:pt-0", "[&>li:last-child]:pb-0",
    "list-decimal", "list-outside", "pl-5", "marker:text-warm-400",
  ]);
});

void test("id, name and data attributes are forwarded", async (t) => {
  t.check((await listOf({ children: LI, id: "runs", "aria-label": "Recent runs", "data-cb-source": "schedule:x" })).attributes, {
    id: "runs",
    "aria-label": "Recent runs",
    "data-cb-source": "schedule:x",
  });
  t.check((await listOf({ children: LI, "aria-labelledby": "heading" })).attributes, { "aria-labelledby": "heading" });
});
