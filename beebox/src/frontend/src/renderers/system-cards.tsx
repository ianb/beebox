import { SystemCardBoundary } from "../components/system-cards/SystemCardBoundary";
import { adminArrivalReceipt, adminTabViewState, clearAdminArrivalState, parseAdminCardState } from "../lib/admin-card-state";
import { Text } from "../components/ui/Text";
import type { AdminTab } from "../components/admin/sections";
import { useRouterState } from "@tanstack/react-router";
import { legacyHistoryState } from "../components/history/card-state";
import { HISTORY_QUERY_CODEC, resolveViewParams } from "@shared/named-views";
import type { RendererEntry, RendererProps } from "../file-type-registry";
import { lazyComponent } from "../lib/lazy-component";

const DashboardPage = lazyComponent(() => import("../pages/DashboardPage"), (m) => m.DashboardPage);
const SettingsPage = lazyComponent(() => import("../pages/SettingsPage"), (m) => m.SettingsPage);
const QuestionsList = lazyComponent(() => import("../components/questions/QuestionsList"), (m) => m.QuestionsList);
const LandmarksList = lazyComponent(() => import("../components/landmarks/LandmarksList"), (m) => m.LandmarksList);
const HistoryViewCard = lazyComponent(() => import("../components/history/HistoryViewCard/view"), (m) => m.HistoryViewCard);
const InventoryCardBody = lazyComponent(() => import("../pages/inventory/InventoryPage"), (m) => m.InventoryCardBody);
const AdminCardBody = lazyComponent(() => import("../pages/AdminPage"), (m) => m.AdminCardBody);

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
  const changeTab = (tab: AdminTab) => props.onViewStateChange?.(adminTabViewState(props.viewState, tab), "replace");
  return <SystemCardBoundary type="admin" path={props.data.path}><AdminCardBody arrival={parsed.arrival} arrivalReceipt={arrivalReceipt} onArrivalConsumed={consumeArrival} tab={parsed.tab} section={parsed.section} onTabChange={changeTab} /></SystemCardBoundary>;
}
export const dashboardRenderer: RendererEntry = { selector: { type: "dashboard" }, renderer: { name: "Dashboard", Component: DashboardCard, priority: 100 } };
export const settingsRenderer: RendererEntry = { selector: { type: "settings" }, renderer: { name: "Settings", Component: SettingsCard, priority: 100 } };
export const questionsRenderer: RendererEntry = { selector: { type: "questions" }, renderer: { name: "Questions", Component: QuestionsCard, priority: 100 } };
export const landmarksRenderer: RendererEntry = { selector: { type: "landmarks" }, renderer: { name: "Landmarks", Component: LandmarksCard, priority: 100 } };
export const historyCardRenderer: RendererEntry = { selector: { type: "history" }, renderer: { name: "History", Component: HistoryCard, priority: 100 } };
export const inventoryRenderer: RendererEntry = { selector: { type: "inventory" }, renderer: { name: "Inventory", Component: InventoryCard, priority: 100 } };
export const adminRenderer: RendererEntry = { selector: { type: "admin" }, renderer: { name: "Admin", Component: AdminCard, priority: 100 } };
