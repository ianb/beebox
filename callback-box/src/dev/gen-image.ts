/**
 * gen-image — Generate or transform images with Gemini Flash Image.
 *
 * Usage:
 *   gen-image -o out.png "a prompt"
 *   gen-image -i ref.png -o out.png "redo this in the style of an 1870s engraving"
 *   gen-image -i a.png -i b.png -o out.png "combine these two illustrations"
 *   echo "long prompt..." | gen-image -o out.png
 *
 * Options:
 *   -o, --output PATH      Where to write the PNG (required).
 *   -i, --input PATH       Reference image; may be repeated. Anything Gemini
 *                          accepts (png, jpg, webp, gif) — sent inline as base64.
 *   -p, --prompt TEXT      Prompt text (alternative to positional / stdin).
 *   -m, --model NAME       Model id (default: gemini-2.5-flash-image).
 *   -k, --key-env NAME     Env var holding the API key. Default tries
 *                          $SKE_GEMINI_API_KEY, then $GEMINI_KEY, then
 *                          $GOOGLE_API_KEY. ($GEMINI_KEY often has zero
 *                          free-tier quota for the image model — if you get
 *                          429s, pass -k SKE_GEMINI_API_KEY explicitly.)
 *   -v, --verbose          Print the model's text part to stderr too.
 *   -h, --help             This help.
 *
 * Exit codes: 0 ok, 1 bad args, 2 no image returned, 3 API error.
 *
 * Invoked via the bin/gen-image stub, which runs this through tsx.
 */

import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { GoogleGenAI } from "@google/genai";
import { extensionToMimetype } from "../lib/mimetype.js";

const SELF = import.meta.filename;

interface Args {
  output: string | null;
  inputs: string[];
  prompt: string | null;
  model: string;
  keyEnvOverride: string | null;
  verbose: boolean;
  help: boolean;
}

type ContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

class GenImageError extends Error {
  readonly exitCode: number;
  constructor(exitCode: number, detail: string) {
    super(detail);
    this.name = "GenImageError";
    this.exitCode = exitCode;
  }
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    output: null,
    inputs: [],
    prompt: null,
    model: "gemini-2.5-flash-image",
    keyEnvOverride: null,
    verbose: false,
    help: false,
  };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new GenImageError(1, `${a} requires a value`);
      return v;
    };
    switch (a) {
      case "-o": case "--output":   args.output = next(); break;
      case "-i": case "--input":    args.inputs.push(next()); break;
      case "-p": case "--prompt":   args.prompt = next(); break;
      case "-m": case "--model":    args.model = next(); break;
      case "-k": case "--key-env":  args.keyEnvOverride = next(); break;
      case "-v": case "--verbose":  args.verbose = true; break;
      case "-h": case "--help":     args.help = true; break;
      default:
        if (a.startsWith("-")) throw new GenImageError(1, `unknown option: ${a}`);
        positional.push(a);
    }
  }
  if (positional.length > 1) {
    throw new GenImageError(1, "at most one positional prompt argument allowed");
  }
  if (positional.length === 1 && args.prompt === null) {
    args.prompt = positional[0] as string;
  }
  return args;
}

async function printHelp(): Promise<void> {
  const src = await readFile(SELF, "utf8");
  const lines = src.split("\n");
  const start = lines.findIndex((l) => l.startsWith("/**"));
  const end = lines.findIndex((l, idx) => idx > start && l.includes("*/"));
  if (start === -1 || end === -1) {
    console.log("gen-image — see source for usage.");
    return;
  }
  console.log(
    lines.slice(start + 1, end)
      .map((l) => l.replace(/^ \* ?/, ""))
      .join("\n")
      .trim(),
  );
}

function mimeFor(path: string): string {
  return extensionToMimetype(extname(path).toLowerCase(), { fallback: "image/png" });
}

async function readPromptFromStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) {
    chunks.push(typeof c === "string" ? Buffer.from(c) : c);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

function resolveApiKey(override: string | null): { key: string; from: string } {
  const candidates = override !== null ? [override] : [
    "SKE_GEMINI_API_KEY",
    "GEMINI_KEY",
    "GOOGLE_API_KEY",
  ];
  for (const name of candidates) {
    const v = process.env[name];
    if (v !== undefined && v.length > 0) return { key: v, from: name };
  }
  throw new GenImageError(
    1,
    `no API key found in ${candidates.join(", ")} — set one or pass -k`,
  );
}

interface InlineDataPart { inlineData: { mimeType: string; data: string } }
interface TextPart { text: string }
type ResponsePart = InlineDataPart | TextPart;
interface GenerateResponse {
  candidates?: Array<{ content?: { parts?: ResponsePart[] } }>;
}

function hasInlineData(p: ResponsePart): p is InlineDataPart {
  return "inlineData" in p && p.inlineData !== undefined && p.inlineData.data.length > 0;
}
function hasText(p: ResponsePart): p is TextPart {
  return "text" in p && p.text.length > 0;
}

function firstImagePart(response: GenerateResponse): InlineDataPart | null {
  const candidates = response.candidates;
  if (candidates === undefined || candidates.length === 0) return null;
  const first = candidates[0];
  if (first === undefined) return null;
  const content = first.content;
  if (content === undefined || content.parts === undefined) return null;
  for (const p of content.parts) {
    if (hasInlineData(p)) return p;
  }
  return null;
}

function textParts(response: GenerateResponse): string[] {
  const out: string[] = [];
  const candidates = response.candidates;
  if (candidates === undefined || candidates.length === 0) return out;
  const first = candidates[0];
  if (first === undefined) return out;
  const content = first.content;
  if (content === undefined || content.parts === undefined) return out;
  for (const p of content.parts) {
    if (hasText(p)) out.push(p.text);
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    await printHelp();
    return;
  }
  if (args.output === null) {
    throw new GenImageError(1, "-o/--output is required");
  }

  let prompt = args.prompt;
  if (prompt === null || prompt.length === 0) prompt = await readPromptFromStdin();
  if (prompt.length === 0) {
    throw new GenImageError(1, "no prompt (pass as arg, -p, or via stdin)");
  }

  const { key, from } = resolveApiKey(args.keyEnvOverride);
  if (args.verbose) console.error(`gen-image: using key from $${from}`);

  const parts: ContentPart[] = [{ text: prompt }];
  for (const ipath of args.inputs) {
    const buf = await readFile(ipath);
    parts.push({
      inlineData: { mimeType: mimeFor(ipath), data: buf.toString("base64") },
    });
  }

  const ai = new GoogleGenAI({ apiKey: key });
  let response: GenerateResponse;
  try {
    response = (await ai.models.generateContent({
      model: args.model,
      contents: parts,
      config: { responseModalities: ["TEXT", "IMAGE"] },
    })) as unknown as GenerateResponse;
  } catch (err) {
    const e = err as { status?: number; message?: string };
    if (e.status === 429) {
      throw new GenImageError(
        3,
        `429 quota exceeded on $${from}.\n` +
        "  Try a different key with -k, e.g.:\n" +
        "    gen-image -k SKE_GEMINI_API_KEY ...",
      );
    }
    const msg = e.message !== undefined ? e.message : String(err);
    throw new GenImageError(3, `API error: ${msg}`);
  }

  if (args.verbose) {
    for (const t of textParts(response)) {
      console.error(`gen-image: model text: ${t.trim()}`);
    }
  }

  const part = firstImagePart(response);
  if (part === null) throw new GenImageError(2, "no image part in response");

  await writeFile(args.output, Buffer.from(part.inlineData.data, "base64"));
  console.log(resolve(args.output));
}

main().catch((err: unknown) => {
  if (err instanceof GenImageError) {
    console.error(`gen-image: ${err.message}`);
    if (err.exitCode === 1) console.error("try: gen-image --help");
    process.exit(err.exitCode);
  }
  const e = err as { stack?: string };
  console.error(`gen-image: ${e.stack !== undefined ? e.stack : String(err)}`);
  process.exit(3);
});
