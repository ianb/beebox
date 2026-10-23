/**
 * Who each channel can reach for a box: the paired phones with an APNs
 * registration, and the browser push subscriptions. Under
 * `BBX_NOTIFY_FAKE=1` an empty channel gets a synthetic member, so no channel
 * is skipped as `no-audience`. See docs/implemented-plans/notifications.md (Track A,
 * Track B, "Testability").
 */

import { endpointsForBox } from "../push-subscriptions.js";
import { devicePushRegistrations, type DevicePushRegistration } from "../mobile/pairing.js";
import { boxSlug } from "../../lib/box-slug.js";
import type { Audience } from "./channels.js";
import { notifyFakeMode } from "./fake-mode.js";

/** The synthetic phone fake mode sends to when no device is registered. */
const SYNTHETIC_DEVICE: DevicePushRegistration = {
  deviceId: "synthetic",
  label: "synthetic phone",
  token: "fake-synthetic",
  environment: "sandbox",
};

export interface AudienceDetail {
  /** Phones to push to: never printed or logged with their tokens. */
  apnsDevices: DevicePushRegistration[];
  webPushEndpoints: number;
  /** Fake mode (`notifyFakeMode`): every channel sends through its fake. */
  fake: boolean;
}

export async function audienceDetail(boxRoot: string): Promise<AudienceDetail> {
  const fake = await notifyFakeMode(boxRoot);
  const devices = devicePushRegistrations(boxRoot);
  const endpoints = (await endpointsForBox(await boxSlug(boxRoot))).length;
  if (!fake) return { apnsDevices: devices, webPushEndpoints: endpoints, fake };
  return {
    apnsDevices: devices.length > 0 ? devices : [SYNTHETIC_DEVICE],
    webPushEndpoints: Math.max(endpoints, 1),
    fake,
  };
}

export function audienceFlags(detail: AudienceDetail): Audience {
  return {
    apns: detail.apnsDevices.length > 0,
    "web-push": detail.webPushEndpoints > 0,
  };
}
