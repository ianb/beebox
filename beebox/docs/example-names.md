# Example names

Canonical, deliberately-fictional names for use in docs, tests, doctests, and
schema examples. Every name here was invented for illustration — none refers to
a real person, place, or box. Because their provenance is known, they are safe
to reuse everywhere and safe to keep in a public repository.

**Use these instead of inventing new example names ad hoc.** Reaching for a name
off the top of your head risks accidentally using a real one; drawing from this
list keeps every example provably fictional and consistent across the codebase.

The classic universal placeholders — `Alice`, `Bob`, `Carol`, `John` / `Jane
Doe`, `Foo` / `Bar` — remain fine for throwaway two-party or slot-filler
examples. Use the richer cast below when an example needs named people with
relationships, a household, or a box with a plausible purpose.

## People

### The Marlowe household
Use this family wherever an example needs related people — a shared box,
person-cards, contacts, a family scenario.

| Full name       | Short  | Example role                         |
|-----------------|--------|--------------------------------------|
| Priya Marlowe   | Priya  | adult boxholder                      |
| Tomas Marlowe   | Tomas  | adult boxholder / partner            |
| Juniper Marlowe | Juni   | child                                |
| Wren Marlowe    | Wren   | child                                |
| Odette Marlowe  | Odette | grandparent (records/archival examples) |

### Standalone people
Neutral, unambiguous names for contacts, "the user," or distinct personas:
**Idris Okafor, Noor Haddad, Bram Vance, Marisol Reyes, Kwame Boateng,
Saoirse Flynn, Mateo Duarte, Lena Ashford.**

## Boxes
Example box slugs, each conveying a plausible purpose:

| Slug          | Flavor                          |
|---------------|---------------------------------|
| `hearth`      | a household / family box        |
| `ledger`      | a records / finances box        |
| `studio`      | a creative / writing box        |
| `seminar`     | a class / learning box          |
| `hearth-test` | a test clone of a box           |
| `ledger-copy` | a working copy for migration tests |

`test1`, `demo`, and `scenarios` remain the generic infrastructure fixtures.

## Places
For example locations: **Rivermouth, Greenhollow, Stonebridge, Ashfield,
Porthaven, Larkspur Vale.**
