// JSX runtime support for creating cards programmatically

export { createElement, processChildren } from "./create-element.js";
export type { JSXProps, JSXChild } from "./create-element.js";

export { defineCardJSX, JSXValidationError } from "./factory.js";
export type { CreateCardOptions } from "./factory.js";

export type {
  InferJSXProps,
  InferJSXElements,
  InferElementType,
  CardJSXFactory,
  JSXRuntimeProps,
} from "./types.js";
