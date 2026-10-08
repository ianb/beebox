---
description: "Serves a static website from your box on the open web, at a link you control, after you approve it in the app; take-down is one action."
---
# Publishing

A box is a directory of your data, kept under version control with a full
history of changes (using git); a card is a markdown file with a structured
header; the agent is the coding agent (Claude Code or Codex) that operates the
box. Publishing takes a website the agent has built from material in the box and
serves it on the open web, under your control.

**What it does for you**

- Has the agent build a site, either finished files (Markdown pages are turned
  into web pages for you) or a small frontend project it builds itself, and
  serve it from one web address that belongs to your box. Each site is one
  publication card in the box; its attached folder holds the site files, and
  its body holds private notes that are never published.
- Gives you the decision. The agent prepares a site and hands you a link into
  the app; a signed-in member of the box reviews the title, the address, who it
  is for, the list of files, and the findings of a scan for likely secrets, then
  enables it. Nothing is live until that click.
- Lets the agent keep a site current without asking again, as long as the
  audience and the address are unchanged. Changing who it is for, or its
  address, needs a fresh approval.
- Offers two kinds of link: a public page at a name you choose, or a secret
  link containing a long random identifier that only people you give it to can
  use.
- Takes a site down from the app in one action; visitors then get a "gone"
  answer for that site and its earlier versions.
- Leaves the earlier release live when a build, scan, or upload fails.

**What it needs**

A Cloudflare account that holds the sites, set up once by whoever runs the
machine: an account-scoped Cloudflare token pasted into the Admin page, granted
to the box, and one web address (a hostname in a domain on that account)
assigned to the box. The agent is never given the token. See
[../install/index.md](../install/index.md).

**How it works, briefly**

Each box gets one hostname and one small server program on Cloudflare that
serves it. Public sites live at `/<name>/` and secret-link sites at
`/s/<identifier>/` on that hostname. The agent asks the box server to prepare a
site by its publication card; the server builds it if needed, scans it, and
uploads it as a release. Pages render at that point, content marked redacted
is left out entirely, and the scan runs over the rendered result. A finished page runs only in the visitor's browser, never in
the box.

**Limits**

- The documentation states that no live Cloudflare setup or deployment has yet
  been done with this flow. Tests use stand-ins, and the first real run is
  written up as a checklist for the boxholder. The least-privilege token
  permissions for attaching the hostname are likewise not verified.
- Sites restricted to named accounts are blocked in the managed flow until a
  separate design and live check. Do not treat that tier as available.
- Every site on one box's hostname shares a browser origin, so scripts and
  stored data in one can reach another. The boxholder accepts that the pages of
  one box trust each other; separate boxes use separate hostnames.
- The scan finds likely leaks, not inappropriate content: someone has to read
  the file list and the findings before enabling.
- A build script the agent writes runs as ordinary code on your machine, with
  a reduced environment that leaves out the server's credentials. It is not a
  sandbox. Limits are 2,000 files, 25 MiB per file, and 100 MiB per site.
- The older draft-and-go publishing flow, with its separate upload credential,
  has been removed; the managed flow above is the only one.
- Published pages cannot collect replies: there are no forms that send data
  back to the box.

**Go deeper**

[../reference/bbx-commands.md](../reference/bbx-commands.md),
[../10-your-data-and-safety.md](../10-your-data-and-safety.md)
