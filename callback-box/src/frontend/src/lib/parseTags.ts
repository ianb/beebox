/**
 * Tag parser — adapted from memory-atlas/lib/parsetags.ts
 * Permissive parser for XML-like tags in assistant responses.
 */

import { parseAttrs } from "../../../shared/parse-attrs.js";
import { invariant } from "../../../shared/invariant.js";

export interface TagType {
  type: string;
  attrs: Record<string, string>;
  content: string;
  subTags?: TagType[];
}

export function parseTags(s: string, allowTags?: string[]): TagType[] {
  s = s.trim().replace(/^`+/, "").replace(/`+$/, "").trim();
  const root: TagType = { type: "root", attrs: {}, content: "" };
  const stack: { tag: TagType; startPos: number; contentStart: number }[] = [];
  const topTag = (): TagType => stack.at(-1)?.tag ?? root;
  let pos = 0;

  while (pos < s.length) {
    const restOfString = s.slice(pos);
    const nextMatch = restOfString.match(/<(\/)?([^\s/>]+)([^>]*?)(\/)?>/);
    if (!nextMatch) {
      const text = s.slice(pos);
      const currentTag = topTag();
      currentTag.content += text;
      const trimmedText = text.trim();
      if (trimmedText) {
        if (!currentTag.subTags) currentTag.subTags = [];
        currentTag.subTags.push({ type: "comment", attrs: {}, content: trimmedText });
      }
      pos = s.length;
      break;
    }

    invariant(nextMatch.index !== undefined, "a successful string match always has an index");
    // Group 2 (`[^\s/>]+`) always participates on a successful match — it's
    // not optional/alternated in the pattern — so the fallback is unreachable
    // in practice but honest to the regex-match type.
    const matchStart = pos + nextMatch.index;
    const matchEnd = matchStart + nextMatch[0].length;
    const isEnd = !!nextMatch[1];
    const tagName = nextMatch[2] ?? "";
    const tagAttrs = nextMatch[3] ?? "";
    const isSelfClosing = !!nextMatch[4];

    if (matchStart > pos) {
      const text = s.slice(pos, matchStart);
      const currentTag = topTag();
      currentTag.content += text;
      const trimmedText = text.trim();
      if (trimmedText) {
        if (!currentTag.subTags) currentTag.subTags = [];
        currentTag.subTags.push({ type: "comment", attrs: {}, content: trimmedText });
      }
    }

    if (isEnd) {
      // Closers of non-allowed tags are skipped exactly like their openers
      // (which were never pushed onto the stack — see the allowTags filter
      // below). Without this, every PAIRED non-allowed tag — e.g. the
      // documented `<ack kind="…">note</ack>` form — warned "Unexpected
      // closing tag" on every render of that message.
      if (allowTags && !allowTags.includes(tagName)) {
        pos = matchEnd;
        continue;
      }
      // Peek at the top of the stack. Only close if it matches the tag name.
      // The old behavior popped through the whole stack looking for a match,
      // which meant a stray `</instructions>` would silently close out an
      // outer `<speech>` and lose the real body. Treating an unmatched close
      // as literal text (no-op on the stack) keeps malformed input from
      // unraveling the tree.
      if (stack.at(-1)?.tag.type === tagName) {
        const currentItem = stack.pop();
        invariant(currentItem !== undefined, "stack.length > 0 was just checked");
        const currentTag = currentItem.tag;
        currentTag.content = s.slice(currentItem.contentStart, matchStart);
        const parentTag = topTag();
        parentTag.content += s.slice(currentItem.startPos, matchEnd);
      } else {
        console.warn("Unexpected closing tag", nextMatch[0]);
        const currentTag = topTag();
        currentTag.content += s.slice(matchStart, matchEnd);
      }
      pos = matchEnd;
      continue;
    }

    if (allowTags && !allowTags.includes(tagName)) {
      pos = matchEnd;
      continue;
    }

    const attrs = parseAttrs(tagAttrs);
    const newTag: TagType = { type: tagName, attrs, content: "" };
    const parentTag = topTag();
    parentTag.content += s.slice(matchStart, matchEnd);
    if (!parentTag.subTags) parentTag.subTags = [];
    parentTag.subTags.push(newTag);

    if (!isSelfClosing) {
      stack.push({ tag: newTag, startPos: matchStart, contentStart: matchEnd });
    } else {
      newTag.content = "";
    }
    pos = matchEnd;
  }

  while (stack.length > 0) {
    const currentItem = stack.pop();
    invariant(currentItem !== undefined, "stack.length > 0 was just checked");
    const parentTag = topTag();
    parentTag.content += s.slice(currentItem.startPos);
  }

  if (root.subTags) {
    cleanUpTags(root.subTags);
    return root.subTags;
  }
  return [];
}


function cleanUpTags(tags: TagType[]): TagType[] {
  for (const tag of tags) {
    if (tag.subTags) {
      cleanUpTags(tag.subTags);
      tag.content = tag.content.trim();
      if (!tag.subTags.some((x) => x.type !== "comment")) {
        delete tag.subTags;
      }
    }
  }
  return tags;
}
