import { DashboardPage } from "../pages/DashboardPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SystemCardBoundary } from "../components/system-cards/SystemCardBoundary";
import { QuestionsList } from "../components/questions/QuestionsList";
import { LandmarksList } from "../components/landmarks/LandmarksList";
import { registerFileType, type RendererProps } from "./index";

function DashboardCard({ data }: RendererProps) {
  return <SystemCardBoundary type="dashboard" path={data.path}><DashboardPage /></SystemCardBoundary>;
}
function SettingsCard({ data }: RendererProps) {
  return <SystemCardBoundary type="settings" path={data.path}><SettingsPage /></SystemCardBoundary>;
}
function QuestionsCard({ data }: RendererProps) {
  return <SystemCardBoundary type="questions" path={data.path}><QuestionsList /></SystemCardBoundary>;
}
function LandmarksCard({ data }: RendererProps) {
  return <SystemCardBoundary type="landmarks" path={data.path}><LandmarksList /></SystemCardBoundary>;
}
registerFileType({ type: "dashboard" }, { renderer: { name: "Dashboard", Component: DashboardCard, priority: 100 } });
registerFileType({ type: "settings" }, { renderer: { name: "Settings", Component: SettingsCard, priority: 100 } });
registerFileType({ type: "questions" }, { renderer: { name: "Questions", Component: QuestionsCard, priority: 100 } });
registerFileType({ type: "landmarks" }, { renderer: { name: "Landmarks", Component: LandmarksCard, priority: 100 } });
