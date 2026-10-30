// # "Connect an agent" lands on the sign-in section
//
// The button opened Admin → Agents at the top, with the Claude Code and Codex
// sign-ins below the fold (`issues/closed/bugs/2026-10-25-connect-agent-button-lands-above-the-fold.md`).
// It now names the Claude Code section, and the Admin card scrolls to that
// section and focuses it.
// First, and bare: React DOM must load after the happy-dom window exists.
import { mount } from "../../helpers/dom-harness.js";
import { createElement as h } from "react";
import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { adminAgentsTarget } from "../../../src/components/agents/AgentReadiness.js";
import { AdminSectionCard } from "../../../src/components/admin/AdminSectionCard.js";
import { landOnSection } from "../../../src/components/admin/land-on-section.js";
import { parseAdminCardState } from "../../../src/lib/admin-card-state.js";

void test("the button's target names the Claude Code section", async (t) => {
  const target = adminAgentsTarget("box");
  t.check(target.to, "/box/views/_config/interface/admin.card");
  t.check(parseAdminCardState(target.search.viewState), { ok: true, arrival: {}, tab: null, section: "claude-code" });
});

void test("landing scrolls to the section and focuses it until focus moves on", async (t) => {
  const view = await mount(h("div", null,
    h(AdminSectionCard, { id: "agent-engine", children: "Engine picker" }),
    h(AdminSectionCard, { id: "claude-code", children: "Sign in" })));
  t.teardown(() => view.unmount());
  const section = document.getElementById("bbx-admin-claude-code");
  const scrolled: string[] = [];
  if (section !== null) section.scrollIntoView = () => { scrolled.push(section.id); };

  landOnSection("claude-code");
  await new Promise((resolve) => requestAnimationFrame(resolve));

  t.check({ scrolled, focused: document.activeElement?.id, tabindex: section?.getAttribute("tabindex") },
    { scrolled: ["bbx-admin-claude-code"], focused: "bbx-admin-claude-code", tabindex: "-1" });

  section?.blur();
  t.check(section?.getAttribute("tabindex"), null);
});
