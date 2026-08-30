/**
 * bbx usage — Token usage tracking and reporting.
 *
 * Syncs Claude Code session logs into a SQLite database for querying.
 * Data comes from two sources:
 *   - Session manifest (store/usage/session-manifest.jsonl) — maps sessions to tasks
 *   - Claude Code session logs (~/.claude/projects/...) — raw token counts
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths.js";
import { syncUsage, queryUsage, USAGE_SCHEMA_DESCRIPTION } from "../../core/usage.js";
import { invariant } from "../../lib/invariant.js";
import { isRecord } from "../../lib/is-record.js";

/** Print `rows` as an aligned, header-and-dashes text table. */
function printTable(rows: Array<Record<string, unknown>>): void {
  const first = rows[0];
  invariant(first !== undefined, "printTable requires at least one row");
  const keys = Object.keys(first);
  const widths = keys.map((k) => {
    const values = rows.map((r) => String(r[k] ?? ""));
    return Math.max(k.length, ...values.map((v) => v.length));
  });
  const formatRow = (values: string[]): string =>
    values
      .map((v, i) => {
        const width = widths[i];
        invariant(width !== undefined, `widths[${i}] must exist for 0 <= i < keys.length`);
        return v.padEnd(width);
      })
      .join("  ");

  console.log(formatRow(keys));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) {
    console.log(formatRow(keys.map((k) => String(row[k] ?? ""))));
  }
}

export const usageCommand = new Command("usage")
  .description("Token usage tracking and reporting")
  .option("--sync", "Sync session logs into usage database")
  .option("--sql <query>", "Run a SQL query against the usage database")
  .option("--schema", "Show the database schema and example queries")
  .action(async (options: { sync?: boolean; sql?: string; schema?: boolean }) => {
    const boxRoot = await requireBoxRoot();

    if (options.schema) {
      console.log(USAGE_SCHEMA_DESCRIPTION);
      return;
    }

    if (options.sync) {
      const result = await syncUsage(boxRoot);
      console.log(
        `Synced: ${result.sessionsProcessed} processed, ` +
        `${result.sessionsSkipped} up-to-date, ` +
        `${result.sessionsMissing} missing from manifest`
      );
      return;
    }

    if (options.sql) {
      // Auto-sync before querying
      await syncUsage(boxRoot);
      const rows = queryUsage(boxRoot, options.sql);
      if (rows.length === 0) {
        console.log("(no results)");
        return;
      }
      // Print as aligned table
      printTable(rows.filter(isRecord));
      return;
    }

    // Default: sync + show summary
    await syncUsage(boxRoot);
    const defaultQuery = `
      SELECT task, model,
        SUM(input_tokens) as input,
        SUM(output_tokens) as output,
        SUM(cache_write_tokens) as cache_write,
        SUM(cache_read_tokens) as cache_read,
        SUM(message_count) as messages,
        COUNT(DISTINCT session_id) as sessions
      FROM usage
      GROUP BY task, model
      ORDER BY output DESC
    `;
    const rows = queryUsage(boxRoot, defaultQuery);
    if (rows.length === 0) {
      console.log("No usage data yet. Run some agents first.");
      return;
    }
    printTable(rows.filter(isRecord));
  });
