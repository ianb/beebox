/** Small DOM builders for the compose editor's widgets, which CodeMirror renders outside React. */

export function el(tag: "span" | "button", { className, text }: { className: string; text: string }): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

/** A widget button. `mousedown` is stopped so the editor does not move the cursor first. */
export function widgetButton({ text, label, onClick }: { text: string; label: string; onClick: () => void }): HTMLElement {
  const button = el("button", { className: "ml-1 rounded px-1 text-card-soft hover:bg-card-paper hover:text-card-ink", text });
  button.setAttribute("type", "button");
  button.setAttribute("aria-label", label);
  button.title = label;
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", onClick);
  return button;
}
