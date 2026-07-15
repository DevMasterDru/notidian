/**
 * @jest-environment jsdom
 */
const rendered: { kind: string; text: string }[] = [];

jest.mock(
  "obsidian",
  () => {
    const chain: any = new Proxy(function () {}, {
      get: () => () => chain,
    });
    class Setting {
      constructor(public containerEl: unknown) {}
      setName(name: string) {
        rendered.push({ kind: "setting", text: name });
        return this;
      }
      setDesc() {
        return this;
      }
      addToggle(callback: (toggle: unknown) => void) {
        callback(chain);
        return this;
      }
      addText(callback: (text: unknown) => void) {
        callback(chain);
        return this;
      }
      addSlider(callback: (slider: unknown) => void) {
        callback(chain);
        return this;
      }
      addDropdown(callback: (dropdown: unknown) => void) {
        callback(chain);
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
  createEl: (tag: string, options?: { text?: string }): any => {
    rendered.push({ kind: tag, text: options?.text ?? "" });
    return makeEl();
  },
});

describe("selectToComment settings toggle", () => {
  it("renders the localized default-on kill-switch under Advanced", () => {
    rendered.length = 0;
    const plugin: any = {
      superstate: { settings: { ...DEFAULT_SETTINGS, basics: false } },
      saveSettings: jest.fn(),
    };
    const tab = new NotidianPluginSettingsTab({} as any, plugin);
    (tab as any).containerEl = makeEl();
    tab.display();

    const entry = (t.settings as any).selectToComment;
    expect(DEFAULT_SETTINGS.selectToComment).toBe(true);
    expect(entry?.name).toBe("Select to Comment");
    expect(entry?.desc).toMatch(/frontmatter/i);

    const advanced = (t.settings.sections as any).advanced as string;
    const advancedIndex = rendered.findIndex(
      (row) => row.kind === "h1" && row.text === advanced
    );
    const settingIndex = rendered.findIndex(
      (row) => row.kind === "setting" && row.text === entry.name
    );
    expect(advancedIndex).toBeGreaterThanOrEqual(0);
    expect(settingIndex).toBeGreaterThan(advancedIndex);
  });
});
