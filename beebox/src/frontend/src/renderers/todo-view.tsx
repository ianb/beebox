/**
 * Todo-view card renderer — registers the TodoViewCard component for
 * todo-view cards.
 */

import { TodoViewCard } from "../components/TodoViewCard";
import type { RendererEntry } from "../file-type-registry";

export const todoViewRenderer: RendererEntry = {
  selector: { type: "todo-view" },
  renderer: { name: "Todo View", Component: TodoViewCard, priority: 100 },
};
