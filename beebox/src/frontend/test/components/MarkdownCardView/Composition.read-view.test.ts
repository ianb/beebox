// A doc card's composition renders as a framed block with Copy (and Compose
// when an editor is wired), and each editorial mark renders by kind
// (`docs/implemented-plans/composition-editor.md`, Track 3).
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any } from "@ianbicking/tap-check/check";
import { Markdown } from "../../../src/components/Markdown/body.js";
import {
  CompositionCardContext, useComposeSession, type ComposeEditorProps, type CompositionCard,
} from "../../../src/components/MarkdownCardView/Composition.js";
import { cardTypeMarkdown } from "../../../src/components/MarkdownCardView/type-markdown.js";
import { BoxSlugProvider } from "../../../src/lib/box-slug.js";

const doc = cardTypeMarkdown("doc");
// The editor renders into the host the block leaves in its place, as the real one does.
// Its `data-editor` value is per mount, so a remounted editor shows a new one.
function Editor({ host }: ComposeEditorProps): ReactNode {
  const instance = useId();
  return host === null ? null : createPortal(h("div", { "data-editor": instance }), host);
}

/** What `CardBody` does: the compose session sits above the Markdown tree. */
function Body({ body, composeEditor }: { body: string; composeEditor: CompositionCard["composeEditor"] }): ReactNode {
  const cardPath = "_content/docs/Draft.doc.card";
  const compose = useComposeSession({ body, cardPath, composeEditor });
  const card: CompositionCard = { body, cardPath, composeEditor, ...compose.session };
  return h("div", null,
    compose.fallback,
    h(CompositionCardContext.Provider, {
      value: card,
      children: h(Markdown, { onNavigate: () => {}, tags: doc?.tags, components: doc?.components, children: body }),
    }),
    compose.editor);
}

function render(body: string, composeEditor: CompositionCard["composeEditor"]) {
  return h(BoxSlugProvider, { boxSlug: "test", children: h(Body, { body, composeEditor }) });
}

const piece = (inner: string) => `Preface.\n\n{% composition %}\n${inner}\n{% /composition %}\n`;

void test("each kind of mark renders by kind", async (t) => {
  const view = await mount(render(piece([
    'Rain {% editorial kind="joiner" %}came early{% /editorial %}.',
    'Then {% editorial kind="gap" %}connect the halves{% /editorial %} and {% editorial kind="note" %}shorter?{% /editorial %}.',
    'In {% editorial kind="check" note="transcript unclear" %}this new world{% /editorial %} I ran {% editorial kind="draft" %}fast{% /editorial %}.',
  ].join("\n\n")), null));
  t.teardown(() => view.unmount());
  const marks = [...view.container.querySelectorAll("[data-editorial]")].map((el) => ({
    kind: el.getAttribute("data-editorial"),
    text: el.textContent,
    title: el.getAttribute("title"),
    described: el.getAttribute("aria-describedby") === null ? null : view.container.querySelector(`[id="${el.getAttribute("aria-describedby") ?? ""}"]`)?.textContent,
  }));
  t.check(marks, [
    { kind: "joiner", text: "agent's words: came early", title: "agent's words", described: null },
    { kind: "gap", text: "gap:connect the halves", title: null, described: null },
    { kind: "note", text: "note:shorter?", title: null, described: null },
    { kind: "check", text: "this new worldtranscript unclear", title: "transcript unclear", described: "transcript unclear" },
    { kind: "draft", text: "unknown mark: draftfast", title: null, described: null },
  ]);
});

void test("Copy copies the plain text and counts open marks", async (t) => {
  const copied: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: (text: string) => { copied.push(text); return Promise.resolve(); } },
  });
  const view = await mount(render(piece('One {% editorial kind="gap" %}more{% /editorial %} line.\n\nTwo {% editorial kind="joiner" %}and{% /editorial %} three.'), null));
  t.teardown(() => view.unmount());
  const labels = () => [...view.container.querySelectorAll("section button")].map((b) => b.textContent);
  t.check(labels(), ["Copy (2 open marks)"]);
  const [copy] = view.container.querySelectorAll("button");
  await view.act(() => { copy?.click(); });
  await view.act(() => Promise.resolve());
  t.check({ copied, labels: labels() }, { copied: ["One [more] line.\n\nTwo [and] three."], labels: ["Copied"] });
});

void test("Compose shows only for one closed composition, and opens the editor", async (t) => {
  const labels = async (body: string) => {
    const view = await mount(render(body, Editor));
    t.teardown(() => view.unmount());
    return [...view.container.querySelectorAll("section button")].map((b) => b.textContent);
  };
  t.check(await labels(piece("Plain.")), ["Copy", "Edit"]);
  t.check(await labels(`${piece("One.")}\n${piece("Two.")}`), []);
  t.check(await labels("No composition here.\n"), []);
  const view = await mount(render(piece("Plain."), Editor));
  t.teardown(() => view.unmount());
  const compose = [...view.container.querySelectorAll("button")].find((b) => b.textContent === "Edit");
  await view.act(() => { compose?.click(); });
  t.check({ editors: view.container.querySelectorAll("[data-editor]").length, blocks: view.container.querySelectorAll("section").length }, { editors: 1, blocks: 0 });
});

// ## Text added above the composition remounts the block (Markdoc renders it
// without keys), but the editor lives above the Markdown tree and stays.
void test("the editor survives the block remounting", async (t) => {
  const view = await mount(render(piece("Plain."), Editor));
  t.teardown(() => view.unmount());
  const compose = [...view.container.querySelectorAll("button")].find((b) => b.textContent === "Edit");
  await view.act(() => { compose?.click(); });
  const before = view.container.querySelector("[data-editor]")?.getAttribute("data-editor");
  await view.rerender(render(`A new first paragraph.\n\n${piece("Plain.")}`, Editor));
  t.check(before, any(String));
  t.check(view.container.querySelector("[data-editor]")?.getAttribute("data-editor"), before);
});

// ## The composition removed or broken while composing: the editor moves to a
// host at the top of the body (where it says why it stopped, with Done)
void test("the editor stays visible when the composition goes away", async (t) => {
  const view = await mount(render(piece("Plain."), Editor));
  t.teardown(() => view.unmount());
  const compose = [...view.container.querySelectorAll("button")].find((b) => b.textContent === "Edit");
  await view.act(() => { compose?.click(); });
  const before = view.container.querySelector("[data-editor]")?.getAttribute("data-editor") ?? null;
  t.check(before, any(String));
  for (const body of ["Notes only; the agent removed the composition.\n", `${piece("One.")}\n${piece("Two.")}`]) {
    await view.rerender(render(body, Editor));
    const editors = [...view.container.querySelectorAll("[data-editor]")].map((el) => el.getAttribute("data-editor"));
    t.check(editors, [before]);
  }
});
