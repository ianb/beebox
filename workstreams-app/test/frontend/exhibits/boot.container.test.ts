// # The exhibit container
//
// The shell every exhibit renders inside: breadcrumb, title, the manifest's prose
// rendered as Markdown, and whatever the page rendered. A page tier is a choice
// about presentation, never about whether the prose and title appear.

import { test } from "tap";
import "agent-doctest/tap";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ExhibitContainer } from "../../../src/frontend/exhibits/Container.js";
import type { ExhibitBoot } from "../../../src/shared/exhibits.js";

// The loader compiles .tsx through the package tsconfig, which scopes itself to
// the server tree and so leaves esbuild on the classic JSX runtime; the browser
// build uses Vite's automatic runtime, where the container needs no React
// import. Handing the global over is the smallest way to render one here.
Object.assign(globalThis, { React });


function boot(overrides: Partial<ExhibitBoot>): ExhibitBoot {
  return {
    scope: "demo-ws/instrument",
    listUrl: "/demo-ws/",
    listLabel: "demo-ws",
    manifest: {
      title: "Threshold tuner",
      created: "2026-08-15T00:00:00Z",
      prose: "The tuner shows **three** thresholds:\n\n- low\n- high",
    },
    doc: null,
    module: "/@fs/store/demo-ws/instrument/index.tsx",
    ...overrides,
  };
}

function render(value: ExhibitBoot): string {
  return renderToStaticMarkup(
    createElement(ExhibitContainer, { boot: value, children: createElement("p", null, "the page's own content") }),
  );
}

// Prose renders as Markdown under the title: a list comes out as a list and
// emphasis as emphasis, not one run-on paragraph. The page's own content follows.
// There is no answer form.
void test("Prose renders as Markdown under the title:", async (t) => {
  // doctest:L49
  const instrument = render(boot({}));
  t.check(
    {
      page: instrument.includes("the page&#x27;s own content"),
      list: instrument.includes("<li>low</li>"),
      emphasis: instrument.includes("<strong>three</strong>"),
      form: instrument.includes("Your answer"),
      titleFirst: instrument.indexOf("Threshold tuner") < instrument.indexOf("three"),
      proseBeforePage: instrument.indexOf("three") < instrument.indexOf("own content"),
    },
    {
    page: true,
    list: true,
    emphasis: true,
    form: false,
    titleFirst: true,
    proseBeforePage: true,
  },
  );
});

// A manifest without prose shows the title and the page only.
void test("A manifest without prose shows the title and the page only.", async (t) => {
  // doctest:L64
  const bare = render(boot({
    scope: "apps/threshold-tuner",
    manifest: { title: "Threshold tuner", created: "2026-08-15T00:00:00Z" },
  }));
  t.check(
    {
      page: bare.includes("the page&#x27;s own content"),
      title: bare.includes("Threshold tuner"),
      prose: bare.includes("three"),
    },
    {
    page: true,
    title: true,
    prose: false,
  },
  );
});

// A store exhibit carries the "Reply in the session" button and the Comment
// control; a committed app carries neither, because it belongs to no workstream:
// no session to bring forward, nobody to send a comment to. The composer renders
// only once commenting is on and text is selected.
void test("A store exhibit carries the \"Reply in the session\" button and the Comment con...", async (t) => {
  // doctest:L82
  const store = render(boot({}));
  const committed = render(boot({
    scope: "apps/threshold-tuner",
    manifest: { title: "Threshold tuner", created: "2026-08-15T00:00:00Z" },
  }));
  t.check(
    {
      storeButton: store.includes("Reply in the session"),
      appButton: committed.includes("Reply in the session"),
      // The refusal (and its link to the dashboard) renders only after a click.
      idleRefusal: store.includes("Open the workstream list"),
      storeComment: store.includes(">Comment</button>"),
      appComment: committed.includes(">Comment</button>"),
      idleComposer: store.includes("What about it?"),
      // The title sits inside the commentable content, below the controls.
      controlsBeforeTitle: store.indexOf(">Comment</button>") < store.indexOf("Threshold tuner"),
    },
    {
    storeButton: true,
    appButton: false,
    idleRefusal: false,
    storeComment: true,
    appComment: false,
    idleComposer: false,
    controlsBeforeTitle: true,
  },
  );
});

// ## Figures enlarge on click
//
// The default renderer wraps each image figure in a button that opens the
// full-size view; the enlarged dialog is not in the page until the click. A
// non-image figure is a plain link with no button. The file name beside the
// label links to the raw file, which is the way to the browser's own zoom.
void test("The default renderer wraps each image figure in a button that opens the full-...", async (t) => {
  // doctest:L109
  const { DefaultExhibit } = await import("../../../src/frontend/exhibits/boot/DefaultExhibit.js");

  // doctest:L111
  const figures = renderToStaticMarkup(
    createElement(DefaultExhibit, {
      boot: boot({
        manifest: {
          title: "Shots",
          created: "2026-08-15T00:00:00Z",
          figures: [
            { label: "A1", file: "before.png", caption: "The list before" },
            { label: "A2", file: "trace.json" },
          ],
        },
      }),
    }),
  );
  t.check(
    {
      enlarge: figures.includes('aria-label="Enlarge A1"'),
      imageInButton: /<button[^>]*Enlarge A1[^>]*><img/.test(figures),
      dialogClosed: !figures.includes("<dialog"),
      rawLink: figures.includes('href="before.png" rel="noreferrer" target="_blank"'),
      dataIsLink: figures.includes('href="trace.json"') && !figures.includes("Enlarge A2"),
    },
    {
    enlarge: true,
    imageInButton: true,
    dialogClosed: true,
    rawLink: true,
    dataIsLink: true,
  },
  );
});

// ## The control bar for a raw page
//
// A raw `index.html` page that references `/controls.ts` gets the same two
// controls the container shows, in one strip: Reply in the session first, then
// Comment. Nothing else of the container comes with it.
void test("A raw index.html page that references /controls.ts gets the same two controls...", async (t) => {
  // doctest:L142
  const { ControlBar } = await import("../../../src/frontend/exhibits/controls/ControlBar.js");

  // doctest:L144
  const bar = renderToStaticMarkup(
    createElement(ControlBar, { scope: "logo-bakeoff/round-3", contentRef: { current: null } }),
  );
  t.check(
    {
      reply: bar.includes("Reply in the session"),
      comment: bar.includes(">Comment</button>"),
      replyFirst: bar.indexOf("Reply in the session") < bar.indexOf(">Comment</button>"),
      noBreadcrumb: !bar.includes("←"),
    },
    {
    reply: true,
    comment: true,
    replyFirst: true,
    noBreadcrumb: true,
  },
  );
});
