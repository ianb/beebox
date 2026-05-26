/**
 * Todo-list card renderer — registers the TodoListView component for
 * todo-list cards.
 */

import { TodoListView } from "../components/TodoListView";
import { registerCardRenderer } from "./index";

registerCardRenderer("todo-list", {
  name: "Todo List",
  Component: TodoListView,
  priority: 100,
});
