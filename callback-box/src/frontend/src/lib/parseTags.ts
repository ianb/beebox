/**
 * Tag parser — adapted from memory-atlas/lib/parsetags.ts
 * Permissive parser for XML-like tags in assistant responses.
 */

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
  let pos = 0;

  while (pos < s.length) {
    const restOfString = s.slice(pos);
    const nextMatch = restOfString.match(/<(\/)?([^\s/>]+)([^>]*?)(\/)?>/);
    if (!nextMatch) {
      const text = s.slice(pos);
      const currentTag = stack.length > 0 ? stack[stack.length - 1].tag : root;
      currentTag.content += text;
      const trimmedText = text.trim();
      if (trimmedText) {
        if (!currentTag.subTags) currentTag.subTags = [];
        currentTag.subTags.push({ type: "comment", attrs: {}, content: trimmedText });
      }
      pos = s.length;
      break;
    }

    const matchStart = pos + nextMatch.index!;
    const matchEnd = matchStart + nextMatch[0].length;
    const isEnd = !!nextMatch[1];
    const tagName = nextMatch[2];
    const tagAttrs = nextMatch[3];
    const isSelfClosing = !!nextMatch[4];

    if (matchStart > pos) {
      const text = s.slice(pos, matchStart);
      const currentTag = stack.length > 0 ? stack[stack.length - 1].tag : root;
      currentTag.content += text;
      const trimmedText = text.trim();
      if (trimmedText) {
        if (!currentTag.subTags) currentTag.subTags = [];
        currentTag.subTags.push({ type: "comment", attrs: {}, content: trimmedText });
      }
    }

    if (isEnd) {
      // Peek at the top of the stack. Only close if it matches the tag name.
      // The old behavior popped through the whole stack looking for a match,
      // which meant a stray `</instructions>` would silently close out an
      // outer `<speech>` and lose the real body. Treating an unmatched close
      // as literal text (no-op on the stack) keeps malformed input from
      // unraveling the tree.
      if (stack.length > 0 && stack[stack.length - 1].tag.type === tagName) {
        const currentItem = stack.pop()!;
        const currentTag = currentItem.tag;
        currentTag.content = s.slice(currentItem.contentStart, matchStart);
        const parentTag = stack.length > 0 ? stack[stack.length - 1].tag : root;
        parentTag.content += s.slice(currentItem.startPos, matchEnd);
      } else {
        console.warn("Unexpected closing tag", nextMatch[0]);
        const currentTag = stack.length > 0 ? stack[stack.length - 1].tag : root;
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
    const parentTag = stack.length > 0 ? stack[stack.length - 1].tag : root;
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
    const currentItem = stack.pop()!;
    const parentTag = stack.length > 0 ? stack[stack.length - 1].tag : root;
    parentTag.content += s.slice(currentItem.startPos);
  }

  if (root.subTags) {
    cleanUpTags(root.subTags);
    return root.subTags;
  }
  return [];
}

function parseAttrs(s: string): Record<string, string> {
  if (!s?.trim()) return {};
  const attrs: Record<string, string> = {};
  for (const match of s.trim().matchAll(/([^\s=]+)="([^"]*)"/g)) {
    attrs[match[1].trim()] = match[2];
  }
  return attrs;
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
