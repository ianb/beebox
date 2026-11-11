// # One box cannot take the host down
//
// On 2026-11-11 one box's eval filled all of RAM and the host's swap, and the
// host thrashed until a hard reset. The reboot then left /run/beebox
// root-only, because that host predated cloud-init's tmpfiles entry, and the
// hub could not start. These checks tie the fixes to the files the deploy
// installs.

import { test } from "tap";
import "@ianbicking/tap-check/tap";
import { any, containing } from "@ianbicking/tap-check/check";
import { readFile } from "node:fs/promises";

const deploy = await readFile("deploy/deploy.sh", "utf8");
const cloudInit = await readFile("deploy/hetzner/cloud-init.yaml", "utf8");
const tmpfiles = await readFile("deploy/systemd/beebox.tmpfiles.conf", "utf8");
const sandbox = await readFile("deploy/systemd/box-sandbox.conf", "utf8");
const slice = await readFile("deploy/systemd/beebox-boxes.slice", "utf8");

const entries = (text: string): string[] =>
  text.split("\n").map((line) => line.trim()).filter((line) => /^d \//.test(line));

void test("cloud-init writes the same tmpfiles entries the deploy installs", (t) => {
  t.check(entries(tmpfiles), containing(["d /run/beebox        0775 root   beebox       -"]));
  t.check(entries(cloudInit), entries(tmpfiles));
  t.end();
});

void test("Every deploy installs the tmpfiles entry and applies it", (t) => {
  t.check(deploy, any(String).includes('tmpfiles_src="$install_dir/beebox/deploy/systemd/beebox.tmpfiles.conf"'));
  t.check(deploy, any(String).includes("systemd-tmpfiles --create /etc/tmpfiles.d/beebox.conf"));
  t.end();
});

void test("Each box unit caps its swap and runs under the shared boxes slice", (t) => {
  t.check(sandbox, any(String).includes("\nMemorySwapMax=512M\n"));
  t.check(sandbox, any(String).includes("\nSlice=beebox-boxes.slice\n"));
  t.check(slice, any(String).includes("\n[Slice]\nMemoryHigh=75%\nMemoryMax=85%\nMemorySwapMax=2G\n"));
  t.check(deploy, any(String).includes("units=(beebox-boxes.slice "));
  t.end();
});
