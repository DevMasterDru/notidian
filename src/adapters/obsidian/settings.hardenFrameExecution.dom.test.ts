// bd Notidian-214 / ADR 0022 Decision 1a — the hardenFrameExecution settings
// toggle renders in the declarative settings tab under the Advanced section with
// its localized, tradeoff-naming label.
//
// The settings tab is declarative: a SettingObject[] grouped by category, each
// row's name/desc pulled from t.settings[name]. This drives the REAL
// NotidianPluginSettingsTab.display() against a fake Obsidian Setting/containerEl
// (Obsidian's Setting/PluginSettingTab are host-only) and asserts a setting row
// with the localized "Harden Frame Execution" name is emitted after the Advanced
// header. It also proves the localization entry exists (display() throws on a
// missing t.settings[name]).

const rendered: { kind: string; text: string }[] =
  ((globalThis as any).__settingsRendered = []);

jest.mock(
  "obsidian",
  () => {
    // A chainable no-op for toggle/text/slider/dropdown builders.
    const chain: any = new Proxy(function () {
      return chain;
    }, {
      get: () => () => chain,
    });
    class Setting {
      constructor(public containerEl: unknown) {}
      setName(name: string) {
        rendered.push({ kind: "setting", text: name });
        return this;
      }
      setDesc(_desc: string) {
        return this;
      }
      addToggle(cb: (t: unknown) => void) {
        cb(chain);
        return this;
      }
      addText(cb: (t: unknown) => void) {
        cb(chain);
        return this;
      }
      addSlider(cb: (t: unknown) => void) {
        cb(chain);
        return this;
      }
      addDropdown(cb: (t: unknown) => void) {
        cb(chain);
        return this;
      }
    }
    class PluginSettingTab {
      app: unknown;
      containerEl: unknown;
      constructor(app: unknown) {
        this.app = app;
      }
    }
    return { Setting, PluginSettingTab, App: class {} };
  },
  { virtual: true }
);
jest.mock("main", () => ({ __esModule: true, default: class {} }));
jest.mock("basics/ui/SettingsPanel", () => ({
  MakeBasicsSettingsTab: class {
    display() {}
  },
}));

import { NotidianPluginSettingsTab } from "adapters/obsidian/settings";
import { DEFAULT_SETTINGS } from "core/schemas/settings";
import t from "shared/i18n";

const makeEl = (): any => ({
  innerHTML: "",
  createEl: (tag: string, opts?: { text?: string }): any => {
    rendered.push({ kind: tag, text: opts?.text ?? "" });
    return makeEl();
  },
});

const renderSettings = () => {
  rendered.length = 0;
  const plugin: any = {
    superstate: { settings: { ...DEFAULT_SETTINGS, basics: false } },
    saveSettings: () => {
      /* no-op */
    },
  };
  const tab = new NotidianPluginSettingsTab({} as any, plugin);
  (tab as any).containerEl = makeEl();
  tab.display();
  return rendered;
};

describe("hardenFrameExecution settings toggle (Notidian-214)", () => {
  it("localization entry exists with the ADR-worded, tradeoff-naming label", () => {
    const entry = (t.settings as any).hardenFrameExecution;
    expect(entry?.name).toBe("Harden Frame Execution");
    expect(entry?.desc).toMatch(/\$api/);
    expect(entry?.desc).toMatch(/frames you authored/i);
  });

  it("renders a settings row for the toggle under the Advanced section", () => {
    const out = renderSettings();
    const label = (t.settings as any).hardenFrameExecution.name as string;
    const names = out.filter((r) => r.kind === "setting").map((r) => r.text);
    expect(names).toContain(label);

    const advancedHeader = (t.settings.sections as any).advanced as string;
    const advIdx = out.findIndex(
      (r) => r.kind === "h1" && r.text === advancedHeader
    );
    const settingIdx = out.findIndex(
      (r) => r.kind === "setting" && r.text === label
    );
    expect(advIdx).toBeGreaterThanOrEqual(0);
    expect(settingIdx).toBeGreaterThan(advIdx);
  });
});
