/**
 * Registers the SSR loader via module.register() (non-deprecated API).
 * Used as: node --import ./register-loader.mjs ...
 */
import { register } from "node:module";

register("./css-loader.mjs", import.meta.url);
