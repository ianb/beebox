/**
 * The box screen's route (docs/plans/box-screen.md, track 2), apart from its
 * parent and page: no chat is mounted on it (`standalone`). The retired
 * `/quick-chat` redirects here.
 */
export const boxScreenRouteOptions = {
  staticData: { title: "Box", standalone: true },
  path: "/box",
} as const;
