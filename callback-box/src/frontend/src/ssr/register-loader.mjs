/**
 * Registers the SSR loader via module.register() (non-deprecated API).
 * Used as: node --import ./register-loader.mjs ...
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./css-loader.mjs", import.meta.url);
