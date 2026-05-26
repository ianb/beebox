import { run } from "../runner.js";

export interface SnapshotOptions {
  interactive?: boolean;
  urls?: boolean;
  compact?: boolean;
  depth?: number;
  selector?: string;
  json?: boolean;
}

export async function snapshot(options: SnapshotOptions): Promise<string> {
  const { interactive, urls, compact, depth, selector, json } = options;
  const args: string[] = ["snapshot"];
  if (interactive === true) args.push("-i");
  if (urls === true) args.push("-u");
  if (compact === true) args.push("-c");
  if (depth !== undefined) args.push("-d", String(depth));
  if (selector !== undefined) args.push("-s", selector);
  if (json === true) args.push("--json");
  const { stdout } = await run(args);
  return stdout;
}
