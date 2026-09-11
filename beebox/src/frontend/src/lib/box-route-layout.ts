export const DEV_HARNESS_PATHS = {
  speech: "/dev/speech",
  composerStates: "/dev/composer-states",
  captureMode: "/dev/capture-mode",
  chatScroll: "/dev/chat-scroll",
} as const;
const DEV_HARNESS_PATH_SET: ReadonlySet<string> = new Set(Object.values(DEV_HARNESS_PATHS));

export function boxRouteSurface(path: string): "product" | "dev-harness" {
  return DEV_HARNESS_PATH_SET.has(path) ? "dev-harness" : "product";
}
