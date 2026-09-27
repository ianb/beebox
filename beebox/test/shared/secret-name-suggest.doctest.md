# Near-miss secret names

`suggestSecretName` (`src/shared/secret-name-suggest.ts`) catches typed secret
names that are not exactly a registered name but resolve to nothing because
they are close — case, punctuation — without ever using edit distance, which
would also match `openai` to `openrouter`.

```ts setup
import { normalizeSecretName, suggestSecretName } from "../../src/shared/secret-name-suggest.js";

const known = ["openrouter", "openai-thinking", "mistral", "telegram-bot/"];
```

## Case and punctuation typos normalise to the registered name

```ts
suggestSecretName("OpenRouter", known)
=> openrouter

suggestSecretName("open-router", known)
=> openrouter
```

## An exact match never suggests

```ts
suggestSecretName("openrouter", known)
=> null
```

## Whitespace-only difference never suggests

Trimmed, `" openrouter "` is already the registered name exactly, so this
counts as the exact-match case above rather than a near-miss.

```ts
suggestSecretName(" openrouter ", known)
=> null
```

## A decorated name is still that name

People guess `openrouter.ai` or `openrouter-key` for a thing called
`openrouter`. A short list of the decorations actually appended — a domain
suffix, or the word for the thing — is stripped once from the end, and only
when what remains is a known name. It forgives a decoration; it never invents
a match.

```ts
[suggestSecretName("openrouter.ai", known), suggestSecretName("openrouter-key", known), suggestSecretName("OpenRouter API key", known)].join(",")
=> openrouter,openrouter,openrouter
```

A decoration with nothing known in front of it, or an unknown base, is not a
near-miss of anything.

```ts
String(suggestSecretName("key", known)) + "," + String(suggestSecretName("weatherapi.com", known))
=> null,null
```

## A genuinely new name never suggests

```ts
suggestSecretName("openrouter2", known)
=> null
```

## No edit distance — `openai` is not a typo of `openrouter`

```ts
suggestSecretName("openai", ["openrouter"])
=> null
```

## Empty input never suggests

```ts
suggestSecretName("", known)
=> null
```

## Family prefixes are ignored as match targets

`telegram-bot/` ends in `/` — nobody types that as a name.

```ts
suggestSecretName("telegrambot", known)
=> null
```

## `normalizeSecretName` strips everything but `[a-z0-9]` and case-folds

```ts
normalizeSecretName("OpenRouter")
=> openrouter

normalizeSecretName(" open-router.ai ")
=> openrouterai
```
