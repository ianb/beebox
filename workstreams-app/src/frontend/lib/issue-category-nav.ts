export function activeCategoryAtOffset(categories: { name: string; top: number }[], position: { offset: number; atEnd: boolean }): string | undefined {
  if (position.atEnd) return categories.at(-1)?.name;
  let active = categories[0]?.name;
  for (const category of categories) {
    if (category.top > position.offset) break;
    active = category.name;
  }
  return active;
}

export function issueCategoryId(name: string): string {
  return `issue-category-${encodeURIComponent(name)}`;
}
