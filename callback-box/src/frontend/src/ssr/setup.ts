/**
 * SSR environment setup — must be imported before any React/component code.
 *
 * Polyfills browser APIs that components expect (window, document).
 */

// document polyfill — react-textarea-autosize reads document.documentElement at import time.
// NOTE: Do NOT set globalThis.window here — tRPC server checks `typeof window === 'undefined'`
// to detect server environments. Setting window would make it think we're a browser and throw.
// `Object.assign` writes the stub without an `as` cast (the DOM lib types
// `globalThis.document` as `Document`, which a stub isn't).
Object.assign(globalThis, {
  document: {
    addEventListener() {},
    removeEventListener() {},
    createElement() { return {}; },
    getElementById() { return null; },
    querySelector() { return null; },
    documentElement: { currentStyle: null, style: {} },
  },
});

/**
 * Set up the window polyfill with the actual route.
 * Must be called AFTER all imports (so tRPC server init sees no window)
 * but BEFORE rendering (so getApiBase() can read window.location).
 */
export function setRoute(fullPath: string): void {
  const windowStub = {
    location: {
      pathname: fullPath,
      search: "",
      href: `http://localhost${fullPath}`,
    },
    addEventListener() {},
    removeEventListener() {},
  };
  // `Object.assign` writes the stubs without an `as` cast past the DOM lib's
  // `Window` types. TanStack Router (router-core) reads a bare `self` at
  // construction; in a browser `self === window`. Mirror that (same stub
  // reference) so SSR router creation doesn't throw `self is not defined`.
  Object.assign(globalThis, { window: windowStub, self: windowStub });
}
