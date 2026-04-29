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
import type { ElementNode } from "../api";

const RAW_IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i;

type Rotation = 0 | 90 | 180 | 270;

interface ParsedImageCard {
  filename: string | null;
  description: string | null;
  status: string;
  hasText: boolean;
  rotation: Rotation;
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

  const rawRotation = parseInt(element.attrs.rotation || "0", 10);
  const rotation: Rotation =
    rawRotation === 90 || rawRotation === 180 || rawRotation === 270 ? rawRotation : 0;

  return {
    filename: filenameEl ? (filenameEl.attrs.name as string) : null,
    description: descEl ? (descEl.text as string) || null : null,
    status: (element.attrs.status as string) || "new",
    hasText: element.attrs["has-text"] === "true",
    rotation,
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

function ImageCardRenderer({ data, onNavigate }: RendererProps) {
  const [showBbox, setShowBbox] = useState(true);

  if (!data.element) return null;

  const card = parseImageCard(data.element as ElementNode);
  if (!card.filename) return null;

  const cardDir = data.path.split("/").slice(0, -1).join("/");
  const imageSrc = `${getApiBase()}/files/${cardDir}/${card.filename}`;
  const altText = card.description || card.filename;

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
