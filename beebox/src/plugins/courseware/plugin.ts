/**
 * The courseware plugin: courses built WITH a learner — a `course` manifest, a
 * `concept-map` knowledge graph, an `exposition-plan`, a `lesson-plan`, and a
 * per-learner `progress` record. A box activates it by naming `courseware` in
 * `_config/box.json` `plugins` and writing the stubs in `README.md` (Setup).
 * Published as `beebox/plugins/courseware`; the view is `beebox/plugins/courseware/view`.
 */
import { definePlugin } from "../../cards/plugin-definition.js";
import { lintCards } from "./lint.js";
import { conceptMapBase } from "./concept-map.js";
import { courseBase } from "./course.js";
import { expositionPlanBase } from "./exposition-plan.js";
import { lessonPlanBase } from "./lesson-plan.js";
import { progressBase } from "./progress.js";
import { COURSEWARE_SKILL } from "./skill.js";

export default definePlugin({
  name: "courseware",
  description: "Courses, lesson plans, learner progress",
  docs: "src/plugins/courseware/README.md",
  skill: COURSEWARE_SKILL,
  schemas: {
    course: courseBase,
    "lesson-plan": lessonPlanBase,
    "exposition-plan": expositionPlanBase,
    progress: progressBase,
    "concept-map": conceptMapBase,
  },
  views: [{ name: "concept-map", rendersCardTypes: ["concept-map"] }],
  lintCards,
});
