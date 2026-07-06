/**
 * Todo-list card renderer — registers the TodoListView component for
 * todo-list cards.
 */

import { TodoListView } from "../components/TodoListView";
import { registerFileType } from "./index";

registerFileType({ type: "todo-list" }, {
  renderer: { name: "Todo List", Component: TodoListView, priority: 100 },
});
