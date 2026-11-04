---
description: "Where your data lives, what leaves the machine, and what the agent can do and how that is bounded."
---
# Your data and safety

Your data lives in the **box**: one directory on your machine, kept under
version control with git. There is no cloud service holding it. If you
configure a remote copy of that history, each wakeup pass pushes the box's
full history there. Encrypted backups, if you set them up, go to a destination
you pick (see "What leaves the machine"). Credentials are kept in a machine-level store outside
every box, and a box holds a grant to the ones you allow it to use.

**What the agent may do.** The agent that runs a box (Claude Code or Codex)
has full permissions: nothing restricts it to a fixed list of allowed
actions. It can run any command on the machine, as the same user the box
runs as, and read or write any file in the box. On a server or in the Docker
image it can also install operating-system packages as root, through one
checking wrapper that allows only additive installs from the distribution's own
sources and refuses packages that add services, root jobs, privilege grants, or
setuid files; the packages' own install scripts still run as root. It stays within the box
directory by convention, not because anything technical forces it to.
Treat "what can the agent do" and "what can Bee Box do" as one question.

**Prompt injection is the risk the project asks you to understand.** The
agent reads your private data, ingests untrusted external content such as
email bodies, web clippings, and calendar invites, and acts with no limits on
what it's allowed to do in response. Text written by someone else can try to
steer it. The security
documentation states plainly that there is no injection filter and no
containment sandbox today. What reduces the risk is how you run it: a
single-operator box, connector syncs (the path outside content takes into the
box) off until you enable them, and a few actions that refuse to proceed
without a human present.

**What leaves the machine.** Every agent turn sends its context to the model
provider; there is no opt-out, because that is the product. If the owner
chooses a GLM or OpenRouter model, that vendor is the provider for those
turns, and its account settings govern retention (for OpenRouter, the
upstream host can change per request and the box cannot pin it). Voice goes to a
transcription vendor you configure. Quick chat, the thought box on the box
screen, sends your message, your routing rules, and recent conversation text
through OpenRouter to a routing model (TypeSafe) to choose a destination, and
posts the thought to a clear choice without asking; the documentation says
this is not a zero-retention guarantee, and leaving the OpenRouter key
ungranted avoids it while ordinary chat keeps working. A thought saved through
Siri on the iPhone, and a voice note or a share with words, takes the same route
once it reaches the box (a voice note's audio first goes to your transcription
vendor); a share with no words, such as a saved image or link, starts no chat
work; the box's agent files it a couple of minutes later, so its content goes to
your agent's vendor like any other work the agent does. Until it uploads, such a capture is held in storage on the phone itself. A page sent from the browser extension's Send to box takes the same route,
and the routing model sees the page's title, address and site and your note, not
the page's text. If you opt in to the judging model for filing documents, the prepared text of
each item and your filing rules go the same way, and a record of each decision
stays in the box. A watch that
notifies you when something changes in the box sends the text of the changed
cards to the same routing model, with a request that the provider not retain
it; it needs the same OpenRouter key. Push to the iPhone app goes through
Apple, and push to a browser through that browser's vendor; a notification
carries a title, a short body, and where a tap should land. Encrypted backups ([install/backups.md](install/backups.md)) send data only if
you set them up, from Admin or the command line. A backup holds the box's git history and attachments, its
secrets, and its agent conversation files, encrypted by restic before upload;
the recovery password stays with you, and a lost password makes the backup
unreadable. The operating-system user the box runs as holds the unattended
password and the destination's access credentials, and so can the agent: if the
destination permits deletion, a misled agent could delete backups. The
documentation recommends a destination with versioning or immutability, and
says a test restore is the final proof that a backup works. Google services,
web push, and publishing send data only if you connect them. A
published site is stored and served by the Cloudflare account you connect, and
is visible to whoever has its address. Gmail access is limited to
reading and drafting; the system never asks for permission to send mail on
its own. Bee Box's own code sends no usage tracking, analytics,
crash reports, or update checks. The coding agent it runs is the exception.
Claude Code, on Claude models, sends its own usage metrics to Anthropic (which
Anthropic documents as excluding code, prompts, and file paths) and, for Pro
and Max sign-ins, redacted error reports to an error-tracking vendor; both are
on by default and the owner can turn them off per box in Admin. Runs on other
vendors' models never send them. Codex has its own analytics to OpenAI, off
unless the owner turns them on, because they include hashes of the lines each
change adds.

**Authentication is always on.** Every route sits behind a login wall, with
no flag that disables it. A box with no member list is owner-only.

Read [security/overview.md](security/overview.md) for the threat model,
accepted risks, and known limitations, including that boxes served by one hub share a
browser security boundary and, on a local machine, a system-level account. The
maintainer's own server pipeline, which the documentation says is not a
supported install path, now gives each box its own operating-system user and a
service sandbox that hides sibling boxes' directories; the security overview
had not yet been updated for that when this was written.
