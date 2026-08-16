// Container bootstrap for the exhibits origin.
//
// The server injects window.__EXHIBIT__ and points this module at the page:
// either an out-of-repo index.tsx (imported through /@fs, since the store is
// outside the Vite root) or the default renderer.

import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";

import { ExhibitContainer } from "./Container.js";
import { DefaultExhibit } from "./DefaultExhibit.js";
import type { ExhibitBoot } from "../../shared/exhibits.js";
import "./styles.css";

declare global {
  interface Window {
    __EXHIBIT__?: ExhibitBoot;
  }
}

class MissingExhibitBootError extends Error {
  constructor() {
    super("The exhibits container requires window.__EXHIBIT__ and a #root mount point.");
    this.name = "MissingExhibitBootError";
  }
}

/** An agent-authored page module: an untyped boundary by construction. */
interface PageModule {
  default?: () => ReactNode;
}

async function loadPage(boot: ExhibitBoot): Promise<ReactNode> {
  if (boot.module === null) return <DefaultExhibit boot={boot} />;
  // eslint-disable-next-line no-restricted-syntax -- dynamic import of a store page is a parse boundary; the shape is checked below.
  const module = (await import(/* @vite-ignore */ boot.module)) as PageModule;
  const Page = module.default;
  if (typeof Page !== "function") {
    return <p>This page&apos;s index.tsx has no default-exported component.</p>;
  }
  return <Page />;
}

const boot = window.__EXHIBIT__;
const container = document.getElementById("root");
if (!boot || !container) throw new MissingExhibitBootError();

/** An import-time failure lands before the boundary, so it is caught here. */
async function page(ready: ExhibitBoot): Promise<ReactNode> {
  try {
    return await loadPage(ready);
  } catch (error) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-red-300 bg-red-50 p-4" role="alert">
        <h2 className="m-0 text-base font-bold text-red-900">This page failed to load</h2>
        <pre className="m-0 overflow-auto whitespace-pre-wrap text-sm text-red-900">
          {error instanceof Error ? error.message : String(error)}
        </pre>
      </div>
    );
  }
}
createRoot(container).render(<ExhibitContainer boot={boot}>{await page(boot)}</ExhibitContainer>);
