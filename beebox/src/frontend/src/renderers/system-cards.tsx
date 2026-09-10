import { DashboardPage } from "../pages/DashboardPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SystemCardBoundary } from "../components/system-cards/SystemCardBoundary";
import { QuestionsList } from "../components/questions/QuestionsList";
import { LandmarksList } from "../components/landmarks/LandmarksList";
import { HistoryViewCard } from "../components/history/HistoryViewCard";
import { legacyHistoryState } from "../components/history/history-card-state";
import { HISTORY_QUERY_CODEC, resolveViewParams } from "@shared/named-views";
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
function HistoryCard(props: RendererProps) {
  const legacyState = legacyHistoryState(props.params ?? {});
  return <SystemCardBoundary type="history" path={props.data.path}><HistoryViewCard {...props}
    params={resolveViewParams({ query: props.params, codec: HISTORY_QUERY_CODEC })}
    legacyParams={props.params}
    viewState={{ ...legacyState, ...props.viewState }} /></SystemCardBoundary>;
}
registerFileType({ type: "dashboard" }, { renderer: { name: "Dashboard", Component: DashboardCard, priority: 100 } });
registerFileType({ type: "settings" }, { renderer: { name: "Settings", Component: SettingsCard, priority: 100 } });
registerFileType({ type: "questions" }, { renderer: { name: "Questions", Component: QuestionsCard, priority: 100 } });
registerFileType({ type: "landmarks" }, { renderer: { name: "Landmarks", Component: LandmarksCard, priority: 100 } });
registerFileType({ type: "history" }, { renderer: { name: "History", Component: HistoryCard, priority: 100 } });
