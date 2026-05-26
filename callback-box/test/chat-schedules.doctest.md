# Chat Schedule Parsing

`parseScheduleTags` and `parseCancelScheduleTags` extract schedule instructions from assistant response text.

```ts setup
import { parseScheduleTags, parseCancelScheduleTags, ChatScheduleManager } from "../src/core/chat-schedules.js";
import { makeTmpBox } from "./helpers/doctest-helpers.js";
import * as fs from "node:fs";
import * as path from "node:path";
```

## Basic schedule tag

```
const tags = parseScheduleTags('<schedule in="20m" label="rice timer" alarm="1" announce="check rice">Tell Ian to check the rice</schedule>');
tags.length
=> 1
```

``` continue
tags[0].label
=> rice timer

tags[0].alarm
=> true

tags[0].announce
=> check rice

tags[0].content
=> Tell Ian to check the rice

tags[0].durationMs
=> 1200000
```

## Schedule without alarm or announce

```
const tags = parseScheduleTags('<schedule in="5m" label="break">Take a break</schedule>');
tags[0].alarm
=> false

JSON.stringify(tags[0].announce)
=> null

tags[0].durationMs
=> 300000
```

## Multiple schedule tags

```
const text = 'Sure! <schedule in="10m" label="first">one</schedule> and <schedule in="30m" label="second">two</schedule>';
const tags = parseScheduleTags(text);
tags.length
=> 2

tags[0].label
=> first

tags[1].label
=> second
```

## Missing "in" attribute is skipped

```
const tags = parseScheduleTags('<schedule label="bad">no duration</schedule>');
tags.length
=> 0
```

## Invalid duration is skipped

```
const tags = parseScheduleTags('<schedule in="abc" label="bad">invalid</schedule>');
tags.length
=> 0
```

## Default label

```
const tags = parseScheduleTags('<schedule in="1m">stuff</schedule>');
tags[0].label
=> timer
```

## Duration units

```
parseScheduleTags('<schedule in="30s" label="t">x</schedule>')[0].durationMs
=> 30000

parseScheduleTags('<schedule in="2h" label="t">x</schedule>')[0].durationMs
=> 7200000

parseScheduleTags('<schedule in="1d" label="t">x</schedule>')[0].durationMs
=> 86400000
```

## Cancel schedule tags

```
const labels = parseCancelScheduleTags('OK I\'ll cancel it. <cancel-schedule label="rice timer" />');
labels.length
=> 1

labels[0]
=> rice timer
```

## Self-closing cancel without space before slash

```
const labels = parseCancelScheduleTags('<cancel-schedule label="test"/>');
labels.length
=> 1

labels[0]
=> test
```

## No tags returns empty

```
parseScheduleTags("Just a normal response with no tags").length
=> 0

parseCancelScheduleTags("Nothing to cancel here").length
=> 0
```

## Schedule mixed with other content

```
const text = `<speech>I'll set a timer for you.</speech>

<schedule in="15m" alarm="1" label="pasta" announce="pasta is ready">Check the pasta on the stove</schedule>

Let me know if you need anything else.`;
const tags = parseScheduleTags(text);
tags.length
=> 1

tags[0].label
=> pasta

tags[0].content
=> Check the pasta on the stove
```

## ChatScheduleManager with custom storage path

The `schedulesFile` option lets per-thread schedule managers use separate files:

```
const box = await makeTmpBox();
const fired = [];
const manager = new ChatScheduleManager(box.root, {
  schedulesFile: ".callback-box/thread-schedules/test-thread.json",
  onFire: ({ schedule }) => fired.push(schedule.label),
});
const schedule = manager.addSchedule({ label: "test", alarm: false, announce: null, content: "hello", durationMs: 100 });
schedule.label
=> test
```

``` continue
// Wait for the schedule to fire
await new Promise(r => setTimeout(r, 200));
fired.length
=> 1

fired[0]
=> test
```

``` continue
// Verify it persisted to the custom path
const filePath = path.join(box.root, ".callback-box/thread-schedules/test-thread.json");
fs.existsSync(filePath)
=> true
```

``` cleanup
manager.stopAll();
```

## Schedule tags in chat-response context

Schedule tags that appear alongside `<chat-response>` tags in Telegram-style output are correctly parsed from the full turn text:

```
const text = `<chat-response>Got it, I'll remind you in 20 minutes</chat-response>
<schedule in="20m" label="reminder">Remind about the meeting</schedule>`;
const tags = parseScheduleTags(text);
tags.length
=> 1

tags[0].label
=> reminder

tags[0].content
=> Remind about the meeting
```
