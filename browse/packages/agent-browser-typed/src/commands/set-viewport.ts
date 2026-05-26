import { run } from "../runner.js";

export async function setViewport({ width, height, scale }: { width: number; height: number; scale?: number }): Promise<void> {
  const args: string[] = ["set", "viewport", String(width), String(height)];
  if (scale !== undefined) args.push(String(scale));
  await run(args);
}
