// A doc card's composition renders as a framed block with Copy (and Compose
// when an editor is wired), and each editorial mark renders by kind
// (`plan:composition-editor`, Track 3).
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

function clipboard(): string[] {
  const copied: string[] = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: (text: string) => { copied.push(text); return Promise.resolve(); } },
  });
  return copied;
}

// ## Only the agent's words open: Copy copies at once, with them as plain text
// (`plan:composition-copy-and-accept-all`)
void test("Copy with only agent words copies the publishing text", async (t) => {
  const copied = clipboard();
  const view = await mount(render(piece('One line.\n\nTwo {% editorial kind="joiner" %}and{% /editorial %} three.'), null));
  t.teardown(() => view.unmount());
  const copy = view.container.querySelector<HTMLButtonElement>('button[aria-label="Copy composition"]');
  await view.act(() => { copy?.click(); });
  await view.act(() => Promise.resolve());
  t.check({ copied, label: copy?.textContent }, { copied: ["One line.\n\nTwo and three."], label: "Copied" });
});

// ## A gap open: Copy copies nothing and lists it, with the draft copy beside
void test("Copy with a gap lists what to resolve", async (t) => {
  const copied = clipboard();
  const view = await mount(render(piece('One {% editorial kind="gap" %}more{% /editorial %} line.\n\nTwo {% editorial kind="joiner" %}and{% /editorial %} three.'), null));
  t.teardown(() => view.unmount());
  const copy = view.container.querySelector<HTMLButtonElement>('button[aria-label^="Copy composition"]');
  t.check(copy?.getAttribute("aria-label"), "Copy composition: 1 to resolve first");
  await view.act(() => { copy?.click(); });
  const panel = view.container.querySelector('[aria-label="Before you publish"]');
  t.check({ copied, lines: [...(panel?.querySelectorAll("p") ?? [])].map((p) => p.textContent) }, {
    copied: [],
    lines: ["Before you publish: 1 thing to resolve", "A gap: “more”. Write it, or remove the gap."],
  });
  const draft = panel?.querySelector<HTMLButtonElement>('button[aria-label="Copy the draft with its marks labelled"]');
  await view.act(() => { draft?.click(); });
  await view.act(() => Promise.resolve());
  t.check(copied, ["One [gap: more] line.\n\nTwo [agent: and] three."]);
});

// ## A mark of an unknown kind (the region itself is whole): no Copy, a
// reason, and Edit stays to fix it
void test("a broken tag keeps Edit and withholds Copy", async (t) => {
  const view = await mount(render(piece('One {% editorial kind="draft" %}line{% /editorial %}.'), Editor));
  t.teardown(() => view.unmount());
  const section = view.container.querySelector("section");
  t.check({
    buttons: [...(section?.querySelectorAll("button") ?? [])].map((b) => b.getAttribute("aria-label")),
    says: section?.textContent?.includes("A tag in this composition is broken. Edit it to fix the tag."),
  }, { buttons: ["Edit composition"], says: true });
});

void test("Compose shows only for one closed composition, and opens the editor", async (t) => {
  const labels = async (body: string) => {
    const view = await mount(render(body, Editor));
    t.teardown(() => view.unmount());
    return [...view.container.querySelectorAll("section button")].map((b) => b.getAttribute("aria-label"));
  };
  t.check(await labels(piece("Plain.")), ["Copy composition", "More copy options", "Edit composition"]);
  t.check(await labels(`${piece("One.")}\n${piece("Two.")}`), []);
  t.check(await labels("No composition here.\n"), []);
  const view = await mount(render(piece("Plain."), Editor));
  t.teardown(() => view.unmount());
  const compose = view.container.querySelector<HTMLButtonElement>('button[aria-label="Edit composition"]');
  await view.act(() => { compose?.click(); });
  t.check({ editors: view.container.querySelectorAll("[data-editor]").length, blocks: view.container.querySelectorAll("section").length }, { editors: 1, blocks: 0 });
});

// ## Text added above the composition remounts the block (Markdoc renders it
// without keys), but the editor lives above the Markdown tree and stays.
void test("the editor survives the block remounting", async (t) => {
  const view = await mount(render(piece("Plain."), Editor));
  t.teardown(() => view.unmount());
  const compose = view.container.querySelector<HTMLButtonElement>('button[aria-label="Edit composition"]');
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
  const compose = view.container.querySelector<HTMLButtonElement>('button[aria-label="Edit composition"]');
  await view.act(() => { compose?.click(); });
  const before = view.container.querySelector("[data-editor]")?.getAttribute("data-editor") ?? null;
  t.check(before, any(String));
  for (const body of ["Notes only; the agent removed the composition.\n", `${piece("One.")}\n${piece("Two.")}`]) {
    await view.rerender(render(body, Editor));
    const editors = [...view.container.querySelectorAll("[data-editor]")].map((el) => el.getAttribute("data-editor"));
    t.check(editors, [before]);
  }
});
