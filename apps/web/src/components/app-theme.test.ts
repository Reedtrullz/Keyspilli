import { afterEach, expect, it, vi } from "vitest";
import { setAppTheme } from "./app-theme";

afterEach(() => vi.unstubAllGlobals());

it("shares the stored player theme without losing other settings", () => {
  const values = new Map([["keyspilli.prefs.v1", JSON.stringify({ stageTheme: "light", speed: 0.5, transpose: 2 })]]);
  const localStorage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
  const dispatchEvent = vi.fn();
  const dataset: Record<string, string> = {};
  vi.stubGlobal("window", { localStorage, dispatchEvent });
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("document", { documentElement: { dataset } });
  vi.stubGlobal("CustomEvent", class { constructor(public type: string) {} });
  setAppTheme("charcoal");
  expect(dataset.theme).toBe("charcoal");
  expect(JSON.parse(values.get("keyspilli.prefs.v1")!)).toMatchObject({ stageTheme: "charcoal", speed: 0.5, transpose: 2 });
  expect(dispatchEvent).toHaveBeenCalledOnce();
});
