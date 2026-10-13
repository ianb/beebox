/**
 * Copy a box file's contents to the clipboard from a click.
 *
 * The fetch runs inside the ClipboardItem's promise, so the write starts
 * synchronously in the click handler. Safari refuses a clipboard write that
 * starts after an `await`, because the user activation has expired by then.
 */

import { apiRawFileUrl, getApiBase } from "../api";
import { RequestError } from "./errors";

/** The image could not be redrawn as PNG for the clipboard. */
class ImageCopyError extends Error {
  constructor() {
    super("Could not convert the image to PNG for the clipboard");
    this.name = "ImageCopyError";
  }
}

async function fetchFile(path: string): Promise<Blob> {
  const response = await fetch(apiRawFileUrl(getApiBase(), path));
  if (!response.ok) {
    const message = `Could not load ${path}: ${response.status} ${response.statusText}`;
    throw new RequestError(message);
  }
  return response.blob();
}

/** The file's verbatim text: a card's frontmatter and body, a markdown or CSV file as stored. */
export function copyFileText(path: string): Promise<void> {
  const text = fetchFile(path).then(async (blob) => new Blob([await blob.text()], { type: "text/plain" }));
  return navigator.clipboard.write([new ClipboardItem({ "text/plain": text })]);
}

/** Browsers accept only PNG image data on the clipboard, so other formats are redrawn as PNG. */
async function asPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (context === null) throw new ImageCopyError();
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((png) => { if (png) resolve(png); else reject(new ImageCopyError()); }, "image/png");
  });
}

/** The image file itself, as PNG. */
export function copyImageFile(path: string): Promise<void> {
  return navigator.clipboard.write([new ClipboardItem({ "image/png": fetchFile(path).then(asPng) })]);
}
