# Submission field validation

`validateSubmissionFields` (Track F of `docs/plans/publish-pages.md`) is the pure,
runtime-agnostic validator the Worker runs on an incoming `/__submit/` form body
and the box re-runs on pull. It checks a raw `Record<string,string>` against a
manifest `submit` block: required-and-non-empty, `maxLength`, `choice` membership,
`email` shape, and rejection of any field the block doesn't declare.

```ts setup
import { validateSubmissionFields } from "../../src/publish/submission.js";

// A block with one field of each interesting kind.
const block = {
  fields: [
    { name: "email", kind: "email", required: true, maxLength: 100 },
    { name: "message", kind: "textarea", required: true, maxLength: 20 },
    { name: "topic", kind: "choice", required: false, maxLength: 50, choices: ["bug", "idea"] },
  ],
  maxSubmissionBytes: 8192,
  maxPerDay: 20,
};
```

## Happy path — every rule satisfied

A valid body validates; the result carries only the declared fields, trimmed.

```ts
validateSubmissionFields(block, { email: "ada@example.com", message: "hi there", topic: "bug" })
=> {
  "ok": true,
  "fields": {
    "email": "ada@example.com",
    "message": "hi there",
    "topic": "bug"
  }
}
```

An absent OPTIONAL field is simply omitted from the stored fields.

```ts
validateSubmissionFields(block, { email: "ada@example.com", message: "hi" })
=> {
  "ok": true,
  "fields": {
    "email": "ada@example.com",
    "message": "hi"
  }
}
```

## A missing required field is rejected (an empty/whitespace value counts as missing)

```ts
validateSubmissionFields(block, { email: "ada@example.com" }).ok
=> false

validateSubmissionFields(block, { email: "ada@example.com", message: "   " })
=> {
  "ok": false,
  "errors": [
    "missing required field: message"
  ]
}
```

## A value over its `maxLength` is rejected

```ts
validateSubmissionFields(block, { email: "ada@example.com", message: "this message is definitely too long" })
=> {
  "ok": false,
  "errors": [
    "field 'message' exceeds maxLength 20"
  ]
}
```

## A `choice` value outside the allowed set is rejected

```ts
validateSubmissionFields(block, { email: "ada@example.com", message: "hi", topic: "spam" })
=> {
  "ok": false,
  "errors": [
    "field 'topic' must be one of: bug, idea"
  ]
}
```

## A malformed `email` value is rejected

```ts
validateSubmissionFields(block, { email: "not-an-email", message: "hi" })
=> {
  "ok": false,
  "errors": [
    "field 'email' must be a valid email address"
  ]
}
```

## An undeclared field is rejected, not silently dropped

```ts
validateSubmissionFields(block, { email: "ada@example.com", message: "hi", sneaky: "value" })
=> {
  "ok": false,
  "errors": [
    "unknown field: sneaky"
  ]
}
```
