import { run } from "../runner.js";

export interface ScreenshotOptions {
  path: string;
  selector?: string;
  full?: boolean;
  annotate?: boolean;
}

export interface ScreenshotResult {
  path: string;
}

export async function screenshot(options: ScreenshotOptions): Promise<ScreenshotResult> {
  const { path, selector, full, annotate } = options;
  const args: string[] = ["screenshot"];
  if (selector !== undefined) args.push(selector);
  args.push(path);
  if (full === true) args.push("--full");
  if (annotate === true) args.push("--annotate");
  await run(args);
  return { path };
}
