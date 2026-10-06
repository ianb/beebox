/** Whether focus remains inside an element after a blur event. */
export function focusRemainsWithin(element: HTMLElement, relatedTarget: EventTarget | null): boolean {
  return relatedTarget instanceof Node && element.contains(relatedTarget);
}
