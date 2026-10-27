/**
 * Absolute-positioned bounding box outline, meant to be placed inside an
 * `<Image overlay={...}>` wrapper. Coordinates are percentages of the photo
 * as stored; `Image` turns the overlay with a rotated photo.
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
}

export function BboxOverlay({ top, left, width, height }: BboxOverlayProps) {
  return (
    <div
      className="absolute border-2 border-primary rounded pointer-events-none"
      style={{
        top: `${top}%`,
        left: `${left}%`,
        width: `${width}%`,
        height: `${height}%`,
      }}
    />
  );
}
