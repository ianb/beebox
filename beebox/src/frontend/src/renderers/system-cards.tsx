import { DashboardPage } from "../pages/DashboardPage";
import { SettingsPage } from "../pages/SettingsPage";
import { SystemCardBoundary } from "../components/system-cards/SystemCardBoundary";
import { registerFileType, type RendererProps } from "./index";

function DashboardCard({ data }: RendererProps) {
  return <SystemCardBoundary type="dashboard" path={data.path}><DashboardPage /></SystemCardBoundary>;
}
function SettingsCard({ data }: RendererProps) {
  return <SystemCardBoundary type="settings" path={data.path}><SettingsPage /></SystemCardBoundary>;
}
registerFileType({ type: "dashboard" }, { renderer: { name: "Dashboard", Component: DashboardCard, priority: 100 } });
registerFileType({ type: "settings" }, { renderer: { name: "Settings", Component: SettingsCard, priority: 100 } });
