import { useEffect, useRef, useState, type RefObject } from "react";

import { activeCategoryAtOffset, issueCategoryId } from "../lib/issue-category-nav.js";

export interface IssueCategoryLink {
  name: string;
  count: number;
}

export function IssueCategoryNav({ categories, scrollRoot }: { categories: IssueCategoryLink[]; scrollRoot: RefObject<HTMLElement> }) {
  const [active, setActive] = useState(categories[0]?.name);
  const navRef = useRef<HTMLElement>(null);
  const categoryNames = categories.map((category) => category.name).join("\u0000");

  useEffect(() => {
    const root = scrollRoot.current;
    const nav = navRef.current;
    if (!root || !nav) return;
    const updateActive = (): void => {
      if (root.clientHeight === 0) return;
      const sections = [...root.querySelectorAll<HTMLElement>("[data-issue-category]")];
      const rootTop = root.getBoundingClientRect().top;
      const positions = sections.map((section) => ({ name: section.dataset.issueCategory ?? "", top: root.scrollTop + section.getBoundingClientRect().top - rootTop }));
      const atEnd = root.scrollTop >= root.scrollHeight - root.clientHeight - 1;
      const next = activeCategoryAtOffset(positions, { offset: root.scrollTop + nav.offsetHeight + 1, atEnd });
      setActive((current) => next ?? current);
    };
    updateActive();
    root.addEventListener("scroll", updateActive, { passive: true });
    window.addEventListener("resize", updateActive);
    return () => {
      root.removeEventListener("scroll", updateActive);
      window.removeEventListener("resize", updateActive);
    };
  }, [categoryNames, scrollRoot]);

  useEffect(() => {
    if (!active) return;
    const nav = navRef.current;
    const link = [...(nav?.querySelectorAll<HTMLElement>("[data-issue-category-link]") ?? [])].find((candidate) => candidate.dataset.issueCategoryLink === active);
    if (!nav || !link) return;
    if (link.offsetLeft < nav.scrollLeft) nav.scrollTo({ left: link.offsetLeft });
    else if (link.offsetLeft + link.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollTo({ left: link.offsetLeft + link.offsetWidth - nav.clientWidth });
  }, [active]);

  function scrollToCategory(name: string, focusSection: boolean): void {
    const root = scrollRoot.current;
    const nav = navRef.current;
    const section = [...(root?.querySelectorAll<HTMLElement>("[data-issue-category]") ?? [])].find((candidate) => candidate.dataset.issueCategory === name);
    if (!root || !nav || !section) return;
    const sectionTop = root.scrollTop + section.getBoundingClientRect().top - root.getBoundingClientRect().top;
    root.scrollTo({ top: Math.max(0, sectionTop - nav.offsetHeight) });
    setActive(name);
    if (focusSection) section.focus({ preventScroll: true });
  }

  return <nav className="issue-category-nav" aria-label="Issue categories" ref={navRef}>{categories.map((category) => <a href={`#${issueCategoryId(category.name)}`} aria-current={active === category.name ? "location" : undefined} data-issue-category-link={category.name} key={category.name} onClick={(event) => { event.preventDefault(); scrollToCategory(category.name, event.detail === 0); }}>{category.name} <small>{category.count}</small></a>)}</nav>;
}
