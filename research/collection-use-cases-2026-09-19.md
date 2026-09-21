# Collection use cases in PKM tools: what people build, keep, and abandon

## Snapshot

This report is dated 2026-09-19.

It synthesizes five research passes:

- Obsidian forum and community write-ups covering Dataview, Bases, Tasks, and Kanban plugins.

- Notion community and marketplace material. Direct Reddit threads were not retrievable, so this leans on Substack/Medium/template-marketplace sources.

- TiddlyWiki and Logseq forum/GitHub threads, plus a thin pass on Tana, with almost no usable evidence for Anytype or Capacities.

- Academic personal information management (PIM) literature on folders, tags, and saved searches (Jones, Bergman, Whittaker).

- AI-era usage. Most direct evidence here comes from business-intelligence/analytics discourse rather than PKM tools specifically.


This is for a Bee Box design doc on "collection views" — queries and dashboards over typed markdown cards. The design doc tests a five-job hypothesis: (1) worklist, (2) orientation/progress, (3) browsing a domain, (4) navigation, (5) pointing.

## A. Most common collections people build

Ranked roughly by how often and how concretely each pattern recurs across sources.

1. **Task worklists sliced by due date, status, or context.** The best-documented example is a ten-view Obsidian Canvas dashboard over one task pool: "Ready," "Back Burner," "Waiting," "To Discuss," "Clarify," "This Month," "Scheduled" (capped at 8 items), "Later/Someday," "Unscheduled," "Inbox" ([Mike's Obsidian Task Management Dashboard Workflow](https://thesweetsetup.com/mikes-obsidian-task-management-dashboard-workflow/)).

   Logseq has an actively-used community thread collecting "Past Due Tasks" and "Open Scheduled Tasks" queries, with replies like "Really helped my workflow to the next level" ([Queries for task management](https://discuss.logseq.com/t/queries-for-task-management/14937)).

2. **Project dashboards aggregating tasks across projects, or per project.** Obsidian forum threads: "[Update] My Project Management Workflow using obsidian-dataview" and "Project tracking (Metaedit, Dataview and Kanban)" ([workflow thread](https://forum.obsidian.md/t/20210608-update-my-project-management-workflow-using-obsidian-dataview/18932), [tracking thread](https://forum.obsidian.md/t/project-tracking-metaedit-dataview-and-kanban/19343)).

   A Logseq user built a dashboard bucketing tasks by named project plus a catch-all "Others" query ([Dashboard to show task per project](https://discuss.logseq.com/t/dashboard-to-show-task-per-project/12823)).

3. **Reading/media backlog trackers.** Obsidian: a status-based (want to read/reading/finished) book database rendered as both gallery and table, described as vault-wide ([A Book Collection Database in Obsidian](https://www.goodreads.com/author_blog_posts/23021206-what-s-been-keeping-me-busy-a-book-collection-database-in-obsidian?tab=book)).

   Notion: book-tracker templates commonly ship gallery views grouped by To Read/Currently Reading/Finished plus a details table ([My Bookshelf template](https://sheeninbetween.gumroad.com/l/book), [LIBRARY template](https://kiettuongnotion.gumroad.com/l/qfzmb)).

4. **Personal CRM / "reach out" lists.** Obsidian Dataview pattern: people notes tagged with a `Contact Frequency::` field, daily notes logging interactions, a query surfacing overdue contacts sorted by staleness ([Relationship and Contact Management with Dataview](https://forum.obsidian.md/t/relationship-and-contact-management-with-dataview-when-was-the-last-time-i-called-thought-about-my-friend/27413)). Several maintained CRM plugin templates exist for this ([People CRM boilerplate](https://github.com/DukeWood/obsidian-people-crm-boilerplate), [obsidian-personal-crm](https://github.com/xuvi7/obsidian-personal-crm)).

   Notion: a CRM with "Bucket," "Level," "Last Contact Date," and computed "Next Birthday"/"Status" fields, with a "Reach Out List" as the primary view ([My CRM](https://hopforward.substack.com/p/my-crm)).

5. **MOCs / index notes as navigation menus.** Manually curated, explicitly described as requiring "annotate and articulate ideas. Dataview can't do that for me" ([Do Dataview queries replace your MOCs?](https://forum.obsidian.md/t/do-dataview-queries-replace-your-mocs/41389)).

6. **Home/hub dashboard pages** aggregating links to other pages plus a few embedded database views. Seen in Notion ([community dashboard roundup](https://redgregory.substack.com/p/inspiration-from-the-notion-community)) and in TiddlyWiki's persistent sidebar tabs ([TiddlyWiki Tabs Demystified](https://talk.tiddlywiki.org/t/tiddlywiki-tabs-demystified/1333)).

7. **Content calendars.** Described as near-universal among Notion users who plan content, and near-universally abandoned within a month (see Section C). Source quality for this specific claim is weaker — it is search-synthesized, not independently re-fetched.

8. **Weekly/periodic review dashboards.** A common Notion template category, marketed on low friction: "usable in 60 seconds with no complicated databases or formulas" ([Weekly Review & Reset Dashboard](https://www.notion.com/en-gb/templates/weekly-review-reset-dashboard-free-edition)).

9. **Vault-hygiene worklists.** An Obsidian user built a dashboard of orphaned notes and abnormally small/large files as an editing to-do list ([Dataview Dashboard Showcase](https://forum.obsidian.md/t/dataview-dashboard-showcase/22578)).

10. **Recipe/grocery collections.** A TiddlyWiki thread on generating a grocery list from selected recipes, with checkboxes to include/exclude recipes and dynamic ingredient totals ([grocery list thread](https://talk.tiddlywiki.org/t/tw5-automatically-generating-grocery-list-by-clicking-on-cooking-recipes/1753)).


11. **Sidebar/tab navigation with count badges** in TiddlyWiki. Example: a tab button showing the number of backlinks to the current tiddler ([TiddlyWiki Tabs Demystified](https://talk.tiddlywiki.org/t/tiddlywiki-tabs-demystified/1333)).


12. **Tana supertag + search-node collections.** A general "collect and view" primitive spanning types ([Intro to supertags, search nodes and views](https://tana.inc/articles/intro-to-supertags-search-nodes-and-views)). This is vendor documentation, not observed user behavior.


## B. Mapping to the five jobs

**Job 1 (worklist)** is the best-evidenced job everywhere. Obsidian's ten-view dashboard, the CRM "reach out" queues, Logseq's due/overdue task queries, and TiddlyWiki's Projectify (checking a box auto-tags "done") all fit: items are meant to leave the view once acted on.

**Job 2 (orientation/progress)** is weakly evidenced as a *standalone* build across all three PKM notes. It shows up bolted onto job-1 or job-3 dashboards — a progress bar on a project tracker ([Project tracking thread](https://forum.obsidian.md/t/project-tracking-metaedit-dataview-and-kanban/19343)), or a backlink-count badge on a TiddlyWiki tab — rather than something people set out to build for its own sake. The research flags this explicitly as a soft spot in the hypothesis, not a confirmed job.

**Job 3 (browsing a domain)** is cleanly evidenced: book/media trackers (Obsidian, Notion), the TiddlyWiki recipe/grocery build, TiddlyWiki backlink/keyword sidebar tabs. These are consistently table/gallery views over a fixed property schema, read-only, and never described with a worklist's "act and it disappears" dynamic.

**Job 4 (navigation)** is well evidenced: manually curated MOCs, Notion home/hub pages, TiddlyWiki's tag-curated sidebar. Notably, MOCs are explicitly *not* query-driven in the sources — users describe pruning and annotating them by hand precisely because a query can't replicate that judgment.

**Job 5 (pointing)** has no clear standalone example in any of the three community-research passes. The closest analogues are manually pruned MOC sections and Logseq's inclusion/exclusion queries, both of which read as ordinary curation rather than a distinct "pointing" act. The Obsidian researcher explicitly asks whether users conceive of pointing as different from navigation at all, or whether it is simply unarticulated in forum self-description. The PIM literature likewise has no named concept matching "pointing" — the closest is Jones's broader "keeping" activity, which is not the same thing.

**Something outside the taxonomy.** Vault-hygiene dashboards (orphaned/malformed notes) target the note *system itself* rather than a content domain or a task — arguably job 1, but the "item" is a quality flag, not a task or appointment. Notion's weekly/periodic review page is closer to a recurring authored ritual/template than a live filtered view of anything; it doesn't map cleanly onto any of the five jobs.

## C. What gets abandoned, what survives

Abandonment clusters around two distinct mechanisms, and the research is explicit that they should be treated separately.

**Recurring-utility systems fail from maintenance burden and complexity creep.**

- A Notion user who built three "second brains" over time: "None survived longer than six months," citing capture friction (10–40 minutes/day lost to multi-step capture) and drift ("Every database needs maintenance. Relations break when you delete items. Views need updating as content grows") ([Second Brain Notion: Why It Fails](https://tryultrathink.com/blog/second-brain-notion-guide)).

- A two-year Notion user abandoned dashboards, habit trackers, and task databases, reporting "I spent more time tweaking my system than actually doing the work" and calling the end state "chaos disguised as structure" ([Why I Quit Notion](https://vocal.media/motivation/why-i-quit-notion-and-you-might-want-to)).

- In Obsidian, a heavy Dataview user abandoned it for manual linking, citing portability: "If you try to open a file written with Dataview on a different markdown application, it won't render as a table" ([A case against Dataview](https://forum.obsidian.md/t/a-case-against-dataview-a-story/82210)).

- Kanban-per-project setups are called out as not scaling: "every project has its own board. That makes annoying overhead" ([Tasks-plugin thread](https://forum.obsidian.md/t/anyone-else-feel-like-there-s-no-simple-workflow-for-tasks/116578)).

- Content calendars are reported as "almost universally abandoned... within a month" when overbuilt, with survivors being "the boring ones with few properties, one database, and a calendar view you actually open." Source quality is weaker here — search-synthesized, not independently confirmed.


**One-off content/reference builds fail from unfinished scope or interest fade**, not maintenance cost. A Notion retrospective catalogs abandoned builds: a spaced-repetition explainer the author found too complex, a health tracker abandoned once the illness passed, a discography wiki abandoned mid-development ([Going Through Notion's Trash Bin](https://redgregory.substack.com/p/9577658_-2-216-20-red-gregory-newsletter)).

**What survives:** narrowly-scoped, single-purpose queries; manually curated MOCs, explicitly because they force thinking a query can't do; minimal CRM systems that track "loosely rather than obsessively" ([My CRM](https://hopforward.substack.com/p/my-crm)).

Logseq's due-task query pattern shows people persisting through query-building friction — fixing a `:block/deadline` vs `:block/scheduled` bug — rather than reverting to manual lists: "once I changed that it worked, beautifully" ([Overdue Tasks woes](https://discuss.logseq.com/t/overdue-tasks-woes/28600)).

A distinct and important failure mode is **information overload from over-aggregation**: pulling everything into one dashboard "throws way too much irrelevant information at you all at once" ([Tasks-plugin thread](https://forum.obsidian.md/t/anyone-else-feel-like-there-s-no-simple-workflow-for-tasks/116578)).

A related Notion-specific finding complicates the "more named views is good" assumption: with six views on one task database, "you face a meta-decision before you can even engage with your tasks: which view should I look at right now?... When you have six equivalent options, you look nowhere." The proposed fix is a designated daily view with others demoted to occasional use. This source is lower-confidence (search-synthesized, article not independently fetched), but it is a direct, named caution against unqualified view proliferation.

Performance is a separate, well-documented abandonment driver in Logseq specifically. Large graphs (~2000 pages) can take 4–10+ minutes to open ([Very slow performance with large local graph](https://discuss.logseq.com/t/very-slow-performance-with-large-local-graph/1484)), and queries returning 200+ results caused 15–20 second navigation delays ([GitHub #4285](https://github.com/logseq/logseq/issues/4285)). The community's typical response is to rewrite the query for performance, not abandon it — one documented case improved 2070ms to 13ms by switching to advanced-query syntax with direct property access (lower confidence, thread URL not independently captured).

The Obsidian Kanban plugin's own maintenance state ("looking for new maintainers... lots of bug reports") led to a community fork, "Kanban Plus" ([maintainer issue](https://github.com/obsidian-community/obsidian-kanban/issues/1157)) — a case of tool-level abandonment risk distinct from user-level abandonment.

## D. Hand-curated vs. derived collections

Two distinct reasons for preferring a manual list/MOC over a query surfaced, and the research flags that they should not be conflated.

**Curatorial/judgment reasons** map to jobs 4/5. The clearest source: "dataview is not replacement, but it [is] complimentary to creating MOCs" — reasons given are that manual work "forces active thinking/annotation the tool can't do," and manually-linked MOC notes participate in Obsidian's graph view and backlinks, whereas Dataview-generated lists do not ([Do Dataview queries replace your MOCs?](https://forum.obsidian.md/t/do-dataview-queries-replace-your-mocs/41389)). A user who tried to fully automate MOC generation via query reported "low recall despite high precision" and reverted to manual curation — a concrete case of automation failing to substitute for judgment.

**Durability/portability reasons** are orthogonal to curation. The "case against Dataview" essay generalizes to a preference for plain manual linking over any plugin-dependent dynamic view, purely on future-proofing grounds, invoking Gall's Law (start simple, add complexity only when needed) ([A case against Dataview](https://forum.obsidian.md/t/a-case-against-dataview-a-story/82210)). A counterpoint in the same thread argues lock-in is avoidable with careful design; another poster admits full dependence on Dataview/Templater/QuickAdd: "I have no other choice, even if I wanted to."

A practical middle ground appears repeatedly: a query surfaces candidates (orphaned notes, un-triaged items) for a human to manually promote into a curated structure. Automation feeds curation rather than replacing it.

**PIM literature.** This is the deepest-sourced part of the research, and it complicates any simple "queries are better" story.

- Whittaker & Matthews's large-scale study (345 users, ~85,000 refinding actions) found "opportunistic" access — chiefly scrolling/search — accounted for the large majority of refinding, and users who invested heavily in complex folder structures did not retrieve better than those who didn't. The paper's own title poses folder-building as "wasting my time" ([Am I wasting my time organizing email?, CHI 2011](https://dl.acm.org/doi/10.1145/1978942.1979457)).

- Yet Whittaker & Sidner's decade-later follow-up found mean folder counts nearly tripled (47 to 133 per user) even as this inefficiency persisted ([Revisiting Whittaker & Sidner, CSCW 2006](https://dl.acm.org/doi/10.1145/1180875.1180922)). People keep building folders they don't retrieve better from.

- An fMRI study found folder navigation activates spatial-navigation brain regions while search activates linguistic-processing regions. The authors argue this explains a durable behavioral preference for folders that "won't be erased by further search-technology improvements" despite search's speed advantage ([Navigating through digital folders, Scientific Reports 2015](https://www.nature.com/articles/srep14719)).

- Bergman (2013, abstract only, paywalled) reportedly found a strong preference for folders over tags for both storage and retrieval.

- Bergman, Beyth-Marom & Nachmias found that adoption of dynamic/metadata-driven organizing — the same kind of attribute a smart folder depends on — is **design-contingent**: when an interface actively encourages subjective attributes (project, importance, context), users use them; when it doesn't, they invent workarounds or abandon the attribute ([user-subjective approach, JASIST 2003](https://asistdl.onlinelibrary.wiley.com/doi/abs/10.1002/asi.10283)).

- No peer-reviewed study was found that measures smart-folder/saved-search adoption rates directly. The concrete, non-academic data points found are: a Neowin forum poll suggesting low uptake of Windows Vista's Saved Search feature, and Mozilla Bugzilla threads documenting Thunderbird users abandoning "virtual folders" (its saved-search feature) once more than ~10 were defined, due to performance degradation and definitions being lost between restarts ([Bugzilla #636306](https://bugzilla.mozilla.org/show_bug.cgi?id=636306), [Bugzilla #271632](https://bugzilla.mozilla.org/show_bug.cgi?id=271632)). This is abandonment tied to technical friction, not conceptual rejection.


## E. Where collections live

Both global and context-scoped placement coexist by design across every tool studied, and more than one source frames this as an unresolved tension rather than a solved design problem.

**Global/dashboard placement:**

- Mike's Canvas dashboard aggregates tasks vault-wide, separate from where the underlying tasks are written ([Mike's Dashboard](https://thesweetsetup.com/mikes-obsidian-task-management-dashboard-workflow/)).

- The CRM contact-tracking query is vault-wide.

- TiddlyWiki's sidebar tabs are global, always-present chrome managed via a tagging mechanism ($:/tags/SideBar) rather than auto-generated per-context ([Hiding tabs in side-bar](https://talk.tiddlywiki.org/t/hiding-tabs-in-side-bar/8459)).

- Notion home/hub pages aggregate links plus a few embedded database views, described as pulling together "most-used links, views, and tools in one place."


**Context-scoped placement:**

- Logseq's per-project dashboard example embeds queries filtered to specific project pages plus a catch-all ([Dashboard to show task per project](https://discuss.logseq.com/t/dashboard-to-show-task-per-project/12823)).

- MOC-embedded Dataview queries are attached to one specific MOC note — local discovery aids rather than global dashboards.

- RedeyeFR's workflow scopes project management specifically to periodic (week/month/quarter/year) notes, distinct from daily-note task capture — a time-scoped rather than purely project- or vault-scoped pattern ([My complete Obsidian workflow](https://forum.obsidian.md/t/my-complete-obsidian-workflow-to-manage-my-life/64522)).


**The unresolved tension, named directly by users:** the Tasks-plugin thread states it explicitly — "I want a dead-simple 'next action' list, but I also have a massive amount of project notes that I need to keep hidden" — and per-project Kanban is called out as failing to aggregate while adding overhead ([Anyone else feel like there's no simple workflow for Tasks?](https://forum.obsidian.md/t/anyone-else-feel-like-there-s-no-simple-workflow-for-tasks/116578)). No example was found of a single tool offering both a roll-up global view and automatic per-project drill-down from the same data without duplicated setup — this reads as a genuine ecosystem gap, not just an artifact of the hypothesis.

The Notion pattern is hub-and-spoke, by inference: a home page holds navigation links plus a small number of promoted/embedded views, while the authoritative database (e.g., the CRM) lives on its own standalone page and is not embedded piecemeal elsewhere. No direct user testimonial narrates this as a deliberate strategy — it is inferred from combined technical documentation and community roundups, not a first-person account.

The PIM literature supports project/context as a natural scoping unit in principle. Bergman's "subjective project classification principle" found users group items by project regardless of format — files, emails, web pages together ([user-subjective approach, 2003](https://asistdl.onlinelibrary.wiley.com/doi/abs/10.1002/asi.10283)). Jones's Keeping Found Things Found project is built on letting people describe a project/goal as the organizing basis for all related information ([KFTF overview](https://ischool.uw.edu/news/2016/12/keeping-found-things-found)). But no study directly compares user preference for project-scoped versus deliberately cross-cutting global collections — this specific comparison is not addressed in the literature found.

## F. Multiple named views of one source

This is one of the better-evidenced patterns, and it cuts both ways.

**Valued in principle.** Mike's dashboard is the clearest example: ten named views, all queries over one task pool, distinguished by due-date/tag/status filters, still described as one coherent system in active use ([Mike's Dashboard](https://thesweetsetup.com/mikes-obsidian-task-management-dashboard-workflow/)). A Notion guide teaches building multiple views — Kanban board for sprint tasks, list for upcoming deadlines, calendar for long-term planning — off one task database, explicitly "to maximize focus" ([Five Task Database Views](https://manifest.substack.com/p/here-are-the-five-task-database-views)).

**Naming conventions found** are GTD-derived vocabulary, not database-derived terms: "Ready," "Back Burner," "Waiting," "To Discuss," "Clarify," "Later/Someday," "Unscheduled," "Inbox" (Obsidian); "Open, Waiting, Next Actions" as an aspirational minimal set from a different Obsidian thread. No source in any tool used database-style names like "Untriaged" or "All" for a view — this specific naming pairing from the original research question was not found anywhere.

**A direct caution against unqualified proliferation.** The Notion research turned up an explicit counter-finding: six equally-weighted views on one database creates a "meta-decision" — "which view should I look at right now?" — that itself becomes friction, and "when you have six equivalent options, you look nowhere." The proposed fix is a hierarchy: one designated daily-use view, with the rest demoted to occasional/specific-purpose status. This is a lower-confidence source (not independently re-fetched), but it is a clear and specific claim. It directly complicates any assumption that "more named views is straightforwardly good."

Notion's linked-database views also serve a non-display function: they are the mechanism for scoped sharing and permissions — "You can create a linked view of your task database in a page and give someone access to that page," and permission settings "apply across all views of your database" ([Data sources & linked databases](https://www.notion.com/help/data-sources-and-linked-databases), [custom database permissions](https://www.notion.com/help/guides/assign-custom-database-permissions)).

## G. Acting in place vs. read-only

Direct in-view action is treated as important and mandatory for the worklist job specifically. The evidence on Bases fixing a "read-only Dataview" problem is weaker than the design doc's premise assumes.

Actionability-in-place was already present in pre-Bases Obsidian setups. Mike reports checking off tasks directly from the dashboard, which writes a completion date back to the source file, while still being able to "hover over the icons to view the metadata or edit the task itself in its original location" ([Mike's Dashboard](https://thesweetsetup.com/mikes-obsidian-task-management-dashboard-workflow/)). TiddlyWiki's Projectify plugin auto-tags a task "done" the moment its checkbox is checked from within a filtered view ([Projectify](https://github.com/NicolasPetton/Projectify)). Logseq's entire task-query ecosystem assumes write-through: changing a task's TODO/DOING/DONE state changes its membership in every query result.

No evidence was found anywhere of complaints that *browsing* views — recipes, backlinks, keyword indexes — need to be actionable. These are consistently discussed as read-only, and that is treated as unremarkable.

**On Bases specifically:** users migrating from Dataview to Bases describe the improvement in terms of ease, performance, official/core-plugin support, and a no-code visual editor — "Bases makes views easier," "a replacement for dataview with a core plugin and a better UI" ([Dataview vs. Bases](https://forum.obsidian.md/t/dataview-vs-bases/113073)) — not in terms of turning a read-only table into an editable one. Official materials describe Bases as producing "fixed searches that update," framed around currency, not interactivity ([Bases release commentary](https://alternativeto.net/news/2025/8/obsidian-launches-new-bases-plugin-for-database-workflows-and-property-format-changes)).

No direct user quote was found saying "Dataview tables were read-only and frustrating, now Bases lets me edit inline." The research flags this explicitly as unverified: **the premise that Bases specifically fixed a read-only-Dataview pain point is not strongly supported by the evidence gathered.** Bases's own current inline-editing capabilities were not directly confirmed either way.

Notion shows the same actionable-by-default pattern from a different angle: editing through a linked view is native ("access and edit tasks in the linked view"), and locking a view is presented as a defensive measure against unwanted edits, not the default state. This implies the community's baseline expectation for a "useful" view is that it's actionable, and read-only is the deliberately-configured exception ([Data sources & linked databases](https://www.notion.com/help/data-sources-and-linked-databases), [locking views](https://www.notionapps.com/blog/how-to-share-specific-parts-of-notion-databases-6-solutions)). No first-hand account was found of a user explicitly contrasting an actionable Notion view against a prior read-only pain point elsewhere.

## H. AI-era usage

Evidence here is consistently described by the researchers as thin and mostly inferential, sourced more from BI/analytics discourse than PKM communities.

The clearest substitution evidence comes from business intelligence, not personal notes: "Dashboards answer the questions you thought to ask when you built them — not the question you have right now... instead of filtering through ten different views... you ask your Slack bot" ([Ability.ai](https://www.ability.ai/blog/conversational-bi-ai-agents)), a claim echoed near-verbatim by a DEV Community post titled "Stop building dashboards. Start asking questions" ([DEV Community](https://dev.to/mads_hansen_27b33ebfee4c9/stop-building-dashboards-start-asking-questions-4pkd)).

Even within this pro-AI genre, sources concede substitution is partial: "Dashboards are best for questions you already know you'll need to answer every week. Conversational analytics wins for the questions you didn't know you'd need to ask until a problem showed up" ([Seresa.io](https://seresa.io/blog/conversational-analytics/stop-building-dashboards-start-having-conversations-with-your-data)). Even an observability vendor with incentive to defend dashboards titles a post "AI Isn't Here to Replace Your Dashboard… Yet" ([Honeycomb](https://www.honeycomb.io/blog/ai-isnt-here-to-replace-your-dashboard-yet)).

In PKM tools specifically, the evidence is at the product-feature level, not user testimony. Notion shipped native "Dashboard views" (2026-03-10) in the same release cycle it expanded AI Q&A ([release notes](https://www.notion.com/releases/2026-03-10)). Investing in both simultaneously is evidence Notion does not treat conversational AI as a substitute for standing views, though no Notion statement makes this argument explicitly — it is the research's inference from the product timeline.

Third-party commentary on Notion Q&A draws a functional line: "A knowledge base tells you who owns each page... Notion Q&A tells you what the content says." Q&A doesn't fix ownership or staleness the way a maintained view/structure does ([aiunpacker.com](https://aiunpacker.com/blog/notion-qa-feature-2025-does-it-replace-your-knowledge-base/)).

In Obsidian's plugin ecosystem, Dataview/Bases and AI plugins (Smart Connections, Vault Chat) are consistently described as complementary — "Dataview is for querying and organizing... AI assistants are for generating content and answering questions" ([DEV Community](https://dev.to/airabbit/comprehensive-comparison-of-gpt-powered-obsidian-plugins-in-2024-summary-50mn)) — with no plugin found that has AI author a Dataview query and pin it as a saved view.

The one directly-observed pattern in a PKM community is Logseq users substituting conversational search for manual query-building: "Instead of relying only on search or tags, you can simply ask the AI something like a normal question... This eliminates the need to struggle with keywords or complex search strings" ([Conversational Search on Logseq with Local LLMs](https://calvincchan.com/blog/240519-conversational-search-on-logseq-with-local-llms)). This is retrieval substituting for query-building, not AI generating structured queries on the user's behalf — a meaningfully narrower claim than "AI replaces the need for saved views."

Tana's own documentation treats structured supertag/search-node queries and AI chat as separate, coexisting mechanisms rather than one replacing the other ([Tana AI docs](https://outliner.tana.inc/docs/tana-ai)). Tiago Forte argues organized structure remains necessary in an AI-chat world because "the quality of an AI chatbot's response is always dependent on the quality of the inputs you provide it" ([Forte Labs](https://fortelabs.com/blog/will-artificial-intelligence-replace-the-need-for-second-brains-entirely/)).

No source discusses the five-job taxonomy directly. The mapping below of jobs to AI-substitution risk is stated by the research explicitly as inference, not finding:

- Worklist and orientation/progress most resemble the "known, recurring question" case that favors a standing glanceable view over repeated prompting.

- Browsing and navigation most resemble "ask and get pointed/summarized," making them more susceptible to chat substitution.

- Pointing is reasoned — not observed — to be the job least likely to be replaced by asking, because reconstructing "the same fixed set" from a prompt each time risks drift or hallucination, whereas a pinned list is exact by construction. No PKM evidence supports or contradicts this for pointing specifically.


## What this means for Bee Box

**Adopt — job 1 (worklist).** This is the best-evidenced job across every tool, and the literature's own framing (Seresa's "questions you already know you'll need to answer every day") argues it survives an AI-chat world because it needs to be glanceable and checked repeatedly, not re-asked. Build worklists as first-class, and make items leave the view on action. This write-through behavior — checkbox to tag/date write, e.g. Obsidian Tasks, TiddlyWiki Projectify, Logseq TODO states — is universal in every mature system studied, not an add-on.

**Adopt — job 3 (browsing a domain) and job 4 (navigation), but keep them read-only and cheap.** Book/media/recipe trackers and MOCs/sidebars are well evidenced and low-drama, and no source records complaints about their being non-actionable. Do not over-invest in making these editable in place; the evidence gap is entirely on the worklist side.

**Adapt — job 4 (navigation) should preserve manual curation, not auto-generate it.** The strongest single finding in Section D is that automated MOC generation (query-derived) failed with "low recall despite high precision" and was reverted to manual curation. If Bee Box's agent proposes navigation menus/MOCs, treat the agent's draft as a suggestion for the boxholder to prune, not a fully automatic surface. This matches the "automation feeds curation, doesn't replace it" pattern seen repeatedly.

**Adapt — job 2 (orientation/progress) probably shouldn't be a standalone view type.** No PKM source shows people building a dedicated progress/coverage dashboard as an end in itself; it consistently appears as a small ornament (a progress bar, a count badge) on a job-1 or job-3 view. Recommend implementing orientation as a lightweight annotation on existing worklist/browsing views (counts, "N of M done") rather than a fifth first-class view type competing for attention. This is the research's most direct challenge to the five-job hypothesis as originally framed.

**Reject/reconsider — job 5 (pointing) as a distinct UI concept.** No PKM community, and no PIM literature source, names or evidences "pointing" as separate from ordinary navigation/curation. It may be real but is either indistinguishable from job 4 in how users describe their own behavior, or it's a genuinely underserved need that simply doesn't surface in forum self-report. Recommend treating pointing as a variant of navigation — a manually pinned, short list — rather than engineering a separate mechanism, unless Bee Box's own usage argues otherwise.

**Adopt — bound the number of simultaneously-promoted named views (Section F).** The Notion "meta-decision fatigue" finding is a direct, specific counter-argument to treating "many labeled views over one source" as an unqualified good. Recommend a single default/landing view per collection context, with additional named views demoted to secondary/occasional status, rather than surfacing many equally-weighted views at once.

**Adapt — scoping (Section E) needs both, and the design should not assume one is primary.** Every tool studied supports both global roll-ups and context-scoped (per-project) collections, and multiple sources name the tension between them as unresolved, not solved. Bee Box should plan for both a global worklist ("everything needing me") and card-scoped or context-scoped views (e.g., tasks tied to one container), and should not assume a single canonical scope will satisfy both needs.

**Adopt with caveat — the "Bases fixed read-only tables" narrative (Section G) should not be assumed.** The evidence does not confirm the design doc's implicit premise that a specific tool fixed a read-only-table pain point. The actionable-in-place capability the design doc probably wants (check off, change status from the view) was already present in pre-Bases systems via write-through mechanisms. Design for write-through action from the start rather than treating it as a "Bases-era" innovation to catch up to.

**Later — AI-era substitution (Section H).** The evidence base here is too thin and too indirect (mostly BI/analytics, not PKM) to justify a strong design commitment now. The directionally consistent signal across unrelated sources — recurring/known questions favor a standing view, novel one-off questions favor asking — is a reasonable working hypothesis, but it is argument-level, not field-observed, in a PKM context. Recommend building persistent collection views as planned (job 1 evidence alone justifies this) and treating "does chat substitute for some job" as an open question to observe in Bee Box's own usage rather than something to design against now.

**Reject — full automation of judgment-dependent collections.** Consistent with existing Bee Box practice, the research reinforces that curatorial collections (MOCs, pointing sets) should stay human-adjustable even when an agent files most cards. The "low recall" auto-MOC failure is a concrete cautionary data point, not a hypothetical concern.

## Not found

- No direct evidence — anywhere, in any tool — of what people actually *name* their views, beyond the specific GTD-style examples found in Obsidian. Notion and TiddlyWiki view-naming conventions were searched for and not found.

- No peer-reviewed study measuring real-world adoption or abandonment rates of smart folders / saved searches / virtual folders in any shipped product (Gmail filters+labels, Outlook search folders, macOS Smart Folders, Windows Search). The only concrete adoption-relevant data points are a non-representative forum poll (Windows Vista Saved Search) and Mozilla Bugzilla bug-tracker threads (Thunderbird virtual folders).

- No usable community evidence for Tana beyond vendor documentation, and essentially no usable evidence at all for Anytype or Capacities. Search terms returned unrelated generic results, not community discussion. This is a real coverage gap, not a null result.

- No direct evidence of queries "silently returning nothing" due to a typo, rename, or metadata drift. This specific failure mode, named in the original research brief, was searched for directly in the Obsidian pass and not found. The closest adjacent evidence is complaints about frontmatter/property-alignment burden, which is suggestive but not the same claim.

- No direct quotes distinguishing "pointing" from ordinary navigation/curation in any community or in the PIM literature. This is treated throughout the report as an open hypothesis, not a confirmed or refuted job.

- No study directly compares user preference for project-scoped versus deliberately cross-cutting/global collections. The literature supports project as a natural organizing unit in principle (Bergman, Jones) but never runs this specific head-to-head comparison.

- No firsthand, dated, URL-attributable Reddit thread was retrieved for either Notion or Logseq despite being specifically sought. Notion findings lean on Substack/Medium/template-marketplace sources; Logseq findings lean on discuss.logseq.com and GitHub rather than Reddit.

- No empirical or survey data on whether real PKM users report missing a dashboard after adopting AI chat, or the reverse. All AI-era substitution evidence is argument-level blog/vendor content, mostly from BI/analytics rather than PKM, and the mapping of the five jobs onto "AI-substitution risk" in Section H is explicitly inferential extrapolation, not observed behavior.

- No evidence on shared/collaborative visibility needs in a genuinely single-user PKM context. Bee Box's boxholder-plus-agent model has no close product analog in what was found.

- Full primary text of several paywalled PIM papers — Bergman 2013 "Folder versus tag preference"; Bergman & Whittaker 2011 "The Devil Is in the Details"; Jones's "Don't take my folders away!" — could not be retrieved. Only abstracts or secondary summaries were available, so specific effect sizes and study designs behind several claims above are unconfirmed.

