import { TabArrangementView } from "../components/TabArrangementView";
import { registerFileType } from "./index";

registerFileType({ type: "tab-arrangement" }, {
  renderer: { name: "Organizer", Component: TabArrangementView, priority: 100 },
});
