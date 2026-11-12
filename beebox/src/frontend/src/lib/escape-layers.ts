/**
 * The open layers that take Escape, in opening order. The last one opened
 * owns Escape: an anchored layer (`hooks/useDismiss`) and a modal dialog
 * (`hooks/useModalDialog`) each push one while open, so Escape in a popover
 * inside a modal closes the popover alone, and Escape in a modal opened from
 * a menu reaches the modal, not the menu.
 */

const layers: object[] = [];

export interface EscapeLayer {
  /** Whether this layer is the most recently opened one still open. */
  ownsEscape: () => boolean;
  /** Leave the stack. A second call does nothing. */
  release: () => void;
}

export function pushEscapeLayer(): EscapeLayer {
  const token = {};
  layers.push(token);
  return {
    ownsEscape: () => layers.at(-1) === token,
    release: () => {
      const index = layers.indexOf(token);
      if (index !== -1) layers.splice(index, 1);
    },
  };
}
