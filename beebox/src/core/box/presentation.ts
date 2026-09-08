import {
  parsePresentationConfig,
  type PresentationConfigResult,
} from "../../shared/card-theme.js";
import { loadBoxConfigResult } from "./config.js";

/** Read and validate only the presentation subtree without changing other settings. */
export async function loadPresentationConfig(boxRoot: string): Promise<PresentationConfigResult> {
  const loaded = await loadBoxConfigResult(boxRoot);
  if (loaded.status === "absent") return { status: "absent" };
  if (loaded.status === "invalid") {
    return {
      status: "invalid",
      problems: [loaded.error],
      requested: null,
    };
  }
  return parsePresentationConfig(loaded.config.presentation);
}
