/** Scriptless public pages for accepting a member invitation. */

import { escapeHtml, pageShell } from "./login-page.js";

export function renderInviteUnavailablePage(): string {
  return pageShell({
    title: "Callback Box — Invite unavailable",
    body:
      "<h1>Invite unavailable</h1>" +
      '<p class="hint">This invitation is invalid, expired, or already used. Ask the owner for a new link.</p>',
  });
}

export function renderInvitePage(options: {
  prefix: string;
  token: string;
  email?: string | undefined;
  error: boolean;
}): string {
  const emailField = options.email
    ? `<p><strong>Email:</strong> ${escapeHtml(options.email)}</p>`
    : '<div class="field"><label for="email">Email</label>' +
      '<input id="email" name="email" type="email" autocomplete="email" required></div>';
  const error = options.error
    ? '<div class="error" role="alert">The invitation could not be accepted. Check the form or ask the owner for a new link.</div>'
    : "";
  const body =
    "<h1>Create your account</h1>" +
    '<p class="hint">If you are already signed in, accepting this invite replaces that browser session with the new member account.</p>' +
    error +
    `<form method="POST" action="${escapeHtml(`${options.prefix}/auth/invite`)}">` +
    `<input type="hidden" name="token" value="${escapeHtml(options.token)}">` +
    emailField +
    '<div class="field"><label for="name">Name</label>' +
    '<input id="name" name="name" type="text" autocomplete="name" maxlength="200" required></div>' +
    '<div class="field"><label for="password">Password</label>' +
    '<input id="password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="1024" required></div>' +
    '<div class="field"><label for="confirm">Confirm password</label>' +
    '<input id="confirm" name="confirmPassword" type="password" autocomplete="new-password" maxlength="1024" required></div>' +
    '<button type="submit">Create account</button></form>';
  return pageShell({ title: "Callback Box — Accept invite", body });
}

export function renderInvitePartialPage(email: string): string {
  return pageShell({
    title: "Callback Box — Account created",
    body:
      "<h1>Account created, access incomplete</h1>" +
      `<p>Your account for <strong>${escapeHtml(email)}</strong> was created, but box access could not be saved.</p>` +
      '<p class="hint">Contact the box owner and give them this email address. This invite cannot be reused.</p>',
  });
}
