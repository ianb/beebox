# Card Templates

Template generators produce XML card content for the core card types. All templates escape special characters and produce well-formed XML.

```ts setup
import { createMemoTemplate, createSelectQuestionTemplate } from "../src/schemas/index.js";
```

## Memo

A memo captures a piece of content, optionally with a source:

```
createMemoTemplate("Test content", "test-source")
=>
<memo status="new">
  <created>«date»</created>
  <content>Test content</content>
  <source>test-source</source>
</memo>
```

Source is optional:

```
createMemoTemplate("Just content")
=>
<memo status="new">
  <created>«date»</created>
  <content>Just content</content>
</memo>
```

Special characters in content are XML-escaped:

```
createMemoTemplate("Test <content> & more")
=>
<memo status="new">
  <created>«date»</created>
  <content>Test &lt;content&gt; &amp; more</content>
</memo>
```

## Question

A select question presents options to the user:

```
createSelectQuestionTemplate({
  memo: "Context here",
  prompt: "What do you want?",
  options: [
    { id: "a", label: "Choice A" },
    { id: "b", label: "Choice B" },
  ],
})
=>
<question status="pending">
  <memo>Context here</memo>
  <prompt>What do you want?</prompt>
  <input type="select">
    <option id="a">Choice A</option>
    <option id="b">Choice B</option>
  </input>
</question>
```

Special characters in questions are escaped:

```
createSelectQuestionTemplate({
  memo: "Context with <special> & chars",
  prompt: "What's \"this\"?",
  options: [{ id: "a", label: "Option <A>" }],
})
=>
<question status="pending">
  <memo>Context with &lt;special&gt; &amp; chars</memo>
  <prompt>What's "this"?</prompt>
  <input type="select">
    <option id="a">Option &lt;A&gt;</option>
  </input>
</question>
```
