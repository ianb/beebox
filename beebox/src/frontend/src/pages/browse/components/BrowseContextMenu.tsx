/**
 * The browse page's context menu for a file row: a `Menu at` the pointer, or
 * below the row when opened from the keyboard (the ContextMenu key or
 * Shift+F10). Currently only has a Delete action.
 */

import type { KeyboardEvent, MouseEvent } from "react";
import { Menu } from "../../../components/ui/Menu";
import { MenuItem } from "../../../components/ui/menu-item";

export interface ContextMenuState {
  at: { x: number; y: number };
  openedBy: "pointer" | "keyboard";
  returnFocus: HTMLElement;
  path: string;
}

/** A row's `contextmenu` event, or its keydown (ignored unless ContextMenu or Shift+F10). */
export type FileContextMenuEvent = MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>;

/** The menu a row event opens, or null for a key that is not a context-menu key. */
export function contextMenuOpening(event: FileContextMenuEvent, path: string): ContextMenuState | null {
  const row = event.currentTarget;
  if ("key" in event) {
    if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return null;
    const rect = row.getBoundingClientRect();
    return { at: { x: rect.left, y: rect.bottom }, openedBy: "keyboard", returnFocus: row, path };
  }
  return { at: { x: event.clientX, y: event.clientY }, openedBy: "pointer", returnFocus: row, path };
}

export function BrowseContextMenu({ menu, deletingPath, onDelete, onClose }: {
  menu: ContextMenuState;
  deletingPath: string | null;
  onDelete: (path: string) => void | Promise<void>;
  onClose: () => void;
}) {
  return (
    <Menu at={menu.at} open openedBy={menu.openedBy} returnFocus={menu.returnFocus} onClose={onClose} width="w-40">
      <MenuItem id="bbx-browse-context-delete" danger disabled={deletingPath !== null} onClick={() => onDelete(menu.path)}>
        {deletingPath === menu.path ? "Deleting..." : "Delete"}
      </MenuItem>
    </Menu>
  );
}
