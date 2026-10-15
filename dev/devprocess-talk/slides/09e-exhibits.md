# Agents that show their work, with one ask
## Supporting: the exhibits contract and a `decide` exhibit
- Chat is ephemeral and text-first; an exhibit is a durable page in a per-workstream store that survives the cull

```markdown
Every exhibit carries exactly one ask.
| Type      | Means                                   | The developer does |
| `decide`  | Pick among the enumerated `options`     | Chooses one        |
| `confirm` | You are proceeding unless told otherwise| Vetoes if wrong    |
| `react`   | You want impressions                    | Writes freeform    |
| `fyi`     | Nothing is needed                       | Reads, or does not |
The queue only works if the type is honest — `fyi` is not a dumping ground and a
real decision tagged `fyi` is a decision that never gets made.
```

```json
{"title": "Selection colors per theme",
 "ask": {"type": "decide",
   "prose": "Pick one. All as shown: I commit and wait for your go-ahead to land.
             Change some: name the figures and the color you want, I revise and reshoot.",
   "options": ["All as shown", "Change some (name figures)", "Different direction"]},
 "figures": [{"label": "A1", "caption": "System Paper, cream stock: highlighter yellow"}, …]}
```

- 128 exhibits in eight weeks (fyi 65, react 35, confirm 20, decide 8); 4 answered in the page

Notes:
The display side works; the return side goes through chat. The same is true of document comments: listed in 65 sessions, cleared in 1. An honest gap, and the talk can say so.
