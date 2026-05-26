/**
 * SSR environment setup — must be imported before any React/component code.
 *
 * Polyfills browser APIs that components expect (EventSource, window, document).
 */

// EventSource polyfill — SSE machine tries to create one on import
(globalThis as Record<string, unknown>).EventSource = class EventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  close() {}
  constructor(_url: string) {}
};

// document polyfill — react-textarea-autosize reads document.documentElement at import time.
// NOTE: Do NOT set globalThis.window here — tRPC server checks `typeof window === 'undefined'`
// to detect server environments. Setting window would make it think we're a browser and throw.
(globalThis as Record<string, unknown>).document = {
  addEventListener() {},
  removeEventListener() {},
  createElement() { return {}; },
  getElementById() { return null; },
  querySelector() { return null; },
  documentElement: { currentStyle: null, style: {} },
};

/**
 * Set up the window polyfill with the actual route.
 * Must be called AFTER all imports (so tRPC server init sees no window)
 * but BEFORE rendering (so getApiBase() can read window.location).
 */
export function setRoute(fullPath: string): void {
  (globalThis as Record<string, unknown>).window = {
    location: {
      pathname: fullPath,
      search: "",
      href: `http://localhost${fullPath}`,
    },
    addEventListener() {},
    removeEventListener() {},
  };
}
