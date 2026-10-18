// A fragment resolves against what the file view actually rendered: here the
// real card view (MarkdownCardView → CardBody), which blanks a leading heading
// that repeats the card title. Section paths match rendered headings by
// source line, so repeats, markup, and the blanked title all land right.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount, type Mounted } from "../helpers/dom-harness.js";
import { createElement as h, useEffect, useState, type ReactNode } from "react";
import { test } from "tap";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import type { FileData } from "../../src/file-type-registry.js";
import { MarkdownCardView } from "../../src/components/MarkdownCardView/view.js";
import { BoxSlugProvider } from "../../src/lib/box-slug.js";
import { FRAGMENT_ROOT_ATTRIBUTE, resolveFragment } from "../../src/lib/fragment-target.js";
import { useFragmentJump } from "../../src/hooks/useFragmentJump.js";

const filler = "Some words here. ".repeat(20);
const body = [
  "# Weekly plan", "", filler, "",              // 0: blanked by CardBody (equals the title)
  "## Weekly plan", "", filler, "",             // 4: repeats the title
  "## Notes", "", "first " + filler, "",        // 8
  "```bash", "# install deps", "```", "",       // 12-15: a fenced # line
  "## Notes", "", "second " + filler, "",       // 16
  "## Where **things** stand [now](x.card)", "", filler, "", // 20
].join("\n");
const path = "_content/Weekly.doc.card";

let scrolled: Element[] = [];
Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); };

interface Props { fragment: string | null; source: string }

/** Stands in for FileView: a fragment root around the real card view, and the hook. */
function Host({ fragment, source }: Props): ReactNode {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const missed = useFragmentJump({ root: element, fragment: fragment ?? undefined, source, path });
  const data: FileData = { path, frontmatter: { title: "Weekly plan" }, body: source, bodyLineOffset: 3, schema: { hasBodyField: true, defaultProminence: "ordinary" } };
  return (
    h("div", { ref: setElement, [FRAGMENT_ROOT_ATTRIBUTE]: "", "data-missed": String(missed) },
      h(MarkdownCardView, { data, onNavigate: () => null, mode: "page" }))
  );
}

/** Lets a test change Host's props from outside, through React state. */
const control: { set: ((next: Props) => void) | null } = { set: null };

function Controller({ initial }: { initial: Props }): ReactNode {
  const [props, setProps] = useState(initial);
  useEffect(() => { control.set = setProps; }, []);
  return h(Host, props);
}

async function render(fragment: string | null): Promise<{ view: Mounted; rerender: (next: Props) => Promise<void> }> {
  // No gc timer: an idle one keeps the test process alive.
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const controller = h(Controller, { initial: { fragment, source: body } });
  const routeTree = createRootRoute({ component: () => h(BoxSlugProvider, { boxSlug: "test1", children: controller }) });
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  const view = await mount(h(QueryClientProvider, { client: queryClient }, h(RouterProvider, { router })));
  return { view, rerender: async (next) => { await view.act(() => { control.set?.(next); }); } };
}

const at = (fragment: string | null): Props => ({ fragment, source: body });

const headingText = (el: Element | undefined) => el?.textContent ?? "(none)";
const isRoot = (el: Element | undefined) => el?.hasAttribute(FRAGMENT_ROOT_ATTRIBUTE) === true;

test("the repeated title heading and the title section", async (t) => {
  scrolled = [];
  const { view, rerender } = await render("/Weekly plan/Weekly plan");
  t.equal(view.container.querySelectorAll("h1").length, 0, "CardBody blanked the title heading");
  t.equal(headingText(scrolled.at(-1)), "Weekly plan", "the repeat");
  t.equal(scrolled.at(-1)?.tagName, "H2");
  await rerender(at("/Weekly plan"));
  t.ok(isRoot(scrolled.at(-1)), "the title section is the top of the body");
  await view.unmount();
});

test("repeats, markup, and a fenced # line", async (t) => {
  scrolled = [];
  const { view, rerender } = await render("/install deps/Notes");
  t.equal(scrolled.at(-1)?.getAttribute("data-line"), "17", "the second Notes, by line");
  await rerender(at("/install deps/Where **things** stand [now](x.card)"));
  t.equal(headingText(scrolled.at(-1)), "Where things stand now");
  await rerender(at("/install deps"));
  t.equal(scrolled.at(-1)?.getAttribute("data-line"), "9", "the heading above the fence");
  await rerender(at("notes-1"));
  t.equal(scrolled.at(-1)?.getAttribute("data-line"), "17", "an element id");
  await view.unmount();
});

test("a missing section shows the miss; a live edit does not re-jump", async (t) => {
  scrolled = [];
  const { view, rerender } = await render("/Weekly plan/Gone");
  t.equal(scrolled.length, 0);
  t.equal(view.container.querySelector("[data-missed]")?.getAttribute("data-missed"), "true");
  await rerender(at("/Weekly plan/Notes"));
  t.equal(scrolled.length, 1);
  t.equal(view.container.querySelector("[data-missed]")?.getAttribute("data-missed"), "false");
  await rerender({ fragment: "/Weekly plan/Notes", source: body + "\nmore text\n" });
  t.equal(scrolled.length, 1, "same fragment, new body: no scroll");
  await rerender(at(null));
  await rerender(at("/Weekly plan/Notes"));
  t.equal(scrolled.length, 2, "cleared, then picked again: jumps again");
  await view.unmount();
});

test("an embedded root's headings are not the host's", (t) => {
  const root = document.createElement("div");
  root.setAttribute(FRAGMENT_ROOT_ATTRIBUTE, "");
  root.innerHTML = `<div ${FRAGMENT_ROOT_ATTRIBUTE}><h2 id="a" data-line="3">embedded</h2></div><p>x</p>`;
  t.same(resolveFragment(root, { fragment: "a", source: "x" }), { kind: "pending" });
  t.same(resolveFragment(root, { fragment: "/B", source: "text\n\n## B\nbody\n" }), { kind: "pending" }, "no owned headings yet");
  t.end();
});
