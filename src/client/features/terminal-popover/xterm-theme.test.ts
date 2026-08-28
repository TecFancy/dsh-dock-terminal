// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  LATTE_PALETTE,
  MOCHA_PALETTE,
  schemeOf,
  themeScheme,
  xtermPaletteFor,
} from "./xterm-theme.ts";

describe("xterm theme", () => {
  it("maps theme snapshots to schemes with a dark fallback", () => {
    expect(schemeOf({ active: { colorScheme: "light" } })).toBe("light");
    expect(schemeOf({ active: { colorScheme: "dark" } })).toBe("dark");
    expect(schemeOf(undefined)).toBe("dark");
    expect(schemeOf({ active: {} })).toBe("dark");
    expect(schemeOf({ active: { colorScheme: "dark" } })).toBe("dark");
  });

  it("selects the palette per scheme and keeps them distinct", () => {
    expect(xtermPaletteFor("light")).toBe(LATTE_PALETTE);
    expect(xtermPaletteFor("dark")).toBe(MOCHA_PALETTE);
    expect(LATTE_PALETTE).not.toBe(MOCHA_PALETTE);
    expect(LATTE_PALETTE.background).toBe("#eff1f5");
    expect(MOCHA_PALETTE.background).toBe("#1e1e2e");
  });

  it("notifies subscribers only on real scheme changes", () => {
    themeScheme.set("dark");
    const seen: string[] = [];
    const off = themeScheme.subscribe(() => seen.push(themeScheme.get()));
    themeScheme.set("light");
    themeScheme.set("light");
    themeScheme.set("dark");
    off();
    themeScheme.set("light");
    expect(seen).toEqual(["light", "dark"]);
    themeScheme.set("dark");
  });
});
