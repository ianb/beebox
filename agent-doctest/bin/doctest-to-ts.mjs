#!/usr/bin/env node
// Thin loader: the command is TypeScript (src/convert/cli.ts); tsx runs it.
import { register } from "tsx/esm/api";

register();
await import("../src/convert/cli.ts");
