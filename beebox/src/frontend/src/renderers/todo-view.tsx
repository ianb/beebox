/**
 * Todo-view card renderer — registers the TodoViewCard component for
 * todo-view cards.
 */

import { TodoViewCard } from "../components/TodoViewCard";
import { registerFileType } from "./index";

registerFileType({ type: "todo-view" }, {
  renderer: { name: "Todo View", Component: TodoViewCard, priority: 100 },
});
