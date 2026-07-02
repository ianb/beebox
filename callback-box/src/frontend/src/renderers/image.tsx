/**
 * Image card renderer — shows the photo with subject bounding box overlay,
 * rotation correction, description, and extracted text.
 */

import { useState } from "react";
import { Markdown } from "../components/Markdown";
import { Image } from "../components/ui/Image";
import { CheckboxField } from "../components/ui/fields";
import { Text } from "../components/ui/Text";
import { Row } from "../components/ui/Row";
import { Stack } from "../components/ui/Stack";
import { Card } from "../components/ui/Card";
import { BboxOverlay } from "../components/ui/BboxOverlay";
import { getApiBase } from "../api";
import type { RendererProps } from "./index";
import { registerCardRenderer, registerFileRenderer } from "./index";
import { resolveRelativePath } from "../lib/view-url";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function strOf(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

const RAW_IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i;

type Rotation = 0 | 90 | 180 | 270;

interface ParsedImageCard {
  filename: string | null;
  description: string | null;
  rotation: Rotation;
  subjectBbox: { y1: number; x1: number; y2: number; x2: number } | null;
  textBlocks: Array<{ source: string; text: string }>;
  exif: Record<string, string>;
}

function parseImageCard(fm: Record<string, unknown>): ParsedImageCard {
  const filenameRef = isRecord(fm.filename) ? strOf(fm.filename.ref) : null;
  const bbox = isRecord(fm["subject-bbox"]) ? fm["subject-bbox"] : null;

  const exif: Record<string, string> = {};
  if (isRecord(fm.exif)) {
    for (const [key, value] of Object.entries(fm.exif)) {
      if (typeof value === "string") exif[key] = value;
    }
  }

  const textBlocks = Array.isArray(fm.text)
    ? fm.text.flatMap((b) =>
        isRecord(b) && typeof b.content === "string"
          ? [{ source: strOf(b.source) ?? "unknown", text: b.content }]
          : [],
      )
    : [];

  const rawRotation = parseInt(strOf(fm.rotation) ?? "0", 10);
  const rotation: Rotation =
    rawRotation === 90 || rawRotation === 180 || rawRotation === 270 ? rawRotation : 0;

  const num = (v: unknown): number => parseInt(strOf(v) ?? "", 10);

  return {
    filename: filenameRef,
    description: strOf(fm.description),
    rotation,
    subjectBbox: bbox
      ? { y1: num(bbox.y1), x1: num(bbox.x1), y2: num(bbox.y2), x2: num(bbox.x2) }
      : null,
    textBlocks,
    exif,
  };
}

function ImageCardRenderer({ data, onNavigate, mode, caption }: RendererProps) {
  const [showBbox, setShowBbox] = useState(true);

  if (!data.frontmatter) return null;

  const card = parseImageCard(data.frontmatter);
  if (!card.filename) return null;

  // Resolve the ref against the card's path. Refs use the `attach/` virtual
  // prefix (e.g. `attach/photo-001.jpg`) which resolves to the card's
  // `<basename>.attach/` directory.
  const resolvedPath = resolveRelativePath(data.path, card.filename);
  const imageSrc = `${getApiBase()}/files/${resolvedPath}`;
  const altText = card.description || card.filename;

  // Embedded inline (`![caption](…image.card)`): render exactly like a
  // hot-linked image — the photo plus the embed's caption, no bbox controls,
  // exif, or extracted text (those belong to the full card). This is the image
  // *view* opting out of chrome for embeds only; page/companion (open-it-fully
  // surfaces) keep the full card.
  if (mode === "embed") {
    const embedCaption = caption && caption.trim() !== "" ? caption : card.description ?? undefined;
    // Centered like a hot-linked chat image (a captioned Image is an
    // inline-flex figure, so it needs a flex parent to center — mx-auto can't).
    return (
      <Row justify="center" className="my-2">
        <Image
          src={imageSrc}
          alt={caption ?? altText}
          size="chat"
          lightbox
          rotation={card.rotation}
          caption={embedCaption}
        />
      </Row>
    );
  }

  const rotationTransform = card.rotation !== 0 ? `rotate(${card.rotation}deg)` : undefined;
  const bbox = showBbox && card.subjectBbox ? (
    <BboxOverlay
      top={card.subjectBbox.y1 / 10}
      left={card.subjectBbox.x1 / 10}
      width={(card.subjectBbox.x2 - card.subjectBbox.x1) / 10}
      height={(card.subjectBbox.y2 - card.subjectBbox.y1) / 10}
      transform={rotationTransform}
    />
  ) : null;

  return (
    <div className="p-4">
      <Image
        src={imageSrc}
        alt={altText}
        size="lg"
        lightbox
        bordered
        rotation={card.rotation}
        overlay={bbox}
        className="mb-3"
      />

      {/* Controls */}
      <Row gap="md" className="mb-3">
        {card.subjectBbox ? (
          <CheckboxField
            label="Show subject"
            checked={showBbox}
            onChange={setShowBbox}
          />
        ) : null}
        {card.rotation !== 0 ? (
          <Text size="xs" tone="muted">Rotation: {card.rotation}deg</Text>
        ) : null}
        {card.exif.camera ? (
          <Text size="xs" tone="muted">{card.exif.camera}</Text>
        ) : null}
        {card.exif.date ? (
          <Text size="xs" tone="muted">{new Date(card.exif.date).toLocaleString()}</Text>
        ) : null}
      </Row>

      {/* Description */}
      {card.description ? (
        <Text as="p" size="sm" tone="emphasis" className="mb-3">{card.description}</Text>
      ) : null}

      {/* Extracted text */}
      {card.textBlocks.length > 0 ? (
        <Stack gap="sm">
          {card.textBlocks.map((block, i) => (
            <Card key={i} padding="sm" border="subtle">
              <Text size="xs" tone="muted" as="div" className="mb-1">{block.source}</Text>
              <Markdown prose="block" onNavigate={onNavigate} basePath={data.path}>{block.text}</Markdown>
            </Card>
          ))}
        </Stack>
      ) : null}
    </div>
  );
}

registerCardRenderer("image", {
  name: "Image",
  Component: ImageCardRenderer,
  priority: 50,
});

function RawImageRenderer({ data }: RendererProps) {
  const basename = data.path.split("/").pop() || data.path;
  return (
    <div className="p-4">
      <Image
        src={`${getApiBase()}/files/${data.path}`}
        alt={basename}
        size="lg"
        lightbox
        bordered
      />
    </div>
  );
}

registerFileRenderer(
  (path) => RAW_IMAGE_EXT.test(path),
  { name: "Image", Component: RawImageRenderer, priority: 30 },
);
