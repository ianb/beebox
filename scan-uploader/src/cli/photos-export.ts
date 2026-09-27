/** Optional Apple Photos import stage. osxphotos remains an external macOS CLI. */
import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { TargetConfig } from "./config.js";
import { PhotosAccessError, PhotosExportError, PhotosTimeoutError, PhotosToolMissingError } from "./errors.js";

const EXPORT_TIMEOUT_MS = 10 * 60 * 1000;
const UPLOADABLE = /\.(jpe?g|png|tiff?|pdf)$/i;

export async function exportPhotos(target: TargetConfig): Promise<number> {
  if (target.photos === undefined) return 0;
  const before = new Set((await readdir(target.folder)).filter((name) => UPLOADABLE.test(name)));
  const result = await runExport(target, target.photos.album);
  if (result.code !== 0) {
    const detail = `${result.stdout}\n${result.stderr}`;
    if (/full disk access|not authorized|permission denied|operation not permitted/i.test(detail)) {
      throw new PhotosAccessError(target.photos.album);
    }
    throw new PhotosExportError({ album: target.photos.album, code: result.code, detail: detail.trim() });
  }
  const after = (await readdir(target.folder)).filter((name) => UPLOADABLE.test(name));
  return after.filter((name) => !before.has(name)).length;
}

interface ExportResult { readonly code: number | null; readonly stdout: string; readonly stderr: string }

function runExport(target: TargetConfig, album: string): Promise<ExportResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("osxphotos", ["export", target.folder, "--album", album, "--update", "--convert-to-jpeg", "--download-missing", "--skip-live"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new PhotosTimeoutError()); }, EXPORT_TIMEOUT_MS);
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (error.code === "ENOENT") reject(new PhotosToolMissingError());
      else reject(error);
    });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
