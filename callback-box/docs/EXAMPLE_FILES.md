> **Note:** References to "command cards" and `box/commands/` in this document are outdated. The command card system has been removed.

# Callback Box: Example Files

Concrete examples of cards, schemas, directory structure, and workflows.

---

## Directory Structure

```
/
├── box/
│   ├── inbox/
│   │   ├── Meeting_Tomorrow.email-thread.card
│   │   ├── Voice_Memo_2024-01-15.memo.card
│   │   └── Voice_Memo_2024-01-15.m4a          # attachment
│   ├── questions/
│   │   └── Question_About_Project.question.card
│   ├── commands/
│   │   ├── Reply_To_Alice.email-reply.card
│   │   └── Create_Meeting.calendar-event.card
│   └── resources/
│       ├── calendar.card
│       └── contacts/
│           ├── Alice_Smith.contact.card
│           └── Bob_Jones.contact.card
├── store/
│   ├── archive/
│   │   ├── done/
│   │   │   └── Reply_To_Bob.email-reply.card
│   │   ├── failed/
│   │   │   └── Send_SMS.sms.card
│   │   └── processed/
│   │       └── Meeting_Last_Week.email-thread.card
│   └── trash/
│       └── Spam_Email.email-thread.card
├── config/
│   ├── connectors/
│   │   ├── email.connector.card
│   │   ├── email.logs/                        # connector error logs
│   │   ├── calendar.connector.card
│   │   └── calendar.logs/
│   └── schemas/
│       ├── email-thread.schema.ts
│       ├── email-reply.schema.ts
│       ├── question.schema.ts
│       └── registry.ts
└── .claude/
    ├── CLAUDE.md
    ├── agents.json
    ├── settings.json
    └── rules/
        ├── email.md
        └── calendar.md
```

---

## Card Examples

### Incoming vs Command Cards

**Incoming cards** (in `/box/inbox/`) represent external data that arrived. They have a `<source>` element recording where they came from.

**Command cards** (in `/box/commands/`) represent actions to take. Each command type has its own schema with:
- **Payload fields**: What to do (recipients, content, etc.)
- **Authorization fields**: Why it's okay to do it (source, user intent, risk assessment)

The authorization fields are defined per command type - an email needs different justification than an API call. This lets the system (and humans reviewing) understand the chain of reasoning.

### Email (simple, single message)

For quick reference, a single-message thread:

```xml
<email-thread status="new">
  <source type="imap"/>
  <subject>Meeting tomorrow?</subject>
  <participants>
    <participant>alice@example.com</participant>
    <participant>me@example.com</participant>
  </participants>
  <messages>
    <message id="abc123@mail.example.com">
      <from>alice@example.com</from>
      <date>2024-01-15T10:30:00Z</date>
      <body>
        Hi! Are you free tomorrow at 2pm for a quick sync?
        - Alice
      </body>
    </message>
  </messages>
</email-thread>
```

### Email Reply (command)

```xml
<email-reply status="draft">
  <!-- Payload -->
  <to>alice@example.com</to>
  <subject>Re: Meeting tomorrow?</subject>
  <body>
    Hi Alice,

    Yes, 2pm works for me! I'll send a calendar invite.

    Thanks!
  </body>

  <!-- Authorization (required by email-reply schema) -->
  <source ref="/store/archive/processed/Email_From_Alice.email.card"/>
  <recipient-relationship>known-contact</recipient-relationship>
  <user-intent>User asked to confirm the meeting in voice memo from 2024-01-15</user-intent>
</email-reply>
```

### Question

Questions can reference multiple cards as context—the UI should display these as attachments/previews.

```xml
<question status="pending">
  <session>.claude/sessions/abc123.jsonl</session>
  <context>
    <ref path="/box/inbox/Email_From_Alice.email-thread.card" role="subject"/>
    <ref path="/box/resources/contacts/Alice_Smith.contact.card" role="related"/>
  </context>
  <memo>
    Alice is asking about a meeting tomorrow at 2pm. I can accept,
    but I want to confirm which project this is for since she's
    involved in multiple ongoing projects.
  </memo>
  <prompt>Which project is this meeting about?</prompt>
  <input type="select-or-text">
    <option id="website">Website redesign</option>
    <option id="api">API integration</option>
    <option id="planning">Q1 planning</option>
  </input>
</question>
```

### Question (answered)

```xml
<question status="answered">
  <session>.claude/sessions/abc123.jsonl</session>
  <context>
    <ref path="/box/inbox/Email_From_Alice.email-thread.card" role="subject"/>
    <ref path="/box/resources/contacts/Alice_Smith.contact.card" role="related"/>
  </context>
  <memo>
    Alice is asking about a meeting tomorrow at 2pm. I can accept,
    but I want to confirm which project this is for since she's
    involved in multiple ongoing projects.
  </memo>
  <prompt>Which project is this meeting about?</prompt>
  <input type="select-or-text">
    <option id="website">Website redesign</option>
    <option id="api">API integration</option>
    <option id="planning">Q1 planning</option>
  </input>
  <answer selected="website">Website redesign</answer>
  <answered-at>2024-01-15T11:45:00Z</answered-at>
  <answered-via>web</answered-via>
</question>
```

### Confirmation (a question about a proposed action)

Confirmations are questions where the agent has a proposed action and wants approval:

```xml
<question status="pending" type="confirmation">
  <session>.claude/sessions/def456.jsonl</session>
  <context>
    <ref path="/box/inbox/Email_From_Alice.email-thread.card" role="subject"/>
    <ref path="/box/commands/Reply_To_Alice.email-reply.card" role="proposed-action"/>
  </context>
  <memo>
    I've drafted a reply accepting the meeting. The reply confirms 2pm
    tomorrow and mentions the website redesign project.
  </memo>
  <prompt>Should I send this reply?</prompt>
  <input type="select">
    <option id="yes">Yes, send it</option>
    <option id="yes-always">Yes, and don't ask for replies to Alice</option>
    <option id="no">No, let me edit it first</option>
    <option id="discard">No, discard the draft</option>
  </input>
</question>
```

The "yes-always" option teaches the system to escalate trust for this pattern.

### Voice Memo

```xml
<memo status="new">
  <source type="audio" file="Voice_Memo_2024-01-15.m4a"/>
  <recorded>2024-01-15T08:15:00Z</recorded>
  <duration>45s</duration>
  <transcript>
    Reminder to follow up with the design team about the new
    mockups. Also need to review the budget proposal before
    Friday's meeting.
  </transcript>
</memo>
```

### Calendar Resource

```xml
<calendar>
  <source type="google-calendar" calendar-id="primary"/>
  <last-sync>2024-01-15T12:00:00Z</last-sync>
  <events>
    <event id="evt_abc123">
      <title>Team standup</title>
      <start>2024-01-16T09:00:00Z</start>
      <end>2024-01-16T09:30:00Z</end>
      <recurring>weekly</recurring>
    </event>
    <event id="evt_def456">
      <title>Meeting with Alice</title>
      <start>2024-01-16T14:00:00Z</start>
      <end>2024-01-16T15:00:00Z</end>
      <attendees>
        <attendee>alice@example.com</attendee>
      </attendees>
    </event>
  </events>
</calendar>
```

### Contact (resource)

Contacts are individual cards in `/box/resources/contacts/`, making them easy to reference:

```xml
<!-- /box/resources/contacts/Alice_Smith.contact.card -->
<contact>
  <name>Alice Smith</name>
  <email>alice@example.com</email>
  <phone>+1-555-123-4567</phone>
  <relationship>colleague</relationship>
  <notes>Works on website redesign project. Prefers morning meetings.</notes>
</contact>
```

Commands can reference contacts directly:

```xml
<email-reply status="draft">
  <to ref="/box/resources/contacts/Alice_Smith.contact.card"/>
  <!-- ... -->
</email-reply>
```

### Email Thread (incoming)

Emails are presented as threads. A thread may contain one or more messages:

```xml
<email-thread status="new">
  <subject>Meeting tomorrow?</subject>
  <participants>
    <participant ref="/box/resources/contacts/Alice_Smith.contact.card"/>
    <participant>me@example.com</participant>
  </participants>
  <messages>
    <message id="abc123@mail.example.com">
      <from>alice@example.com</from>
      <date>2024-01-15T10:30:00Z</date>
      <body>
        Hi! Are you free tomorrow at 2pm for a quick sync?
        - Alice
      </body>
    </message>
  </messages>
</email-thread>
```

If a thread continues after being processed, the new message references the old thread:

```xml
<email-thread status="new">
  <continues ref="/store/archive/processed/Meeting_Tomorrow.email-thread.card"/>
  <subject>Re: Meeting tomorrow?</subject>
  <!-- new messages only -->
</email-thread>
```

### Calendar Event Command

```xml
<calendar-event status="ready">
  <!-- Payload -->
  <action>create</action>
  <title>Sync with Alice - Website redesign</title>
  <start>2024-01-16T14:00:00Z</start>
  <end>2024-01-16T15:00:00Z</end>
  <attendees>
    <attendee>alice@example.com</attendee>
  </attendees>
  <description>
    Quick sync on website redesign progress.
  </description>

  <!-- Authorization -->
  <source ref="/box/inbox/Email_From_Alice.email.card"/>
  <conflicts-checked>true</conflicts-checked>
  <user-intent>User confirmed via web UI after reviewing email</user-intent>
</calendar-event>
```

### Notification Command

```xml
<notification status="ready">
  <!-- Payload -->
  <title>Meeting in 15 minutes</title>
  <body>Sync with Alice - Website redesign at 2:00 PM</body>
  <channel>push</channel>

  <!-- Authorization -->
  <source ref="/box/resources/calendar.card"/>
  <urgency>routine</urgency>
  <reason>Scheduled reminder for upcoming calendar event</reason>
</notification>
```

### SMS Command

```xml
<sms status="draft">
  <!-- Payload -->
  <to>+1-555-123-4567</to>
  <body>Running 10 min late to our 2pm meeting. See you soon!</body>

  <!-- Authorization -->
  <source ref="/box/inbox/Voice_Memo_Running_Late.memo.card"/>
  <recipient-relationship>known-contact</recipient-relationship>
  <user-intent>User dictated this message in voice memo</user-intent>
</sms>
```

### HTTP Request Command

For webhooks or API integrations:

```xml
<http-request status="hold">
  <!-- Payload -->
  <method>POST</method>
  <url>https://api.example.com/webhooks/task-complete</url>
  <headers>
    <header name="Content-Type">application/json</header>
  </headers>
  <body content-type="json">
    {"task_id": "123", "status": "complete", "notes": "Reviewed and approved"}
  </body>

  <!-- Authorization -->
  <source ref="/box/inbox/Task_Review_Request.card"/>
  <endpoint-trust>configured-integration</endpoint-trust>
  <data-sensitivity>internal</data-sensitivity>
  <user-intent>Completing task workflow triggered by incoming request</user-intent>
</http-request>
```

### Executed Command (archived, success)

After successful execution, commands move to `/store/archive/done/` with results added:

```xml
<!-- /store/archive/done/Reply_To_Alice.email-reply.card -->
<email-reply status="done">
  <!-- Original payload -->
  <to>alice@example.com</to>
  <subject>Re: Meeting tomorrow?</subject>
  <body>Hi Alice, Yes, 2pm works for me!</body>

  <!-- Original authorization -->
  <source ref="/store/archive/processed/Email_From_Alice.email.card"/>
  <recipient-relationship>known-contact</recipient-relationship>
  <user-intent>User confirmed meeting in voice memo</user-intent>

  <!-- Execution result (added by connector) -->
  <result status="success">
    <executed-at>2024-01-15T12:30:00Z</executed-at>
    <message-id>def456@mail.example.com</message-id>
  </result>
</email-reply>
```

### Executed Command (archived, failed)

```xml
<!-- /store/archive/failed/Send_SMS.sms.card -->
<sms status="failed">
  <to>+1-555-123-4567</to>
  <body>Running late!</body>

  <source ref="/box/inbox/Voice_Memo.memo.card"/>
  <recipient-relationship>known-contact</recipient-relationship>
  <user-intent>User dictated message</user-intent>

  <!-- Failure result -->
  <result status="failed">
    <executed-at>2024-01-15T13:00:00Z</executed-at>
    <error>SMS gateway returned 402: Insufficient credits</error>
  </result>
</sms>
```

### Scheduled Task (recurring)

Uses iCalendar RRULE format (RFC 5545) for recurrence:

```xml
<scheduled status="active">
  <rrule>FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR</rrule>
  <time>09:00</time>
  <agent>daily-triage</agent>
  <prompt>
    Review the inbox and prepare a daily digest. Summarize new items,
    flag anything urgent, and draft the morning email summary.
  </prompt>
</scheduled>
```

### Scheduled Task (one-time future)

One-time tasks use a simple datetime. After execution, the tailing phase archives these cards since they have no future occurrences.

```xml
<scheduled status="pending">
  <at>2024-01-20T14:00:00</at>
  <agent>meeting-prep</agent>
  <prompt>
    Prepare materials for the Q1 planning meeting. Review related
    emails and compile discussion points.
  </prompt>
  <requires ref="/box/inbox/Q1_Planning_Thread.email.card"/>
</scheduled>
```

### Scheduled Task (simple sync)

For connectors that don't have push/webhook support, polling can be scheduled. The sync itself may produce no changes, which is fine—the agent only runs if there's something to react to.

```xml
<scheduled status="active">
  <rrule>FREQ=MINUTELY;INTERVAL=15</rrule>
  <action>cb pull email</action>
</scheduled>
```

Note: Calendar sync is better handled via webhook/push triggers rather than polling, since most calendar providers support change notifications.

### Schedule Embedded in Another Card

Cards can include scheduling directly:

```xml
<daily-digest>
  <rrule>FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR</rrule>
  <time>09:00</time>
  <agent>digest-sender</agent>
  <prompt>
    Compile and send the daily digest email using the template below.
  </prompt>
  <template>
    Here's your daily summary:
    - {{ inbox_count }} items in inbox
    - {{ pending_commands }} pending commands
    - {{ upcoming_events }} events today
  </template>
  <recipients>
    <recipient>me@example.com</recipient>
  </recipients>
</daily-digest>
```

### Schedule Format Reference

**Recurring schedules** use [iCalendar RRULE](https://icalendar.org/iCalendar-RFC-5545/3-3-10-recurrence-rule.html) format:

- `FREQ=DAILY` - every day
- `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` - weekdays
- `FREQ=WEEKLY;BYDAY=MO` - every Monday
- `FREQ=MONTHLY;BYMONTHDAY=1` - first of each month
- `FREQ=MINUTELY;INTERVAL=15` - every 15 minutes
- `FREQ=HOURLY` - every hour

The `<time>` element specifies the time of day (for DAILY/WEEKLY/MONTHLY rules).

**One-time schedules** use `<at>` with ISO 8601 datetime:

- `<at>2024-01-20T14:00:00</at>` - specific date and time
- `tomorrow at 9:00` - relative (resolved when card is created)
- `in 2 hours` - relative delay

---

## Connector Configuration (as cards)

### email-connector.connector.card

```xml
<connector type="email">
  <imap>
    <host>imap.example.com</host>
    <port>993</port>
    <username>me@example.com</username>
    <!-- password stored in system keychain, referenced by id -->
    <credential keychain="email-imap"/>
  </imap>
  <smtp>
    <host>smtp.example.com</host>
    <port>587</port>
    <username>me@example.com</username>
    <credential keychain="email-smtp"/>
  </smtp>
  <filters>
    <folders>
      <folder>INBOX</folder>
    </folders>
    <max-age-days>7</max-age-days>
  </filters>
</connector>
```

### calendar-connector.connector.card

```xml
<connector type="google-calendar">
  <calendar-id>primary</calendar-id>
  <credential keychain="google-oauth"/>
  <sync>
    <future-days>30</future-days>
    <past-days>7</past-days>
  </sync>
</connector>
```

---

## Schema Examples

### email-thread.schema.ts

```typescript
import { element } from "cardworks";
import { z } from "zod";

const messageElement = element("message", {
  attrs: { id: z.string() },
  children: z.tuple([
    element("from", { text: z.string().email() }),
    element("date", { text: z.string().datetime() }),
    element("body", { text: z.string() })
  ])
});

const participantElement = element("participant", {
  attrs: { ref: z.string().optional() },
  text: z.string().email().optional()
});

export const emailThreadSchema = element("email-thread", {
  attrs: {
    status: z.enum(["new", "processing", "processed"]).default("new")
  },
  children: z.tuple([
    element("source", { attrs: { type: z.literal("imap") } }).optional(),
    element("continues", { attrs: { ref: z.string() } }).optional(),
    element("subject", { text: z.string() }),
    element("participants", { children: z.array(participantElement) }),
    element("messages", { children: z.array(messageElement) })
  ])
});
```

### question.schema.ts

```typescript
import { element } from "cardworks";
import { z } from "zod";

const optionElement = element("option", {
  attrs: { id: z.string() },
  text: z.string()
});

const inputElement = element("input", {
  attrs: {
    type: z.enum(["select", "multiselect", "text", "select-or-text"])
  },
  children: z.array(optionElement).optional()
});

const refElement = element("ref", {
  attrs: {
    path: z.string(),
    role: z.enum(["subject", "related", "proposed-action"]).optional()
  }
});

export const questionSchema = element("question", {
  attrs: {
    status: z.enum(["pending", "answered"]),
    type: z.enum(["question", "confirmation"]).optional()  // confirmation = asking about a proposed action
  },
  children: z.tuple([
    element("session", { text: z.string() }),  // path to .claude session for resume
    element("context", {
      children: z.array(refElement)  // multiple refs with roles
    }),
    element("memo", { text: z.string() }),
    element("prompt", { text: z.string() }),
    inputElement,
    // Optional answer elements (present when answered)
    element("answer", {
      attrs: { selected: z.string().optional() },
      text: z.string()
    }).optional(),
    element("answered-at", { text: z.string().datetime() }).optional(),
    element("answered-via", { text: z.string() }).optional()
  ])
});
```

---

## Rules Examples

### .claude/rules/email.md

```markdown
---
globs:
  - "/box/inbox/*.email-thread.card"
  - "/box/commands/*.email-reply.card"
  - "/store/archive/**/*.email-thread.card"
---

# Email Processing Rules

## Triaging incoming email

When processing new emails:
1. Check if sender is in contacts - known senders get priority
2. Look for action items or questions that need responses
3. If spam or promotional, move to trash
4. If requires a response, either draft a reply or create a question

## Creating replies

When drafting email replies:
1. Match the tone of the original email
2. Keep responses concise
3. Always include context from the original message
4. Set status to "draft" initially - user must approve before sending

## Threading

Preserve threading by:
- Using the source ref to link to the original email
- Keeping "Re:" prefix in subject lines
- Including relevant quote from original in body if helpful
```

### .claude/rules/calendar.md

```markdown
---
globs:
  - "/box/resources/calendar.card"
  - "/box/commands/*.calendar-event.card"
---

# Calendar Rules

## Reacting to calendar changes

When the calendar syncs and there are changes:
1. New events from others - may need acknowledgment or prep
2. Cancelled events - update any related tasks
3. Time changes - check for conflicts

## Creating events

When creating calendar events:
1. Check for conflicts with existing events
2. Include relevant attendees
3. Add description with context/agenda
4. Set appropriate duration (default 30min for syncs, 60min for meetings)

## Working hours

Default working hours are 9am-5pm local time.
Don't schedule events outside these hours unless explicitly requested.
```

---

## CLI Examples

```bash
# Initialize a new callback box
cb init

# Pull from all connectors
cb pull --all

# Pull from specific connector
cb pull calendar

# Wake up and process pending items
cb wakeup

# Check current context (what agent would see)
cb context

# Validate all cards
cb validate --all

# Validate specific directory
cb validate /box/inbox/

# Execute a specific command
cb do /box/commands/Reply_To_Alice.email-reply.card
cb do Reply_To_Alice       # shorthand

# Preview what a command would do
cb do --dry-run Reply_To_Alice

# Execute all ready commands
cb exec
cb exec --dry-run          # preview all

# Move a card (updates references)
cb move /box/inbox/Email.card /store/archive/processed/Email.card

# Create a new card from template
cb create /box/commands/Reply.email-reply.card reply-to=/box/inbox/Thread.email-thread.card
cb create /box/questions/Clarify.question.card context=/box/inbox/Item.card

# Run tailing phase manually
cb tail

# Show scheduled tasks
cb scheduled
```

---

## Workflow Examples

### Processing an incoming email

```
1. Email connector runs: cb pull email
2. New file created: /box/inbox/Meeting_Tomorrow.email-thread.card
3. Connector calls: cb wakeup
4. Runner spawns triage agent
5. Agent reads email thread, decides response needed
6. Agent creates: /box/commands/Reply_To_Alice.email-reply.card (status=draft)
7. Agent commits
8. Runner runs: cb tail
9. Tailing phase indexes cards, schedules next scheduled task
10. Return to idle

Later:
11. User reviews reply in web UI, approves (status → ready)
12. cb wakeup notices ready command
13. Runner spawns execute agent
14. Agent approves, cb do runs
15. Email connector sends email
16. Command moved to /store/archive/done/
```

### Answering a question

```
1. Agent creates question card in /box/questions/ (status=pending)
2. Agent commits and exits
3. Web UI shows pending question
4. User selects answer in UI
5. UI updates card: status=answered, adds <answer> element
6. UI commits change
7. UI calls: cb wakeup
8. Wakeup detects answered question in /box/questions/
9. Runner spawns agent with --resume to continue previous session
10. Agent reads answer, continues processing
```

### Scheduled sync

```
1. Tailing phase found scheduled task: FREQ=MINUTELY;INTERVAL=15 → cb pull calendar
2. System timer fires at :15
3. cb pull calendar runs
4. Calendar connector fetches from Google
5. Updates /box/resources/calendar.card
6. Commits with diff description
7. Calls: cb wakeup
8. Runner spawns react agent
9. Agent reviews calendar changes, takes any needed actions
10. cb tail runs, schedules next wakeup
```
