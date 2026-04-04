/**
 * Image card renderer — shows the photo with subject bounding box overlay,
 * rotation correction, description, and extracted text.
 */

import { useState } from "react";
import { Markdown } from "../components/Markdown";
import { ImageLightbox } from "../components/ImageLightbox";
import { getApiBase } from "../api";
import type { RendererProps } from "./index";
import { registerCardRenderer } from "./index";
import type { ElementNode } from "../api";

interface ParsedImageCard {
  filename: string | null;
  description: string | null;
  status: string;
  hasText: boolean;
  rotation: number;
  subjectBbox: { y1: number; x1: number; y2: number; x2: number } | null;
  textBlocks: Array<{ source: string; text: string }>;
  exif: Record<string, string>;
}

function parseImageCard(element: ElementNode): ParsedImageCard {
  const children = (element.children || []) as ElementNode[];

  const filenameEl = children.find((c) => c.tagName === "filename");
  const descEl = children.find((c) => c.tagName === "description");
  const bboxEl = children.find((c) => c.tagName === "subject-bbox");
  const exifEl = children.find((c) => c.tagName === "exif");

  const textBlocks = children
    .filter((c) => c.tagName === "text")
    .map((c) => ({ source: c.attrs.source || "unknown", text: c.text || "" }));

  const rotation = parseInt(element.attrs.rotation || "0", 10);

  return {
    filename: filenameEl ? (filenameEl.attrs.name as string) : null,
    description: descEl ? (descEl.text as string) || null : null,
    status: (element.attrs.status as string) || "new",
    hasText: element.attrs["has-text"] === "true",
    rotation: [0, 90, 180, 270].includes(rotation) ? rotation : 0,
    subjectBbox: bboxEl ? {
      y1: parseInt(bboxEl.attrs.y1 as string, 10),
      x1: parseInt(bboxEl.attrs.x1 as string, 10),
      y2: parseInt(bboxEl.attrs.y2 as string, 10),
      x2: parseInt(bboxEl.attrs.x2 as string, 10),
    } : null,
    textBlocks,
    exif: exifEl ? { ...exifEl.attrs } as Record<string, string> : {},
  };
}

function ImageCardRenderer({ data }: RendererProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [showBbox, setShowBbox] = useState(true);

  if (!data.element) return null;

  const card = parseImageCard(data.element as ElementNode);
  if (!card.filename) return null;

  const cardDir = data.path.split("/").slice(0, -1).join("/");
  const imageSrc = `${getApiBase()}/files/${cardDir}/${card.filename}`;

  const rotationStyle = card.rotation !== 0
    ? { transform: `rotate(${card.rotation}deg)` }
    : undefined;

  // For 90/270 rotation, the image dimensions swap, so we need to adjust the container
  const isOrthogonal = card.rotation === 90 || card.rotation === 270;

  return (
    <div>
      {/* Image with bbox overlay */}
      <div className="relative inline-block mb-3">
        <div
          className={isOrthogonal ? "flex items-center justify-center" : ""}
          style={isOrthogonal ? { padding: "15% 0" } : undefined}
        >
          <img
            src={imageSrc}
            alt={card.description || card.filename}
            className="max-w-full max-h-[32rem] rounded border border-warm-300 cursor-pointer hover:opacity-90 transition-opacity"
            style={rotationStyle}
            onClick={() => setLightboxOpen(true)}
            title="Click to zoom"
          />
        </div>
        {showBbox && card.subjectBbox ? (
          <div
            className="absolute border-2 border-plum rounded pointer-events-none"
            style={rotationStyle ? {
              // When rotated, bbox coordinates are in the rotated frame
              top: `${card.subjectBbox.y1 / 10}%`,
              left: `${card.subjectBbox.x1 / 10}%`,
              width: `${(card.subjectBbox.x2 - card.subjectBbox.x1) / 10}%`,
              height: `${(card.subjectBbox.y2 - card.subjectBbox.y1) / 10}%`,
              transform: rotationStyle.transform,
            } : {
              top: `${card.subjectBbox.y1 / 10}%`,
              left: `${card.subjectBbox.x1 / 10}%`,
              width: `${(card.subjectBbox.x2 - card.subjectBbox.x1) / 10}%`,
              height: `${(card.subjectBbox.y2 - card.subjectBbox.y1) / 10}%`,
            }}
          />
        ) : null}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mb-3 text-xs text-warm-500">
        {card.subjectBbox ? (
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={showBbox}
              onChange={(e) => setShowBbox(e.target.checked)}
              className="rounded"
            />
            Show subject
          </label>
        ) : null}
        {card.rotation !== 0 ? (
          <span>Rotation: {card.rotation}deg</span>
        ) : null}
        {card.exif.camera ? (
          <span>{card.exif.camera}</span>
        ) : null}
        {card.exif.date ? (
          <span>{new Date(card.exif.date).toLocaleString()}</span>
        ) : null}
      </div>

      {/* Description */}
      {card.description ? (
        <p className="text-warm-700 text-sm mb-3">{card.description}</p>
      ) : null}

      {/* Extracted text */}
      {card.textBlocks.length > 0 ? (
        <div className="space-y-2">
          {card.textBlocks.map((block, i) => (
            <div key={i} className="border border-warm-200 rounded-lg p-3">
              <div className="text-xs text-warm-500 mb-1">{block.source}</div>
              <div className="prose prose-sm max-w-none text-warm-700">
                <Markdown>{block.text}</Markdown>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {lightboxOpen ? (
        <ImageLightbox
          src={imageSrc}
          alt={card.description || card.filename}
          onClose={() => setLightboxOpen(false)}
        />
      ) : null}
    </div>
  );
}

registerCardRenderer("image", {
  name: "Image",
  Component: ImageCardRenderer,
  priority: 50,
});
