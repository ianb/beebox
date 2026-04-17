/**
 * Full-page box selection UIs used by top-level routes:
 *
 *   - `<BoxRedirect>` — root `/` route. Redirects if one box exists, shows a
 *     login prompt if none + auth required, or lists boxes to pick from.
 *   - `<ShareRedirect>` — root `/share?...` route. Same behavior, but each
 *     box link preserves the share query params so the target page receives
 *     them.
 *
 * Lives in components/ so the page styling (gradients, buttons, list cards)
 * can stay next to the logic.
 */

import { useState, useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { href } from "../lib/routing";
import { fetchBoxes } from "../lib/boxes";

/**
 * Root page: if one box, redirect; if multiple, show links.
 */
export function BoxRedirect() {
  const navigate = useNavigate();
  const [boxes, setBoxes] = useState<Array<{ slug: string; name: string }>>([]);
  const [authRequired, setAuthRequired] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBoxes().then((result) => {
      setBoxes(result.boxes);
      setAuthRequired(result.authRequired ?? false);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!loading && boxes.length === 1) {
      navigate({ to: "/$boxSlug", params: { boxSlug: boxes[0]!.slug }, replace: true });
    }
  }, [loading, boxes, navigate]);

  if (loading) {
    return <div className="p-8 text-warm-600">Loading...</div>;
  }

  if (boxes.length === 0 && authRequired) {
    return (
      <div className="min-h-screen bg-warm-50 flex items-center justify-center">
        <div className="max-w-sm w-full text-center">
          <h1 className="text-2xl font-bold text-warm-800 mb-4">Callback Box</h1>
          <p className="text-warm-600 mb-6">Sign in to access your boxes.</p>
          <a
            href={`/auth/login?returnTo=${encodeURIComponent(window.location.pathname)}`}
            className="inline-block bg-primary text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-dark transition-colors"
          >
            Sign in with Google
          </a>
        </div>
      </div>
    );
  }

  if (boxes.length === 1) {
    return <div className="p-8 text-warm-600">Redirecting...</div>;
  }

  return (
    <div className="min-h-screen bg-warm-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <h1 className="text-2xl font-bold text-warm-800 mb-6 text-center">Callback Box</h1>
        <div className="space-y-3">
          {boxes.map((box) => (
            <div
              key={box.slug}
              className="bg-white rounded-lg shadow-sm border border-warm-300 overflow-hidden"
            >
              <Link
                to={href(`/${box.slug}/`)}
                className="block px-6 py-3 hover:bg-warm-50 active:bg-warm-100"
              >
                <span className="text-lg font-medium text-primary">{box.name}</span>
              </Link>
              <div className="grid grid-cols-2 divide-x divide-warm-200 border-t border-warm-200">
                <Link
                  to={href(`/${box.slug}/chat`)}
                  className="py-4 text-center text-base font-medium text-primary hover:bg-warm-50 active:bg-warm-100"
                >
                  Chat
                </Link>
                <Link
                  to={href(`/${box.slug}/capture`)}
                  className="py-4 text-center text-base font-medium text-primary hover:bg-warm-50 active:bg-warm-100"
                >
                  Capture
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Redirect /share?params to /:boxSlug/share?params.
 * Picks the first available box (or shows selector if multiple).
 */
export function ShareRedirect() {
  const navigate = useNavigate();
  const [boxes, setBoxes] = useState<Array<{ slug: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBoxes().then((result) => {
      setBoxes(result.boxes);
      setLoading(false);
    });
  }, []);

  // Preserve query params when redirecting
  const search = window.location.search;

  useEffect(() => {
    if (!loading && boxes.length === 1) {
      navigate({ to: href(`/${boxes[0]!.slug}/share${search}`), replace: true });
    }
  }, [loading, boxes, navigate, search]);

  if (loading) {
    return <div className="min-h-screen bg-warm-50 flex items-center justify-center"><span className="text-warm-600">Loading...</span></div>;
  }

  if (boxes.length === 1) {
    return <div className="min-h-screen bg-warm-50 flex items-center justify-center"><span className="text-warm-600">Redirecting...</span></div>;
  }

  if (boxes.length > 1) {
    return (
      <div className="min-h-screen bg-warm-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <h1 className="text-xl font-bold text-warm-800 mb-4 text-center">Save to which box?</h1>
          <div className="space-y-3">
            {boxes.map((box) => (
              <a
                key={box.slug}
                href={`/${box.slug}/share${search}`}
                className="block bg-white rounded-lg shadow-sm border border-warm-300 px-6 py-4 hover:border-accent hover:shadow transition-all"
              >
                <span className="text-lg font-medium text-primary">{box.name}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return <div className="p-8 text-warm-600">No boxes available.</div>;
}
