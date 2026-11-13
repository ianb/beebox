import { useCallback, useRef, type ReactNode } from "react";

export interface FilePickerOptions {
  /** The input's `accept` list, such as `"image/*"`. */
  accept?: string;
  multiple?: boolean;
  /** The picked files; not called for a cancelled picker. */
  onFiles: (files: File[]) => void;
}

/**
 * A hidden file input opened from the caller's own button or menu item.
 * Render `input` anywhere in the tree and call `open` from the click handler.
 * The input is cleared after each pick, so picking the same file twice in a
 * row reports it twice.
 */
export function useFilePicker({ accept, multiple, onFiles }: FilePickerOptions): { open: () => void; input: ReactNode } {
  const ref = useRef<HTMLInputElement>(null);
  const open = useCallback(() => { ref.current?.click(); }, []);
  const input = (
    <input
      ref={ref}
      type="file"
      accept={accept}
      multiple={multiple}
      hidden
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (files.length > 0) onFiles(files);
      }}
    />
  );
  return { open, input };
}
