import { useEffect, useLayoutEffect } from "react";

/**
 * `useLayoutEffect` in the browser, `useEffect` during server rendering.
 *
 * React 18's server renderer warns on every `useLayoutEffect` call, even when
 * the callback would return early, because it never runs layout effects. The
 * server never runs `useEffect` either, so this swap changes nothing there and
 * keeps the browser's pre-paint timing for focus and measurement.
 */
export const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
