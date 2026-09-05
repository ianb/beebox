# Pattern Matching

`KeywordPattern` compiles pattern strings into matchers for detecting keywords in speech input. Patterns support alternatives, optional words, and multi-word groups.

```ts setup
import { KeywordPattern, TESTING_EXPORTS } from "../../../src/frontend/src/lib/patmatch/index.js";
const { normalizeWord, tokenizeInput } = TESTING_EXPORTS;
```

## Word normalization

Words are lowercased with diacritics and punctuation stripped:

```ts
normalizeWord("Hello")
=> hello

normalizeWord("café")
=> cafe

normalizeWord("it's")
=> its
```

## Simple word matching

A pattern of literal words matches those words in order:

```ts
const p = KeywordPattern.compile("hello world");
p.match("hello world")?.capturedTextTrimmed
=> hello world

p.match("goodbye world")
=> undefined
```

## Plural tolerance

Patterns match common English plural forms automatically — no need to write
`message(s)?`:

```ts
const p = KeywordPattern.compile("send message");
p.match("send message")?.capturedTextTrimmed
=> send message

p.match("send messages")?.capturedTextTrimmed
=> send messages
```

`+es` and `y → ies` plurals are also handled, in either direction:

```ts
const p = KeywordPattern.compile("close (the)? box");
p.match("close the boxes")?.capturedTextTrimmed
=> close the boxes
```

```ts continue
const q = KeywordPattern.compile("parties");
q.match("the party started")?.capturedTextTrimmed
=> party
```

## Alternatives

`(a | b)` matches either word:

```ts
const p = KeywordPattern.compile("(send | deliver) message");
p.match("send message")?.capturedTextTrimmed
=> send message

p.match("deliver message")?.capturedTextTrimmed
=> deliver message

p.match("post message")
=> undefined
```

## Optional words

`word?` or `(a | b)?` makes a word optional:

```ts
const p = KeywordPattern.compile("send (the)? message");
p.match("send the message")?.capturedTextTrimmed
=> send the message

p.match("send message")?.capturedTextTrimmed
=> send message
```

## Multi-word groups

Parenthesized groups can contain multi-word alternatives:

```ts
const p = KeywordPattern.compile("(good morning | hello)");
p.match("good morning")?.capturedTextTrimmed
=> good morning

p.match("hello")?.capturedTextTrimmed
=> hello
```

## Multiple pattern lines

Patterns with multiple lines act as OR between whole phrases:

```ts
const p = KeywordPattern.compile(`
  send message
  message done
`);
p.match("send message")?.capturedTextTrimmed
=> send message

p.match("message done")?.capturedTextTrimmed
=> message done
```

## Match position and replacement

Matches can appear anywhere in the input. The match tracks leading and remaining words:

```ts
const p = KeywordPattern.compile("hello");
const m = p.match("well hello there");
m?.capturedTextTrimmed
=> hello
```

```ts continue
m?.replace("[GREETING]")
=> well [GREETING]there
```

## Punctuation handling

Punctuation doesn't prevent matching:

```ts
const p = KeywordPattern.compile("hello world");
p.match("hello, world!")?.capturedTextTrimmed
=> hello, world!
```

## Empty input

```ts
const p = KeywordPattern.compile("hello");
p.match("")
=> undefined

p.match("   ")
=> undefined
```
