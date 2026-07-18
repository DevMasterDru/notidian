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

import { NotidianPluginSettingsTab } from "./settings";
import { SerializedSettingsPersistence } from "./SerializedSettingsPersistence";
import { DEFAULT_SETTINGS, sanitizeNotidianSettings } from "core/schemas/settings";
import t from "shared/i18n";

const makeEl = (): any => ({
  innerHTML: "",
  createEl: () => makeEl(),
});

describe("dateReminders setting", () => {
  it("is default-off, survives sanitization, and renders in settings", () => {
    expect((DEFAULT_SETTINGS as any).dateReminders).toBe(false);
    expect((sanitizeNotidianSettings({}) as any).dateReminders).toBe(false);
    expect((sanitizeNotidianSettings({ dateReminders: true }) as any).dateReminders).toBe(true);
    expect((sanitizeNotidianSettings({ dateReminders: "true" }) as any).dateReminders).toBe(false);

    const plugin: any = {
      superstate: { settings: { ...DEFAULT_SETTINGS, basics: false } },
      saveSettings: jest.fn(),
    };
    const tab = new NotidianPluginSettingsTab({} as any, plugin);
    (tab as any).containerEl = makeEl();
    tab.display();
    const localized = (t.settings as any).dateReminders;
    expect(localized?.name).toBe("Date Reminders");
    expect(rendered).toContain(localized.name);
  });
});


type PersistedSettings = { dateReminders: boolean };

const deferredWrite = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

describe("serialized dateReminders persistence", () => {
  it("persists and reconciles the final OFF invocation when the first ON write is delayed", async () => {
    const firstWrite = deferredWrite();
    const persistence = new SerializedSettingsPersistence<PersistedSettings>();
    const settings = { dateReminders: true };
    const writes: boolean[] = [];
    const reconciled: boolean[] = [];
    let writeCount = 0;
    const persist = async (snapshot: PersistedSettings) => {
      writeCount += 1;
      if (writeCount === 1) await firstWrite.promise;
      writes.push(snapshot.dateReminders);
    };

    const on = persistence.enqueue(settings, persist, () => {
      reconciled.push(settings.dateReminders);
    });
    settings.dateReminders = false;
    const off = persistence.enqueue(settings, persist, () => {
      reconciled.push(settings.dateReminders);
    });
    firstWrite.resolve();
    await Promise.all([on, off]);

    expect(writes).toEqual([true, false]);
    expect(writes.at(-1)).toBe(false);
    expect(reconciled.at(-1)).toBe(false);
  });

  it("persists and reconciles the final ON invocation across a delayed ON-OFF-ON sequence", async () => {
    const firstWrite = deferredWrite();
    const persistence = new SerializedSettingsPersistence<PersistedSettings>();
    const settings = { dateReminders: true };
    const writes: boolean[] = [];
    const reconciled: boolean[] = [];
    let writeCount = 0;
    const persist = async (snapshot: PersistedSettings) => {
      writeCount += 1;
      if (writeCount === 1) await firstWrite.promise;
      writes.push(snapshot.dateReminders);
    };

    const firstOn = persistence.enqueue(settings, persist, () => {
      reconciled.push(settings.dateReminders);
    });
    settings.dateReminders = false;
    const off = persistence.enqueue(settings, persist, () => {
      reconciled.push(settings.dateReminders);
    });
    settings.dateReminders = true;
    const finalOn = persistence.enqueue(settings, persist, () => {
      reconciled.push(settings.dateReminders);
    });
    firstWrite.resolve();
    await Promise.all([firstOn, off, finalOn]);

    expect(writes).toEqual([true, false, true]);
    expect(writes.at(-1)).toBe(true);
    expect(reconciled.at(-1)).toBe(true);
  });

  it("exposes a failed invocation and still permits the next queued save", async () => {
    const persistence = new SerializedSettingsPersistence<PersistedSettings>();
    const failure = new Error("write failed");
    const failed = persistence.enqueue(
      { dateReminders: true },
      async () => { throw failure; },
      jest.fn(),
    );
    const writes: boolean[] = [];
    const recovered = persistence.enqueue(
      { dateReminders: false },
      async (snapshot) => { writes.push(snapshot.dateReminders); },
      jest.fn(),
    );

    await expect(failed).rejects.toBe(failure);
    await expect(recovered).resolves.toBeUndefined();
    expect(writes).toEqual([false]);
  });
});
