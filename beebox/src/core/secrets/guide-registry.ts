/**
 * What each built-in secret IS, and where a person gets one — the guidance
 * layer secret custody named and left to agents at capture time
 * (`docs/implemented-plans/secret-custody.md`, "Guided entry + validation":
 * *where to obtain the key, what it looks like, what it will be used for*).
 *
 * The third of those is deliberately NOT here. "What it is used for" lives in
 * `uses.ts`, derived from real call sites, and the query that serves a guide
 * joins it in — so a new consumer of a key shows up on the admin page without
 * anyone editing prose twice. This registry holds only the two things no call
 * site can tell you: what the credential is in the boxholder's terms, and the
 * page they get it from.
 *
 * SERVER-OWNED, like the probe registry and for the same reason
 * (`probe-registry.ts`): a guide carries a URL the boxholder will click and a
 * description they will trust. An agent may declare an ad-hoc secret; it may
 * never author the page that tells a person where to paste their key from.
 *
 * Keyed like its siblings — exact name, or a `family/` prefix — through
 * `name-match.ts`.
 */

import { lookupByName } from "./name-match.js";
import { builtinSecretNames } from "./uses.js";

export interface SecretGuide {
  /** The noun a person would search for: "OpenRouter API key". */
  title: string;
  /** One or two sentences: what this credential is, in the boxholder's terms. */
  what: string;
  /** The provider's key-management page — where a person gets one. */
  obtainUrl: string;
  /** Numbered steps, in the register of the Telegram section's "Setup steps". */
  obtainSteps: string[];
}

const guides: Record<string, SecretGuide> = {
  openrouter: {
    title: "OpenRouter API key",
    what:
      "One account that fronts many model providers, billed together. A single OpenRouter key stands in for "
      + "separate OpenAI, Google and Mistral keys for every service listed below — one key and one bill instead of four.",
    obtainUrl: "https://openrouter.ai/settings/keys",
    obtainSteps: [
      "Sign in at openrouter.ai and add a few dollars of credit — usage is pay-as-you-go and these services cost cents",
      "Open Settings → Keys and choose Create key; a name like \"bee box\" is enough, and a spending limit is optional",
      "Copy the key — it starts with sk-or-v1- and is shown once",
      "Paste it below",
    ],
  },
  openai: {
    title: "OpenAI API key (general)",
    what:
      "The box's general OpenAI key — semantic search embeddings and OpenAI calls from box views. Kept separate from "
      + "the speech key on purpose: paying for transcription is not consent to pay for embeddings.",
    obtainUrl: "https://platform.openai.com/api-keys",
    obtainSteps: [
      "Sign in at platform.openai.com and make sure the account has billing set up",
      "Open API keys and choose Create new secret key",
      "Copy the key — it starts with sk- and is shown once",
      "Paste it below",
    ],
  },
  "openai-thinking": {
    title: "OpenAI API key (speech)",
    what:
      "The OpenAI key behind the box's voice: text-to-speech for chat replies, the Whisper transcription pass, and "
      + "minting the short-lived keys the browser uses for live dictation. Can be the same key as the general one, "
      + "held under its own name so the two spends stay separately grantable.",
    obtainUrl: "https://platform.openai.com/api-keys",
    obtainSteps: [
      "Sign in at platform.openai.com and make sure the account has billing set up",
      "Open API keys and choose Create new secret key",
      "Copy the key — it starts with sk- and is shown once",
      "Paste it below",
    ],
  },
  gemini: {
    title: "Google AI Studio (Gemini) API key",
    what:
      "A key for Google's Gemini models through AI Studio. The box uses it to answer questions about a voice "
      + "recording and, when the Gemini scan backend is selected, to describe scanned photos.",
    obtainUrl: "https://aistudio.google.com/app/apikey",
    obtainSteps: [
      "Sign in at aistudio.google.com with a Google account",
      "Choose Get API key, then Create API key (a new Google Cloud project is fine)",
      "Copy the key — it usually starts with AIza",
      "Paste it below",
    ],
  },
  mistral: {
    title: "Mistral API key",
    what:
      "A key for Mistral's models. The box uses it for Voxtral transcription — recordings, live chat dictation, and "
      + "the diarized transcript pass that labels who is speaking.",
    obtainUrl: "https://console.mistral.ai/api-keys",
    obtainSteps: [
      "Sign in at console.mistral.ai and add a payment method",
      "Open API keys and choose Create new key",
      "Copy the key — one long token with no spaces",
      "Paste it below",
    ],
  },
  deepgram: {
    title: "Deepgram credentials",
    what:
      "A Deepgram management key plus the project it belongs to, stored together as JSON. The box uses the project "
      + "to mint short-lived keys for live dictation in the browser; the management key itself never leaves the server.",
    obtainUrl: "https://console.deepgram.com/",
    obtainSteps: [
      "Sign in at console.deepgram.com and open your project",
      "Under API keys, create a key with member scope so it may mint temporary keys",
      "Note the project id from the project's settings",
      "Paste both below as JSON: {\"apiKey\": \"…\", \"projectId\": \"…\"}",
    ],
  },
  anthropic: {
    title: "Anthropic API key",
    what:
      "A key for Anthropic's API, used only by box views that call it through the server-side adapter. The agent "
      + "itself runs on subscription auth and does not use this key.",
    obtainUrl: "https://console.anthropic.com/settings/keys",
    obtainSteps: [
      "Sign in at console.anthropic.com",
      "Open Settings → API keys and choose Create key",
      "Copy the key — it starts with sk-ant- and is shown once",
      "Paste it below",
    ],
  },
  replicate: {
    title: "Replicate API token",
    what: "A token for Replicate's hosted models, used only by box views that call it through the server-side adapter.",
    obtainUrl: "https://replicate.com/account/api-tokens",
    obtainSteps: [
      "Sign in at replicate.com",
      "Open Account → API tokens and create one",
      "Copy the token and paste it below",
    ],
  },
  "google-oauth-client-id": {
    title: "Google OAuth client id",
    what:
      "Half of the Google OAuth application's identity — the consent screen and token refresh behind Gmail, Calendar, "
      + "Drive and Google sign-in. Paired with the client secret.",
    obtainUrl: "https://console.cloud.google.com/apis/credentials",
    obtainSteps: [
      "In Google Cloud Console, open APIs & Services → Credentials",
      "Create an OAuth client id of type Web application, with this box's callback URL as an authorised redirect",
      "Copy the client id — it ends in .apps.googleusercontent.com — and paste it below; add the client secret as its own entry",
    ],
  },
  "google-oauth-client-secret": {
    title: "Google OAuth client secret",
    what: "The other half of the Google OAuth application's identity, paired with the client id.",
    obtainUrl: "https://console.cloud.google.com/apis/credentials",
    obtainSteps: [
      "In Google Cloud Console, open APIs & Services → Credentials and open the OAuth client you created",
      "Copy the client secret and paste it below",
    ],
  },
  "telegram-bot/": {
    title: "Telegram bot",
    what: "This box's Telegram bot token and webhook secret. Not pasted here — the Telegram section on this page sets it up.",
    obtainUrl: "https://t.me/BotFather",
    obtainSteps: ["Use the Telegram section above: it walks through @BotFather and stores the result under this name"],
  },
  "publish/": {
    title: "Publishing credentials",
    what: "The R2 ingestion credentials for this box's published site. Not pasted here — `bbx pub setup` provisions them.",
    obtainUrl: "https://dash.cloudflare.com/",
    obtainSteps: ["Run `bbx pub setup`; it mints a scoped token and stores it under this name"],
  },
};

/** The guide for one store name, or null when the engine has none for it. */
export function secretGuideFor(name: string): { key: string; guide: SecretGuide } | null {
  const hit = lookupByName(guides, name);
  return hit === null ? null : { key: hit.key, guide: hit.entry };
}

/**
 * Every guide, for the add form's list of things a box can connect. Family
 * prefixes are included so a caller can explain them; the form filters on the
 * trailing slash because they are provisioned by their own flows, not pasted.
 */
export function listSecretGuides(): Array<{ key: string; guide: SecretGuide }> {
  return Object.entries(guides).map(([key, guide]) => ({ key, guide }));
}

/**
 * Names the engine has a use for but no guide — should be empty. A doctest
 * asserts it, so adding a consumer to `uses.ts` without writing its guide fails
 * loudly instead of leaving a name the add form cannot explain.
 */
export function unguidedSecretNames(): string[] {
  return builtinSecretNames().filter((name) => !(name in guides));
}
