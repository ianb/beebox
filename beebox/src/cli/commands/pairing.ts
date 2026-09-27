/**
 * bbx pairing — paired-phone tools for testing notifications.
 *
 * `register-fake-push <label>` pairs a stand-in phone with a fake APNs token in
 * `sandbox`, so the APNs channel has an audience and runs end to end with no
 * iPhone (docs/implemented-plans/notifications.md, "Testability"). It is for dev boxes,
 * and refuses where a fake device could reach Apple or sit beside a real
 * phone: when APNs keys are configured outside fake mode, and on a box with a
 * device registered for the production host.
 */

import { Command } from "commander";
import { requireBoxRoot } from "../../lib/paths/core.js";
import { errorMessage } from "../../lib/error-guards.js";
import { devicePushRegistrations, pairFakePushDevice } from "../../core/mobile/pairing.js";
import { apnsConfigFromEnv } from "../../core/notification/apns-channel/core.js";
import { notifyFakeMode } from "../../core/notification/fake-mode.js";

/** Why this box must not get a fake device, or null when it may. */
function refusal(boxRoot: string): string | null {
  if (apnsConfigFromEnv() !== null && !notifyFakeMode()) {
    return "APNs keys are configured (BBX_APNS_*), so a push to a fake device would go to Apple. Run with BBX_NOTIFY_FAKE=1, or on a box without the keys.";
  }
  const production = devicePushRegistrations(boxRoot).find((d) => d.environment === "production");
  if (production !== undefined) {
    return `this box has a phone registered for production APNs ("${production.label}"); fake devices are for dev boxes.`;
  }
  return null;
}

/** The command's logic with `boxRoot` given, returning the exit code: the seam its doctest drives. */
export async function runRegisterFakePush(boxRoot: string, opts: { label: string }): Promise<number> {
  const label = opts.label.trim();
  if (label === "") {
    console.error("Error: a label is required");
    return 2;
  }
  const refused = refusal(boxRoot);
  if (refused !== null) {
    console.error(`Refused: ${refused}`);
    return 1;
  }
  const device = await pairFakePushDevice(boxRoot, { label });
  console.log(`Paired fake device "${device.label}" (${device.deviceId}) with a sandbox APNs token. Unpair it from Settings like any phone.`);
  return 0;
}

export const pairingCommand = new Command("pairing").description("Paired-phone tools for testing notifications");

pairingCommand
  .command("register-fake-push <label>")
  .description("Pair a stand-in phone with a fake sandbox APNs token, so notifications reach the apns channel with no iPhone (dev boxes only)")
  .action(async (label: string) => {
    try {
      process.exit(await runRegisterFakePush(await requireBoxRoot(), { label }));
    } catch (e) {
      console.error(`Error: ${errorMessage(e)}`);
      process.exit(1);
    }
  });
