import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { AppLayout } from "./App.js";
import { IssuesPage } from "./pages/IssuesPage.js";
import { PlansPage } from "./pages/PlansPage.js";
import { TestingPage } from "./pages/TestingPage.js";
import { WorkstreamDetailPage } from "./pages/WorkstreamDetailPage.js";
import { WorkstreamsPage } from "./pages/WorkstreamsPage.js";

const rootRoute = createRootRoute({ component: () => <Outlet /> });
const appRoute = createRoute({ getParentRoute: () => rootRoute, id: "app", component: AppLayout });
const indexRoute = createRoute({ getParentRoute: () => appRoute, path: "/", component: WorkstreamsPage, validateSearch: z.object({ q: z.string().optional() }) });
const detailRoute = createRoute({ getParentRoute: () => appRoute, path: "/$name", component: WorkstreamDetailPage });
const issuesRoute = createRoute({ getParentRoute: () => appRoute, path: "/issues", component: IssuesPage, validateSearch: z.object({ issue: z.string().optional(), issueVisibility: z.enum(["public", "private"]).optional(), status: z.enum(["open", "closed", "all"]).optional(), sort: z.enum(["date", "priority"]).optional(), category: z.string().optional(), priority: z.enum(["important", "normal", "backlog", "uncategorized"]).optional(), needs: z.string().optional() }) });
const legacyIssueRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/issues/$",
  beforeLoad: ({ params }) => {
    const splat = (params._splat ?? "").split("/").filter(Boolean);
    const visibility = splat[0] === "private" ? "private" : "public";
    const relPath = (visibility === "private" ? splat.slice(1) : splat).join("/");
    return redirect({ to: "/issues", search: { issue: relPath, issueVisibility: visibility } });
  },
});
const plansRoute = createRoute({ getParentRoute: () => appRoute, path: "/plans", component: PlansPage });
const testingRoute = createRoute({ getParentRoute: () => appRoute, path: "/testing", component: TestingPage });
const routeTree = rootRoute.addChildren([appRoute.addChildren([indexRoute, detailRoute, issuesRoute, legacyIssueRoute, plansRoute, testingRoute])]);
export const router = createRouter({ routeTree, basepath: "/workstreams" });
declare module "@tanstack/react-router" { interface Register { router: typeof router } }
