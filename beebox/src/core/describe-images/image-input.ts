/** Prepare stored scan images for vision providers using the bytes' real format. */
import * as fs from "node:fs/promises";
import type { Metadata } from "sharp";

export interface ScanVisionImageInput {
  data: Buffer;
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
}

/**
 * Read an image and return bytes whose MIME type is accepted by our vision
 * providers. Sharp reports AVIF as `heif`; those images are transcoded to JPEG
 * while supported formats pass through unchanged.
 */
export async function readScanVisionImage(imagePath: string): Promise<ScanVisionImageInput> {
  const source = await fs.readFile(imagePath);
  const { default: Sharp } = await import("sharp");
  const image = Sharp(source);
  const metadata = await image.metadata();
  const mediaTypeByFormat: Partial<Record<NonNullable<Metadata["format"]>, ScanVisionImageInput["mediaType"]>> = {
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  } as const;
  const mediaType = mediaTypeByFormat[metadata.format];
  if (mediaType !== undefined) return { data: source, mediaType };

  return { data: await image.rotate().jpeg({ quality: 88 }).toBuffer(), mediaType: "image/jpeg" };
}
