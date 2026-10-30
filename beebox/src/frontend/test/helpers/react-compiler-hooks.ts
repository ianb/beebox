/**
 * Node load hook: compile frontend modules with the React Compiler, as the
 * Vite build does, so a test renders with the memoization a browser runs.
 * `.taprc` registers it for every test process; it touches only frontend
 * modules. Output is cached by content hash, because compiling the chat tree
 * costs seconds per process. Babel and esbuild load on the first cache miss:
 * importing them costs about 100 ms, and most test processes never compile.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire, type LoadFnOutput, type LoadHook } from "node:module";
import { fileURLToPath } from "node:url";

const BEEBOX_SRC = fileURLToPath(new URL("../../../", import.meta.url));
const FRONTEND_SRC = `${BEEBOX_SRC}frontend/src/`;
const CACHE_DIR = fileURLToPath(new URL("../../node_modules/.cache/react-compiler-tests/", import.meta.url));

export class CompilerOutputError extends Error {
  constructor(path: string) {
    super("React Compiler produced no output");
    this.name = "CompilerOutputError";
    this.cause = path;
  }
}

async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

/** Write then rename, so a parallel test process never reads a partial file. */
async function writeCached(path: string, code: string): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const partial = `${path}.${process.pid}.tmp`;
  await writeFile(partial, code);
  await rename(partial, path);
}

/** A change to this hook or to any package in the transform invalidates every cached module. */
const require = createRequire(import.meta.url);
const CACHE_SALT = [
  await readText(import.meta.filename),
  ...await Promise.all(["babel-plugin-react-compiler", "@babel/core", "esbuild"].map(
    async (name) => readText(require.resolve(`${name}/package.json`)),
  )),
].join("\0");

/**
 * Client modules, as `src/frontend/tsconfig.json` includes them: the frontend
 * tree, schema list entries, and plugin views. Backend `.tsx` (schemas,
 * guides) and `src/shared/` also run on the server, so they stay uncompiled.
 */
function compiles(path: string): boolean {
  if (path.includes("/node_modules/") || path.endsWith(".d.ts")) return false;
  if (path.startsWith(FRONTEND_SRC)) return path.endsWith(".ts") || path.endsWith(".tsx");
  if (!path.startsWith(BEEBOX_SRC)) return false;
  const relative = path.slice(BEEBOX_SRC.length);
  return /^schemas\/[\w-]+\/list-entry\.tsx$/.test(relative) || /^plugins\/[\w-]+\/view\.tsx$/.test(relative);
}

async function compile(path: string, source: string): Promise<string> {
  const [{ transformAsync }, { transform }] = await Promise.all([import("@babel/core"), import("esbuild")]);
  const compiled = await transformAsync(source, {
    filename: path,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["jsx", "typescript"] },
    // Same plugin options as vite.config.ts.
    plugins: [["babel-plugin-react-compiler", { target: "18" }]],
    sourceMaps: "inline",
  });
  if (compiled === null || typeof compiled.code !== "string") throw new CompilerOutputError(path);
  const js = await transform(compiled.code, {
    loader: "tsx",
    jsx: "automatic",
    format: "esm",
    target: "es2022",
    sourcefile: path,
    sourcemap: "inline",
    // Vite's build-time env object; frontend code reads `import.meta.env.DEV` at load.
    define: { "import.meta.env": JSON.stringify({ DEV: true, PROD: false, MODE: "test", SSR: false, BASE_URL: "/" }) },
  });
  return js.code;
}

async function compileCached(path: string): Promise<string> {
  const source = await readText(path);
  const key = createHash("sha256").update(CACHE_SALT).update("\0").update(path).update("\0").update(source).digest("hex");
  const cached = `${CACHE_DIR}${key}.js`;
  try {
    return await readText(cached);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  const code = await compile(path, source);
  await writeCached(cached, code);
  return code;
}

export async function load(...[url, context, nextLoad]: Parameters<LoadHook>): Promise<LoadFnOutput> {
  if (!url.startsWith("file:")) return nextLoad(url, context);
  const path = fileURLToPath(url);
  if (!compiles(path)) return nextLoad(url, context);
  return { format: "module", source: await compileCached(path), shortCircuit: true };
}
