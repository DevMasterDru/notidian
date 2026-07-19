/**
 * @jest-environment jsdom
 */
const rendered: string[] = [];

jest.mock(
  "obsidian",
  () => {
    const chain: any = new Proxy(function () {}, { get: () => () => chain });
    class Setting {
      setName(name: string) { rendered.push(name); return this; }
      setDesc() { return this; }
      addToggle(callback: (toggle: unknown) => void) { callback(chain); return this; }
      addText(callback: (text: unknown) => void) { callback(chain); return this; }
      addSlider(callback: (slider: unknown) => void) { callback(chain); return this; }
      addDropdown(callback: (dropdown: unknown) => void) { callback(chain); return this; }
    }
    class PluginSettingTab { app: unknown; containerEl: unknown; constructor(app: unknown) { this.app = app; } }
    return { Setting, PluginSettingTab, App: class {} };
  },
  { virtual: true },
);
jest.mock("main", () => ({ __esModule: true, default: class {} }));
jest.mock("basics/ui/SettingsPanel", () => ({ MakeBasicsSettingsTab: class { display() {} } }));

import { DEFAULT_SETTINGS, sanitizeNotidianSettings } from "core/schemas/settings";
import t from "shared/i18n";
import { NotidianPluginSettingsTab } from "./settings";

const makeEl = (): any => ({ innerHTML: "", createEl: () => makeEl() });

describe("dateScheduleAuthoring setting", () => {
  it("is default-on, strictly sanitized, localized, and rendered in settings", () => {
    expect((DEFAULT_SETTINGS as any).dateScheduleAuthoring).toBe(true);
    expect((sanitizeNotidianSettings({}) as any).dateScheduleAuthoring).toBe(true);
    expect(
      (sanitizeNotidianSettings({ dateScheduleAuthoring: false }) as any)
        .dateScheduleAuthoring,
    ).toBe(false);
    expect(
      (sanitizeNotidianSettings({ dateScheduleAuthoring: "false" }) as any)
        .dateScheduleAuthoring,
    ).toBe(true);

    const localized = (t.settings as any).dateScheduleAuthoring;
    expect(localized?.name).toBe("Date Schedule Authoring");
    const plugin: any = {
      superstate: { settings: { ...DEFAULT_SETTINGS, basics: false } },
      saveSettings: jest.fn(),
    };
    const tab = new NotidianPluginSettingsTab({} as any, plugin);
    (tab as any).containerEl = makeEl();
    tab.display();
    expect(rendered).toContain(localized.name);
  });
});
