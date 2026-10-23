// CloseButton: the plain ghost look and the red attachment bubble both carry
// an accessible name, forward the id, and call onClick.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import { containing } from "@ianbicking/tap-check/check";
import { CloseButton, type CloseButtonProps } from "../../../src/components/ui/CloseButton.js";

async function buttonOf(props: Partial<CloseButtonProps>): Promise<{ name: string | null; title: string | null; id: string; classes: string[]; clicks: number }> {
  let clicks = 0;
  const view = await mount(h(CloseButton, { onClick: () => { clicks += 1; }, ...props }));
  const button = view.container.querySelector("button");
  await view.act(() => { button?.click(); });
  const result = {
    name: button?.getAttribute("aria-label") ?? null,
    title: button?.getAttribute("title") ?? null,
    id: button?.id ?? "",
    classes: [...(button?.classList ?? [])],
    clicks,
  };
  await view.unmount();
  return result;
}

void test("the plain variant is a gray round button named Close", async (t) => {
  const button = await buttonOf({});
  t.check(button.name, "Close");
  t.check(button.clicks, 1);
  t.check(button.classes, containing(["w-9", "bg-transparent"]));
});

void test("the bubble variant is a 20 px red circle with the caller's name, id and position", async (t) => {
  const button = await buttonOf({ variant: "bubble", label: "Remove attachment", id: "bbx-x", className: "absolute -top-2 -right-2" });
  t.check(button.name, "Remove attachment");
  t.check(button.title, "Remove attachment");
  t.check(button.id, "bbx-x");
  t.check(button.clicks, 1);
  t.check(button.classes, containing(["w-5", "h-5", "rounded-full", "bg-danger", "text-white", "absolute", "-top-2", "-right-2"]));
  t.check(button.classes.filter((name) => name === "w-9"), []);
});

void test("an absent id leaves the button without one", async (t) => {
  const button = await buttonOf({});
  t.check(button.id, "");
});
