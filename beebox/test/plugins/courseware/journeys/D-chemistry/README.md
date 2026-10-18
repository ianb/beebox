# Chemistry journey (retired)

This journey is part of the courseware plugin, not core Bee Box. It was
retired from the active journeys on 2026-10-17: journeys cover core
functionality, and courses are an opt-in plugin
([`src/plugins/courseware/README.md`](../../../../../src/plugins/courseware/README.md)).

The directory keeps the journey definition (`journey.yaml`) and the reports of
its four walks (`reports/`). They are historical records. All four walks ran
before courseware became a plugin (2026-10-10), when course building was a core
skill (`build-course`) that every box had. Code paths and line numbers in the
reports refer to that earlier layout.

The journey tooling in `test/user-stories/journeys/` does not run this
journey from here. To walk it again, a box must first turn on the plugin
(`plugins: ["courseware"]` in `_config/box.json`), and the run is a plugin
evaluation, not a core journey.
