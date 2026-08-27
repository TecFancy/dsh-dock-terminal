/**
 * Ambient typing for CSS Modules used by the client half. tsdown inlines the
 * styles into the bundle at build time; tsc only needs the class name map
 * shape. Do not import this file anywhere - it is ambient by virtue of being
 * a script (non-module) .d.ts under src/client.
 */
declare module "*.module.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

/** Plain .css side-effect imports (inlined by tsdown's css plugins). */
declare module "*.css";
