import { DashboardPage } from "../pages/DashboardPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SystemCardBoundary } from "../components/system-cards/SystemCardBoundary";
import { QuestionsList } from "../components/questions/QuestionsList";
import { LandmarksList } from "../components/landmarks/LandmarksList";
import { HistoryViewCard } from "../components/history/HistoryViewCard";
import { InventoryCardBody } from "../pages/inventory/InventoryPage";
import { AdminCardBody } from "../pages/AdminPage";
import { adminArrivalReceipt, clearAdminArrivalState, parseAdminCardState } from "../lib/admin-card-state";
import { Text } from "../components/ui/Text";
import { useRouterState } from "@tanstack/react-router";
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
function InventoryCard(props: RendererProps) {
  const changeState = (next: Parameters<NonNullable<RendererProps["onViewStateChange"]>>[0], method?: "push" | "replace") => props.onViewStateChange?.(next, method ?? "replace");
  return <SystemCardBoundary type="inventory" path={props.data.path}><InventoryCardBody viewState={props.viewState ?? null} onViewStateChange={changeState} /></SystemCardBoundary>;
}
function AdminCard(props: RendererProps) {
  const parsed = parseAdminCardState(props.viewState);
  const historyState = useRouterState({ select: state => state.location.state });
  if (!parsed.ok) return <SystemCardBoundary type="admin" path={props.data.path}><Text tone="danger">{parsed.error}</Text></SystemCardBoundary>;
  const arrivalReceipt = adminArrivalReceipt(historyState.__TSR_index, parsed.arrival) ?? "empty";
  const consumeArrival = () => props.onViewStateChange?.(clearAdminArrivalState(props.viewState), "replace");
  return <SystemCardBoundary type="admin" path={props.data.path}><AdminCardBody arrival={parsed.arrival} arrivalReceipt={arrivalReceipt} onArrivalConsumed={consumeArrival} /></SystemCardBoundary>;
}
registerFileType({ type: "dashboard" }, { renderer: { name: "Dashboard", Component: DashboardCard, priority: 100 } });
registerFileType({ type: "settings" }, { renderer: { name: "Settings", Component: SettingsCard, priority: 100 } });
registerFileType({ type: "questions" }, { renderer: { name: "Questions", Component: QuestionsCard, priority: 100 } });
registerFileType({ type: "landmarks" }, { renderer: { name: "Landmarks", Component: LandmarksCard, priority: 100 } });
registerFileType({ type: "history" }, { renderer: { name: "History", Component: HistoryCard, priority: 100 } });
registerFileType({ type: "inventory" }, { renderer: { name: "Inventory", Component: InventoryCard, priority: 100 } });
registerFileType({ type: "admin" }, { renderer: { name: "Admin", Component: AdminCard, priority: 100 } });
