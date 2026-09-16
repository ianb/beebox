import * as fs from "node:fs/promises";
import * as path from "node:path";
import { z } from "zod";
import { SECRET_PURPOSE_PATTERN } from "../../core/secrets/resolve.js";

const envName = /^[A-Z_a-z]\w*$/;
const secretName = z.string().min(1).max(200);

const declarationSchema = z.array(
  z.object({
    name: secretName,
    reason: z.string().regex(SECRET_PURPOSE_PATTERN),
    env: z.string().regex(envName),
  }),
);

export type TrickSecretDeclaration = z.infer<typeof declarationSchema>[number];

export class TrickSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrickSecretError";
  }
}

function fail(message: string): never {
  throw new TrickSecretError(message);
}

export async function readTrickSecrets(trickDir: string): Promise<TrickSecretDeclaration[]> {
  const file = path.join(trickDir, "secrets.json");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    fail(`Could not read trick secret declaration: ${file}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (_error) {
    fail(`Invalid JSON in trick secret declaration: ${file}`);
  }
  const result = declarationSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    fail(`Invalid trick secret declaration (${issue?.path.join(".") ?? "declaration"}): ${issue?.message ?? "invalid"}`);
  }
  const seen = new Set<string>();
  for (const declaration of result.data) {
    if (declaration.env.startsWith("BBX_") || ["PATH", "HOME", "SHELL"].includes(declaration.env)) {
      fail(`Trick secret environment name is reserved: ${declaration.env}`);
    }
    if (seen.has(declaration.env)) {
      fail(`Trick secret environment name is duplicated: ${declaration.env}`);
    }
    seen.add(declaration.env);
  }
  return result.data;
}

const resolvedSchema = z.object({ value: z.string(), suspect: z.boolean() });
const refusalSchema = z.object({ kind: z.string(), message: z.string() });

export async function resolveTrickSecret(opts: {
  env: NodeJS.ProcessEnv;
  declaration: TrickSecretDeclaration;
  fetchImpl?: typeof fetch;
}): Promise<{ value: string; suspect: boolean }> {
  const serverUrl = opts.env.BBX_SERVER_URL?.replace(/\/+$/, "");
  const boxName = opts.env.BBX_BOX_NAME;
  const token = opts.env.BBX_AGENT_TOKEN;
  if (!serverUrl || !boxName) {
    fail(`BOX_UNREACHABLE: this trick needs a running box server to resolve "${opts.declaration.name}"`);
  }
  if (!token) {
    fail(`BOX_UNREACHABLE: this box could not provision its agent token to resolve "${opts.declaration.name}"`);
  }

  let response: Response;
  try {
    response = await (opts.fetchImpl ?? fetch)(`${serverUrl}/${boxName}/api/secrets/resolve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: opts.declaration.name, purpose: opts.declaration.reason }),
    });
  } catch (_error) {
    fail(`BOX_UNREACHABLE: the box server could not be reached while resolving "${opts.declaration.name}"`);
  }

  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const resolved = resolvedSchema.safeParse(body);
    if (resolved.success) return resolved.data;
    fail(`The box server returned an invalid response while resolving "${opts.declaration.name}"`);
  }
  const refusal = refusalSchema.safeParse(body);
  if (refusal.success) fail(`Secret "${opts.declaration.name}" refused (${refusal.data.kind}): ${refusal.data.message}`);
  fail(`The box server refused secret "${opts.declaration.name}" with HTTP ${response.status}`);
}
