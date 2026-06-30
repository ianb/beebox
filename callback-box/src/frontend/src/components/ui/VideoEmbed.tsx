import { cn } from "../../lib/cn";

interface VideoEmbedProps {
  /** Embed URL ready for an iframe `src` (e.g. youtube-nocookie.com/embed/ID). */
  embedUrl: string;
  /** Accessible title for the player, typically the markdown image `alt`. */
  title: string;
  /** Outer-layout classes (margin, width, alignment). */
  className?: string;
}

/**
 * Responsive 16:9 embedded video player. Lazy-loads the iframe and uses the
 * privacy-friendly nocookie domain (supplied by the caller). Block-level —
 * meant to stand alone, like a figure.
 */
export function VideoEmbed({ embedUrl, title, className }: VideoEmbedProps) {
  return (
    <div className={cn("relative my-2 w-full max-w-2xl overflow-hidden rounded", className)}>
      <div className="relative w-full pb-[56.25%]">
        <iframe
          src={embedUrl}
          title={title}
          loading="lazy"
          className="absolute inset-0 h-full w-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    </div>
  );
}
