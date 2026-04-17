/**
 * Absolute-positioned bounding box outline, meant to be placed inside an
 * `<Image overlay={...}>` wrapper. Coordinates are percentages relative to
 * the overlay container.
 */
export interface BboxOverlayProps {
  /** Top edge as percentage [0..100]. */
  top: number;
  /** Left edge as percentage [0..100]. */
  left: number;
  /** Width as percentage [0..100]. */
  width: number;
  /** Height as percentage [0..100]. */
  height: number;
  /** Additional transform (e.g. rotate) to match the underlying image. */
  transform?: string;
}

export function BboxOverlay({ top, left, width, height, transform }: BboxOverlayProps) {
  return (
    <div
      className="absolute border-2 border-plum rounded pointer-events-none"
      style={{
        top: `${top}%`,
        left: `${left}%`,
        width: `${width}%`,
        height: `${height}%`,
        transform,
      }}
    />
  );
}
