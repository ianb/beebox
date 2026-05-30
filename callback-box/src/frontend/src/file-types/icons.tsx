/**
 * Canonical icon set for file types. Types pick from this fixed vocabulary
 * rather than inventing bespoke icons. Grouping is by kind (document, audio,
 * image, etc.), not by card type — many card types share an icon.
 *
 * All icons accept a `size` prop (pixel dimension, defaults to 16).
 */

interface IconProps {
  size?: number;
}

function stroke({ size, d }: { size?: number; d: string }) {
  size = size ?? 16;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export function DocumentIcon(props: IconProps) {
  return stroke({
    size: props.size,
    d: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6zM14 3v6h6M8 13h8M8 17h8M8 9h3",
  });
}

export function CardIcon(props: IconProps) {
  return stroke({
    size: props.size,
    d: "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6zM8 9h8M8 13h5",
  });
}

export function ImageIcon(props: IconProps) {
  return stroke({
    size: props.size,
    d: "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5zM8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM4 17l5-5 4 4 3-3 4 4",
  });
}

export function AudioIcon(props: IconProps) {
  return stroke({
    size: props.size,
    d: "M12 3v12a3 3 0 1 1-3-3h3M12 3l7-1v10a3 3 0 1 1-3-3h3",
  });
}

export function DirectoryIcon(props: IconProps) {
  return stroke({
    size: props.size,
    d: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z",
  });
}

export function DataIcon(props: IconProps) {
  return stroke({
    size: props.size,
    d: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6zM4 6c0 1.7 3.6 3 8 3s8-1.3 8-3M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  });
}

export function JobIcon(props: IconProps) {
  return stroke({
    size: props.size,
    d: "M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  });
}

export function QuestionIcon(props: IconProps) {
  return stroke({
    size: props.size,
    d: "M12 16v.01M9 9a3 3 0 1 1 4.2 2.8c-.8.4-1.2 1-1.2 1.7v.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  });
}

export function GenericIcon(props: IconProps) {
  return stroke({
    size: props.size,
    d: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6zM14 3v6h6",
  });
}

export type FileIcon = (props: IconProps) => JSX.Element;
