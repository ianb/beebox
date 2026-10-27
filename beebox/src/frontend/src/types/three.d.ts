/**
 * FigureMount.tsx loads three only to hand its namespace to an agent-written
 * sketch, typed `unknown`; nothing here calls into it. An empty module stands
 * in for @types/three, which cost a ~10 MB install for that one import.
 */
declare module "three" {}
