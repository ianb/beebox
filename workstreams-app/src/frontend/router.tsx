import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { AppLayout } from "./App.js";
import { AsksPage } from "./pages/AsksPage.js";
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
function legacyIssueRoute(options: {
  path: string;
  visibility: "public" | "private";
  closed: boolean;
}) {
  return createRoute({
  getParentRoute: () => appRoute,
    path: options.path,
    beforeLoad: ({ location }) => {
      const segments = location.pathname.split("/").filter(Boolean);
      const category = segments.at(-2) ?? "";
      const filename = segments.at(-1) ?? "";
      const relPath = `${options.closed ? "closed/" : ""}${category}/${filename}`;
      return redirect({
        to: "/issues",
        search: { issue: relPath, issueVisibility: options.visibility },
      });
  },
  });
}
const legacyIssueRoutes = [
  legacyIssueRoute({ path: "/issues/$category/$filename", visibility: "public", closed: false }),
  legacyIssueRoute({ path: "/issues/closed/$category/$filename", visibility: "public", closed: true }),
  legacyIssueRoute({ path: "/issues/private/$category/$filename", visibility: "private", closed: false }),
  legacyIssueRoute({ path: "/issues/private/closed/$category/$filename", visibility: "private", closed: true }),
];
const plansRoute = createRoute({ getParentRoute: () => appRoute, path: "/plans", component: PlansPage });
const testingRoute = createRoute({ getParentRoute: () => appRoute, path: "/testing", component: TestingPage });
const asksRoute = createRoute({ getParentRoute: () => appRoute, path: "/asks", component: AsksPage });
const routeTree = rootRoute.addChildren([appRoute.addChildren([indexRoute, detailRoute, issuesRoute, ...legacyIssueRoutes, plansRoute, testingRoute, asksRoute])]);
export const router = createRouter({ routeTree, basepath: "/workstreams" });
declare module "@tanstack/react-router" { interface Register { router: typeof router } }
