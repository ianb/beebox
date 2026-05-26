import { run } from "../runner.js";

export async function getUrl(): Promise<string> {
  const { stdout } = await run(["get", "url"]);
  return stdout.trim();
}

export async function getTitle(): Promise<string> {
  const { stdout } = await run(["get", "title"]);
  return stdout.trim();
}
