# Context Directive Detection

`parseContextDirective(texts)` decides whether a user message in chat
is the auto-seed `<context-directory>` sent when starting a chat from
a landmark. When it matches, the chat UI renders the message as a
"Context: <dir>/" chip rather than a normal user bubble. The matcher
needs to be strict — a real user message that mentions the tag in
passing should NOT trigger chip rendering.

```ts setup
import { parseContextDirective } from "../src/frontend/src/lib/context-directive.js";
```

## Plain directive matches

```
JSON.stringify(parseContextDirective([
  '<context-directory ref="store/recipes">Familiarize yourself with store/recipes before beginning</context-directory>',
]))
=> {"dir":"store/recipes"}
```

## Surrounding whitespace is tolerated

```
JSON.stringify(parseContextDirective([
  '\n  <context-directory ref="store/recipes">x</context-directory>\n  ',
]))
=> {"dir":"store/recipes"}
```

## Wrapped in <typed> still matches

The chat UI sometimes wraps user input in `<typed>`/`<speech>` tags;
`parseContextDirective` strips those so the directive still resolves.

```
JSON.stringify(parseContextDirective([
  '<typed local-time="2026-05-05T10:00"><context-directory ref="store/recipes">x</context-directory></typed>',
]))
=> {"dir":"store/recipes"}
```

## Multiple text segments are joined

User-message content can come as multiple text blocks; they're joined
before matching.

```
JSON.stringify(parseContextDirective([
  '<context-directory ref="store/recipes">',
  'Familiarize yourself with store/recipes before beginning',
  '</context-directory>',
]))
=> {"dir":"store/recipes"}
```

## Cross-directory ref preserved

```
JSON.stringify(parseContextDirective([
  '<context-directory ref="store/wren/journal">x</context-directory>',
]))
=> {"dir":"store/wren/journal"}
```

## Mixed content with other text does NOT match

A real user message that happens to mention the tag isn't a chip.

```
parseContextDirective([
  'Look at <context-directory ref="store/recipes">x</context-directory> please',
])
=> null

parseContextDirective([
  '<context-directory ref="store/recipes">x</context-directory> and another thought',
])
=> null
```

## Multiple directives in one message do NOT match

Defensive: if for some reason two seeds end up in one message, don't
silently chip-render only the first.

```
parseContextDirective([
  '<context-directory ref="a">x</context-directory><context-directory ref="b">y</context-directory>',
])
=> null
```

## Missing ref attribute does NOT match

```
parseContextDirective([
  '<context-directory>no ref here</context-directory>',
])
=> null
```

## Unclosed tag does NOT match

```
parseContextDirective([
  '<context-directory ref="store/recipes">never closes',
])
=> null
```

## Empty input returns null

```
parseContextDirective([])
=> null

parseContextDirective([""])
=> null

parseContextDirective(["   "])
=> null
```

## Plain text returns null

```
parseContextDirective(["hello"])
=> null
```
