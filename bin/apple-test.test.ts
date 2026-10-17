// Pure logic of bin/apple-test: argument parsing, step selection, simulator choice.
//   node --import tsx --test bin/apple-test.test.ts

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chooseSimulator,
  isFullXcode,
  parseArgs,
  stepsForChanged,
  UsageError,
} from "./apple-test.js";

test("flags choose steps", () => {
  assert.deepEqual(parseArgs([]).steps, ["shared", "mac"]);
  assert.deepEqual(parseArgs(["--package-only"]).steps, ["shared"]);
  assert.deepEqual(parseArgs(["--ios"]).steps, ["shared", "ios"]);
  assert.deepEqual(parseArgs(["--all"]).steps, ["shared", "mac", "ios"]);
});

test("bad arguments are usage errors", () => {
  assert.throws(() => parseArgs(["--ios", "--all"]), UsageError);
  assert.throws(() => parseArgs(["--nope"]), UsageError);
  assert.throws(() => parseArgs(["stray"]), UsageError);
  assert.throws(() => parseArgs(["--changed"]), UsageError);
  assert.throws(
    () => parseArgs(["--all", "--changed", "ios-app/x.swift"]),
    UsageError,
  );
});

test("changed paths pick steps", () => {
  assert.deepEqual(stepsForChanged(["ios-app/BeeBox/A.swift"]), ["ios"]);
  assert.deepEqual(stepsForChanged(["mac-app/Package.swift"]), ["mac"]);
  assert.deepEqual(stepsForChanged(["apple-shared/Sources/X.swift"]), [
    "shared",
    "ios",
  ]);
  assert.deepEqual(stepsForChanged(["mac-app/a", "ios-app/b"]), ["mac", "ios"]);
  assert.deepEqual(stepsForChanged(["bin/x.ts", "ios-app-notes/x"]), []);
});

test("--changed with no Apple path does nothing", () => {
  const options = parseArgs(["--changed", "bin/x.ts"]);
  assert.equal(options.nothingToDo, true);
  assert.deepEqual(options.steps, []);
  assert.deepEqual(parseArgs(["--changed", "mac-app/a", "bin/x.ts"]).steps, [
    "mac",
  ]);
});

const device = (
  udid: string,
  name: string,
): { udid: string; name: string; state: string; isAvailable: boolean } => ({
  udid,
  name,
  state: "Shutdown",
  isAvailable: true,
});

test("simulator: booted iPhone wins over a newer runtime", () => {
  const json = {
    devices: {
      "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
        device("new", "iPhone 17"),
      ],
      "com.apple.CoreSimulator.SimRuntime.iOS-18-6": [
        { ...device("old", "iPhone 16"), state: "Booted" },
      ],
    },
  };
  assert.equal(chooseSimulator(json)?.udid, "old");
});

test("simulator: else first iPhone on the newest iOS runtime, numerically", () => {
  const json = {
    devices: {
      "com.apple.CoreSimulator.SimRuntime.iOS-9-3": [device("a", "iPhone 6")],
      "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
        device("pad", "iPad Pro"),
        { ...device("gone", "iPhone 17e"), isAvailable: false },
        device("pick", "iPhone 17 Pro"),
        device("second", "iPhone 17"),
      ],
      "com.apple.CoreSimulator.SimRuntime.iOS-26-1": [device("b", "iPhone 16")],
      "com.apple.CoreSimulator.SimRuntime.watchOS-12-0": [
        device("w", "iPhone-ish watch"),
      ],
    },
  };
  assert.deepEqual(chooseSimulator(json), {
    udid: "pick",
    name: "iPhone 17 Pro",
  });
});

test("simulator: none available", () => {
  assert.equal(chooseSimulator({ devices: {} }), undefined);
  assert.equal(chooseSimulator({}), undefined);
  assert.equal(
    chooseSimulator({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [device("p", "iPad")],
      },
    }),
    undefined,
  );
});

test("Command Line Tools is not full Xcode", () => {
  assert.equal(
    isFullXcode("/Applications/Xcode.app/Contents/Developer\n"),
    true,
  );
  assert.equal(
    isFullXcode("/Applications/Xcode-beta.app/Contents/Developer"),
    true,
  );
  assert.equal(isFullXcode("/Library/Developer/CommandLineTools"), false);
});
