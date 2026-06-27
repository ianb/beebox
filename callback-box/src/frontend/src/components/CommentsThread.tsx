/**
 * CommentsThread — presentational threaded view of Google Drive comments.
 *
 * Renders the raw objects from a `<basename>.comments.json` sidecar (written by
 * the drive connector) as a readable thread: author, date, resolved status, the
 * anchored quote, the body, and nested replies. Pure — it takes already-parsed
 * comments and just renders; fetching and the loading/empty/error states live
 * in the container (`AttachedComments`) or the file renderer.
 *
 * Resolved comments are kept visible (nothing hidden) but dimmed and badged, so
 * live feedback stands out without losing the record of what was settled.
 */

import { Stack } from "./ui/Stack";
import { Row } from "./ui/Row";
import { Card } from "./ui/Card";
import { Text } from "./ui/Text";
import { Badge } from "./ui/Badge";
import { Avatar } from "./ui/Avatar";
import { FriendlyDate } from "./ui/FriendlyDate";

// ─── Types + parsing (the JSON arrives untyped at this boundary) ──────────────

export interface ThreadReply {
  id: string;
  content: string;
  authorName: string | null;
  authorEmail: string | null;
  time: string | null;
}

export interface ThreadComment extends ThreadReply {
  resolved: boolean;
  quoted: string | null;
  replies: ThreadReply[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function parseAuthor(v: unknown): { name: string | null; email: string | null } {
  if (!isRecord(v)) return { name: null, email: null };
  return { name: strOrNull(v.displayName), email: strOrNull(v.emailAddress) };
}

function parseReply(v: unknown): ThreadReply {
  const rec = isRecord(v) ? v : {};
  const author = parseAuthor(rec.author);
  return {
    id: str(rec.id),
    content: str(rec.content),
    authorName: author.name,
    authorEmail: author.email,
    time: strOrNull(rec.modifiedTime) ?? strOrNull(rec.createdTime),
  };
}

/**
 * Parse the untyped sidecar JSON (an array of comment objects) into the typed
 * shape this component renders. Tolerant of missing fields — anything that
 * isn't an array yields no comments.
 */
export function parseComments(value: unknown): ThreadComment[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const rec = isRecord(raw) ? raw : {};
    const reply = parseReply(rec);
    const quotedContent = isRecord(rec.quotedFileContent)
      ? strOrNull(rec.quotedFileContent.value)
      : null;
    return {
      ...reply,
      resolved: rec.resolved === true,
      quoted: quotedContent,
      replies: Array.isArray(rec.replies) ? rec.replies.map(parseReply) : [],
    };
  });
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function authorLabel(name: string | null, email: string | null): string {
  return name ?? email ?? "Unknown";
}

function AuthorLine({
  name,
  email,
  time,
}: {
  name: string | null;
  email: string | null;
  time: string | null;
}) {
  return (
    <Row gap="sm" align="center" wrap>
      <Avatar size="sm" name={name} email={email} />
      <Text size="sm" weight="medium">{authorLabel(name, email)}</Text>
      {time !== null ? (
        <Text size="xs" tone="subtle">
          <FriendlyDate iso={time} />
        </Text>
      ) : null}
    </Row>
  );
}

function Body({ content }: { content: string }) {
  // Preserve the author's line breaks; comment bodies are plain text.
  return (
    <Text as="p" size="sm" className="whitespace-pre-wrap break-words">
      {content}
    </Text>
  );
}

function Reply({ reply }: { reply: ThreadReply }) {
  return (
    <Stack gap="xs" className="border-l-2 border-warm-200 pl-3">
      <AuthorLine name={reply.authorName} email={reply.authorEmail} time={reply.time} />
      <Body content={reply.content} />
    </Stack>
  );
}

function CommentItem({ comment }: { comment: ThreadComment }) {
  return (
    <Card padding="md" border="subtle" muted={comment.resolved}>
      <Stack gap="sm">
        <Row gap="sm" align="center" justify="between" wrap>
          <AuthorLine name={comment.authorName} email={comment.authorEmail} time={comment.time} />
          {comment.resolved ? <Badge tone="success">Resolved</Badge> : null}
        </Row>

        {comment.quoted !== null ? (
          <Text
            as="div"
            size="xs"
            tone="subtle"
            italic
            className="border-l-2 border-warm-300 pl-3 whitespace-pre-wrap break-words"
          >
            {comment.quoted}
          </Text>
        ) : null}

        <Body content={comment.content} />

        {comment.replies.length > 0 ? (
          <Stack gap="sm" className="mt-1">
            {comment.replies.map((reply, i) => (
              <Reply key={reply.id || i} reply={reply} />
            ))}
          </Stack>
        ) : null}
      </Stack>
    </Card>
  );
}

export function CommentsThread({ comments }: { comments: ThreadComment[] }) {
  if (comments.length === 0) {
    return <Text as="div" size="sm" tone="subtle" italic>No comments.</Text>;
  }
  return (
    <Stack gap="md">
      {comments.map((comment, i) => (
        <CommentItem key={comment.id || i} comment={comment} />
      ))}
    </Stack>
  );
}
