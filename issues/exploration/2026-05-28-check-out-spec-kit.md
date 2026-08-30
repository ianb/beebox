---
title: "check out spec kit"
workstream: unknown
area: beebox
---

[GitHub: github/spec-kit](https://github.com/github/spec-kit) — a spec-driven-development toolkit from GitHub for building software with AI agents from formal specifications. Worth a read for: how they structure the spec → plan → tasks → implementation pipeline, what they expose to the agent at each phase, whether their patterns map onto how procedures/commands work here.

Probably most relevant for beebox's procedure engine (the multi-step XML workflows in `config/procedures/`) and for how `bbx` commands could be authored — both are spec-then-execute shapes. Not a "port this," more a "see what they got right and steal the bits that fit."
