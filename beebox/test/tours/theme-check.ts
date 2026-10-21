/**
 * `bin/theme-check`: theme studio captures at desktop and phone width with
 * every contrast or material miss outlined and labelled. With one theme it is
 * the theme loop's screenshot step and always exits 0; `--all` walks the
 * catalog and exits 1 on any miss, for landing.
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { THEME_CATALOG } from "../../src/shared/card-theme/core.js";
import { BrowseSession } from "./tour-lib/browse.js";
import { auditContrast, describeContrastFailure } from "./tour-lib/contrast.js";

interface StudioCase {
  system: string;
  systemStock: string;
  card: string;
  cardStock: string;
}

/**
 * Every catalog theme in the studio: each system theme and stock on its own
 * card theme (or its first card theme when it has none), then each card stock
 * not yet covered under Flat.
 */
function catalogCases(): StudioCase[] {
  const cases: StudioCase[] = [];
  for (const theme of THEME_CATALOG) {
    if (!theme.chrome) continue;
    const card = theme.systemOnly ? THEME_CATALOG.find((t) => t.name === theme.cardThemes[0]) : theme;
    if (card === undefined) throw new Error(`${theme.name}: no card theme to pair with`);
    for (const stock of theme.stocks) {
      const cardStock = card === theme ? stock : card.defaultStock;
      cases.push({ system: theme.name, systemStock: stock, card: card.name, cardStock });
    }
  }
  for (const theme of THEME_CATALOG) {
    if (theme.systemOnly) continue;
    for (const stock of theme.stocks) {
      if (cases.some((c) => c.card === theme.name && c.cardStock === stock)) continue;
      cases.push({ system: "plain", systemStock: "neutral", card: theme.name, cardStock: stock });
    }
  }
  return cases;
}

/** Tall enough for the whole studio in one capture; text below it is reported as unmeasured. */
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 2400 },
  { name: "phone", width: 375, height: 4400 },
] as const;
type Viewport = (typeof VIEWPORTS)[number];

function caseName(c: StudioCase): string {
  const system = `${c.system}-${c.systemStock}`;
  return c.system === c.card && c.systemStock === c.cardStock ? system : `${system}+${c.card}-${c.cardStock}`;
}


async function checkCase(session: BrowseSession, { c, vp, outDir }: { c: StudioCase; vp: Viewport; outDir: string }): Promise<number> {
  await session.open(`/dev/theme-studio?${new URLSearchParams({ ...c }).toString()}`);
  const result = await auditContrast(session, { outline: true });
  const shot = path.join(outDir, `${caseName(c)}.${vp.name}.png`);
  await session.screenshot(shot);
  const lines = result.failures.map((f) => `  ${describeContrastFailure(f)}\n`);
  // Missed coverage counts as a miss: an unmeasured run is not a passing one.
  if (result.offscreen > 0) lines.push(`  ${String(result.offscreen)} text runs below the ${String(vp.height)}px capture were not measured\n`);
  if (result.unmeasured > 0) lines.push(`  ${String(result.unmeasured)} text runs were not measurable (partly covered, or in a faded group over an image)\n`);
  const misses = result.failures.length + result.offscreen + result.unmeasured;
  process.stdout.write(`${caseName(c)} ${vp.name}: ${misses === 0 ? "ok" : `${String(misses)} to fix`} (${String(result.runs)} text runs)\n${lines.join("")}  → ${shot}\n`);
  return misses;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      system: { type: "string", default: "draft" },
      "system-stock": { type: "string", default: "neutral" },
      card: { type: "string" },
      "card-stock": { type: "string" },
      all: { type: "boolean", default: false },
      out: { type: "string" },
    },
  });
  const outDir = path.resolve(values.out ?? path.join(import.meta.dirname, ".artifacts", "theme-check"));
  await mkdir(outDir, { recursive: true });
  const cases = values.all ? catalogCases() : [{
    system: values.system,
    systemStock: values["system-stock"],
    card: values.card ?? values.system,
    cardStock: values["card-stock"] ?? values["system-stock"],
  }];
  const session = new BrowseSession("theme-check");
  let misses = 0;
  try {
    for (const vp of VIEWPORTS) {
      await session.setViewport(vp.width, vp.height);
      for (const c of cases) misses += await checkCase(session, { c, vp, outDir });
    }
  } finally {
    await session.close();
  }
  process.stdout.write(misses === 0 ? "No contrast or material misses measured.\n" : `${String(misses)} misses.\n`);
  return values.all && misses > 0 ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((e: unknown) => {
  process.stderr.write(`theme-check: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(2);
});
