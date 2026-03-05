/**
 * Node.js ESM loader for SSR — stubs out Vite-specific imports.
 *
 * Handles:
 * - .css imports → empty module
 * - ?url suffix imports → exports empty string (Vite asset URL pattern)
 */

// eslint-disable-next-line max-params -- required by Node's module loader API
export async function resolve(specifier, context, nextResolve) {
  // Strip Vite ?url query suffix before resolving
  if (specifier.endsWith("?url")) {
    const cleaned = specifier.slice(0, -4);
    const result = await nextResolve(cleaned, context);
    // Tag it so load() knows to return a stub
    return { ...result, url: result.url + "?url" };
  }
  return nextResolve(specifier, context);
}

// eslint-disable-next-line max-params -- required by Node's module loader API
export async function load(url, context, nextLoad) {
  if (url.endsWith(".css") || url.endsWith("?url")) {
    return { format: "module", source: "export default '';\n", shortCircuit: true };
  }
  return nextLoad(url, context);
}
