/** Scriptless password-reset page authenticated by a short-lived bearer capability. */

import { escapeHtml, pageShell } from "./login-page.js";

export function renderPasswordResetPage(options: {
  prefix: string;
  token: string;
  email?: string;
  error: "validation" | "retry" | null;
}): string {
  const errorMessage = options.error === "validation"
    ? "Use matching passwords with at least 8 characters."
    : options.error === "retry"
      ? "Too many attempts are in progress. Wait a moment and try this same link again."
      : null;
  const error = errorMessage === null ? "" : `<div class="error" role="alert">${escapeHtml(errorMessage)}</div>`;
  const body =
    "<h1>Set a new password</h1>" +
    error +
    (options.email === undefined ? "" : `<p class="hint">Resetting password for ${escapeHtml(options.email)}</p>`) +
    `<form method="POST" action="${escapeHtml(`${options.prefix}/auth/reset-password`)}">` +
    `<input type="hidden" name="token" value="${escapeHtml(options.token)}">` +
    '<div class="field"><label for="password">New password</label>' +
    '<input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required autofocus></div>' +
    '<div class="field"><label for="confirm">Confirm new password</label>' +
    '<input id="confirm" name="confirmPassword" type="password" autocomplete="new-password" required></div>' +
    '<button type="submit">Set password</button></form>';
  return pageShell({ title: "Bee Box — Reset password", body });
}

export function renderPasswordResetUnavailablePage(): string {
  const body =
    "<h1>Reset link unavailable</h1>" +
    '<p class="hint">This password reset link is invalid or has expired. Ask the box owner for a new link.</p>';
  return pageShell({ title: "Bee Box — Reset unavailable", body });
}
