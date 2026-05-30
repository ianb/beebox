/**
 * Gmail commit-message building — formats a human-readable commit subject and
 * body summarizing the threads pulled in a sync (new vs. updated, capped).
 */

export interface ThreadNote {
  subject: string;
  from: string;
  isNew: boolean;
  messageCount: number;
}

function displayName(from: string): string {
  const match = from.match(/^(.+?)\s*<[^>]+>$/);
  return match ? match[1]!.trim() : from;
}

export function buildGmailCommitMessage(notes: ThreadNote[], fileCount: number): string {
  const subject = `Pull ${notes.length} Gmail thread${notes.length === 1 ? "" : "s"} (${fileCount} file${fileCount === 1 ? "" : "s"})`;
  if (notes.length === 0) return subject;

  const newThreads = notes.filter((n) => n.isNew);
  const updatedThreads = notes.filter((n) => !n.isNew);
  const lines = [subject, ""];
  const cap = 5;

  if (newThreads.length > 0) {
    lines.push("New:");
    for (const n of newThreads.slice(0, cap)) {
      lines.push(`- "${n.subject}" from ${displayName(n.from)}`);
    }
    if (newThreads.length > cap) {
      lines.push(`  + ${newThreads.length - cap} more`);
    }
    if (updatedThreads.length > 0) lines.push("");
  }

  if (updatedThreads.length > 0) {
    lines.push("Updated:");
    for (const n of updatedThreads.slice(0, cap)) {
      lines.push(`- "${n.subject}" (+${n.messageCount} message${n.messageCount === 1 ? "" : "s"})`);
    }
    if (updatedThreads.length > cap) {
      lines.push(`  + ${updatedThreads.length - cap} more`);
    }
  }

  return lines.join("\n").trimEnd();
}
