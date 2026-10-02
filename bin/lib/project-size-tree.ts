/**
 * Directory trees for the project size report's treemaps
 * (`bin/project-size.ts`, `dev/project-size/`).
 */

/**
 * A directory tree for a treemap. Leaves carry a category and a line count;
 * inner nodes carry children. Each directory's own lines split into one leaf
 * per category, so a box shows its code, tests, and docs side by side.
 */
export interface TreeNode {
  name: string;
  children?: TreeNode[];
  category?: "code" | "tests" | "docs";
  value?: number;
}

export interface Tree {
  title: string;
  root: TreeNode;
}

export type TreeCategory = NonNullable<TreeNode["category"]>;

/** A mutable directory tree: per-category lines at each node, children by name. */
export interface Branch {
  lines: Map<TreeCategory, number>;
  children: Map<string, Branch>;
}

export function newBranch(): Branch {
  return { lines: new Map(), children: new Map() };
}

/** Add a file's lines at `segments` (already cut to the tree's depth). */
export function addToBranch(root: Branch, { segments, category, lines }: { segments: string[]; category: TreeCategory; lines: number }): void {
  let node = root;
  for (const segment of segments) {
    const next = node.children.get(segment) ?? newBranch();
    node.children.set(segment, next);
    node = next;
  }
  node.lines.set(category, (node.lines.get(category) ?? 0) + lines);
}

function branchTotal(branch: Branch): number {
  let sum = [...branch.lines.values()].reduce((a, b) => a + b, 0);
  for (const child of branch.children.values()) sum += branchTotal(child);
  return sum;
}

/**
 * Convert to the treemap shape. Children under `min` lines fold into one
 * "other" node whose leaves keep their categories, so colors stay truthful.
 */
export function toTreeNode(name: string, { branch, min }: { branch: Branch; min: number }): TreeNode {
  const own: TreeNode[] = [...branch.lines]
    .filter(([, value]) => value > 0)
    .map(([category, value]) => ({ name, category, value }));
  // A directory's own files sit beside its subdirectories as one labeled box,
  // not as bare leaves the treemap cannot name.
  const leaves: TreeNode[] = branch.children.size > 0 && own.length > 0 ? [{ name: "(own files)", children: own }] : own;
  const big: TreeNode[] = [];
  const folded = newBranch();
  let foldedCount = 0;
  for (const [childName, child] of branch.children) {
    if (branchTotal(child) >= min) {
      big.push(toTreeNode(childName, { branch: child, min }));
      continue;
    }
    foldedCount += 1;
    const merge = (from: Branch): void => {
      for (const [category, value] of from.lines) folded.lines.set(category, (folded.lines.get(category) ?? 0) + value);
      for (const grandchild of from.children.values()) merge(grandchild);
    };
    merge(child);
  }
  if (foldedCount > 0) {
    const otherName = `other (${String(foldedCount)} small)`;
    big.push({
      name: otherName,
      children: [...folded.lines].filter(([, value]) => value > 0).map(([category, value]) => ({ name: otherName, category, value })),
    });
  }
  return { name, children: [...leaves, ...big] };
}
