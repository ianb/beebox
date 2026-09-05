import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { z } from "zod";
import { AppLayout } from "./App.js";
import { AsksPage } from "./pages/AsksPage.js";
import { BrowsePage } from "./pages/BrowsePage.js";
import { RecentPage } from "./pages/RecentPage.js";
import { IssuesPage } from "./pages/IssuesPage.js";
import { PlansPage } from "./pages/PlansPage.js";
import { ScheduleAlertPage } from "./pages/ScheduleAlertPage.js";
import { TestingPage } from "./pages/TestingPage.js";
import { WorkstreamDetailPage } from "./pages/WorkstreamDetailPage.js";
import { WorkstreamsPage } from "./pages/WorkstreamsPage.js";

const rootRoute = createRootRoute({ component: () => <Outlet /> });
const appRoute = createRoute({ getParentRoute: () => rootRoute, id: "app", component: AppLayout });
// The front door is the universal recency feed, not a list of workstreams:
// "enter a universal view, then filter by workstream if I care to" (boxholder,
// 2026-08-22). The workstream list keeps its own route — it is still how you
// reach a session to focus or resume.
const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  validateSearch: z.object({ workstream: z.string().optional() }),
  component: function IndexRoute() {
    const { workstream } = indexRoute.useSearch();
    return <RecentPage workstream={workstream ?? null} />;
  },
});
const workstreamsRoute = createRoute({ getParentRoute: () => appRoute, path: "/streams", component: WorkstreamsPage, validateSearch: z.object({ q: z.string().optional() }) });
const detailRoute = createRoute({ getParentRoute: () => appRoute, path: "/$name", component: WorkstreamDetailPage });
const scheduleAlertRoute = createRoute({ getParentRoute: () => appRoute, path: "/alerts/$name", component: ScheduleAlertPage, validateSearch: z.object({ alert: z.string().optional() }) });
const issuesRoute = createRoute({ getParentRoute: () => appRoute, path: "/issues", component: IssuesPage, validateSearch: z.object({ issue: z.string().optional(), issueVisibility: z.enum(["public", "private"]).optional(), status: z.enum(["open", "closed", "all"]).optional(), sort: z.enum(["date", "priority"]).optional(), category: z.string().optional(), priority: z.enum(["important", "normal", "backlog", "uncategorized"]).optional(), needs: z.string().optional() }) });
const plansRoute = createRoute({ getParentRoute: () => appRoute, path: "/plans", component: PlansPage });
// The selection lives in a search param, not a path segment — the shape the
// issue browser uses directly. `workstream` is a lens over the same address,
// never a location you enter first.
const browseRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/browse",
  validateSearch: z.object({ file: z.string().optional(), workstream: z.string().optional() }),
  component: function BrowseRoute() {
    const { file, workstream } = browseRoute.useSearch();
    return <BrowsePage file={file ?? ""} workstream={workstream ?? null} />;
  },
});
// The recency feed: what changed recently, in ANY workstream. `?workstream=`
// narrows the same feed rather than entering a per-workstream browser.
const recentRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/recent",
  validateSearch: z.object({ workstream: z.string().optional() }),
  component: function RecentRoute() {
    const { workstream } = recentRoute.useSearch();
    return <RecentPage workstream={workstream ?? null} />;
  },
});
const testingRoute = createRoute({ getParentRoute: () => appRoute, path: "/testing", component: TestingPage });
const asksRoute = createRoute({ getParentRoute: () => appRoute, path: "/asks", component: AsksPage });
const routeTree = rootRoute.addChildren([appRoute.addChildren([indexRoute, workstreamsRoute, detailRoute, scheduleAlertRoute, issuesRoute, plansRoute, browseRoute, recentRoute, testingRoute, asksRoute])]);
export const router = createRouter({ routeTree, basepath: "/workstreams" });
declare module "@tanstack/react-router" { interface Register { router: typeof router } }
