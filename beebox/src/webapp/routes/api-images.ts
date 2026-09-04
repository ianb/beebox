import type { FastifyInstance } from "fastify";
import type { Metadata } from "sharp";
import { BoxImageError, resolveBoxImage } from "../box-image.js";
import { fileEtag } from "../file-etag.js";
import { ImageTransformCache } from "../image-transform-cache.js";
import {
  ImageOptionError,
  imageTransformCacheKey,
  parseImageTransformOptions,
  type ImageTransformOptions,
} from "../image-transform-options.js";

const CONTENT_TYPES = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
} as const;

class ImageDecodeError extends Error {
  constructor(cause: unknown) {
    super("Image could not be transformed", { cause });
    this.name = "ImageDecodeError";
  }
}

function physicalDimension(value: number | undefined, dpr: number): number | undefined {
  return value === undefined ? undefined : Math.round(value * dpr);
}

async function transformImage(source: string, options: ImageTransformOptions): Promise<Buffer> {
  const { default: Sharp } = await import("sharp");
  let metadata: Metadata;
  try {
    metadata = await Sharp(source, { limitInputPixels: 64 * 1024 * 1024 }).metadata();
  } catch (error) {
    throw new ImageDecodeError(error);
  }
  const width = physicalDimension(options.width, options.dpr);
  const height = physicalDimension(options.height, options.dpr);
  const orientedWidth = metadata.autoOrient.width;
  const orientedHeight = metadata.autoOrient.height;
  let fit: "cover" | "inside" = options.fit === "cover" || options.fit === "crop" ? "cover" : "inside";
  let withoutEnlargement = options.fit === "scale-down";
  if (
    options.fit === "crop" &&
    (width === undefined || orientedWidth <= width) &&
    (height === undefined || orientedHeight <= height)
  ) {
    fit = "inside";
    withoutEnlargement = true;
  }
  let pipeline = Sharp(source, { limitInputPixels: 64 * 1024 * 1024 }).rotate().resize({
    width,
    height,
    fit,
    withoutEnlargement,
    ...(options.fit === "pad" ? { fit: "contain" as const, background: "#ffffff" } : {}),
  });
  if (options.format === "avif") pipeline = pipeline.avif({ quality: options.quality, effort: 1 });
  else if (options.format === "webp") pipeline = pipeline.webp({ quality: options.quality, effort: 4 });
  else pipeline = pipeline.jpeg({ quality: options.quality, progressive: true });
  return pipeline.toBuffer();
}

export function registerApiImagesRoutes({ server, boxRoot }: { server: FastifyInstance; boxRoot: string }): void {
  const cache = new ImageTransformCache(boxRoot);
  server.get<{ Params: { "*": string | undefined }; Querystring: Record<string, unknown> }>(
    "/api/images/*",
    { exposeHeadRoute: true },
    async (request, reply) => {
      let parsed: ReturnType<typeof parseImageTransformOptions>;
      try {
        parsed = parseImageTransformOptions(request.query, request.headers.accept);
      } catch (error) {
        if (error instanceof ImageOptionError) {
          return reply.status(400).send({ error: error.message, option: error.option });
        }
        throw error;
      }

      try {
        const source = await resolveBoxImage(boxRoot, request.params["*"] ?? "");
        const sourceVersion = fileEtag(source.stat);
        const key = imageTransformCacheKey({ sourcePath: source.relativePath, sourceVersion, options: parsed.options });
        let content: Buffer;
        try {
          content = await cache.getOrCreate({
            key,
            extension: parsed.options.format,
            generate: () => transformImage(source.absolutePath, parsed.options),
          });
        } catch (error) {
          if (!(error instanceof ImageDecodeError)) throw error;
          console.warn(`[api-images] could not transform ${source.relativePath}:`, error);
          return reply.status(415).send({ error: "Image could not be transformed" });
        }
        const etag = `"${key}"`;
        const response = reply
          .header("Content-Type", CONTENT_TYPES[parsed.options.format])
          .header("X-Content-Type-Options", "nosniff")
          .header("Cache-Control", "no-cache")
          .header("ETag", etag)
          .header("Last-Modified", source.stat.mtime.toUTCString());
        if (parsed.negotiated) response.header("Vary", "Accept");
        if (request.headers["if-none-match"] === etag) return response.status(304).send();
        return response.send(content);
      } catch (error) {
        if (error instanceof BoxImageError) return reply.status(error.statusCode).send(error.body);
        console.warn(`[api-images] could not serve ${request.params["*"] ?? ""}:`, error);
        return reply.status(500).send({ error: "Image transformation failed" });
      }
    },
  );
}
