/**
 * Todo-view card renderer — registers the TodoViewCard component for
 * todo-view cards.
 */

import { lazyComponent } from "../lib/lazy-component";
import type { RendererEntry } from "../file-type-registry";

export const todoViewRenderer: RendererEntry = {
  selector: { type: "todo-view" },
  renderer: { name: "Todo View", Component: lazyComponent(() => import("../components/TodoViewCard"), (m) => m.TodoViewCard), priority: 100 },
};
