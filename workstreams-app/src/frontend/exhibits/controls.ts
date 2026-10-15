// What a raw index.html exhibit references to get the control bar:
//
//   <script type="module" src="/controls.ts"></script>
//
// Two dynamic imports, in order. The first is the React refresh runtime:
// the container's shell gets the refresh preamble from Vite's HTML
// transform, a raw page is served untouched, and @vitejs/plugin-react throws
// "can't detect preamble" from any module that defines a component when the
// preamble is missing. So the preamble is installed here, in a module with no
// component, before the mount's graph is evaluated. The lines are the
// plugin's own preambleCode plus the installed marker from
// https://vite.dev/guide/backend-integration. A failure in either import is
// shown on the page, which has no Vite error overlay of its own.

declare global {
  interface Window {
    $RefreshReg$?: () => void;
    $RefreshSig$?: () => <T>(type: T) => T;
    __vite_plugin_react_preamble_installed__?: boolean;
  }
}

/** Vite's virtual id for the runtime; a variable so TypeScript does not try to resolve it as a path. */
const REFRESH_RUNTIME = "/@react-refresh";

interface RefreshRuntime {
  injectIntoGlobalHook(target: Window): void;
}

async function boot(): Promise<void> {
  try {
    // eslint-disable-next-line no-restricted-syntax -- the runtime is a Vite virtual module with no type declarations; this is the one untyped boundary.
    const runtime = (await import(/* @vite-ignore */ REFRESH_RUNTIME)) as RefreshRuntime;
    runtime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const { mountControls } = await import("./controls/mount.js");
    mountControls();
  } catch (error) {
    const notice = document.createElement("p");
    notice.setAttribute("role", "alert");
    notice.style.cssText = "position:fixed;inset:auto 0 0 0;margin:0;padding:8px 16px;background:#fde8e8;color:#7f1d1d;font:14px system-ui,sans-serif";
    notice.textContent = `The exhibit controls failed to load: ${error instanceof Error ? error.message : String(error)}`;
    document.body.append(notice);
  }
}

void boot();
