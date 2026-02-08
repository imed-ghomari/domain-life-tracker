import { Notice, Plugin, normalizePath } from "obsidian";
import { LifeDomainSettingsTab } from "./settings";
import { DeleteLogsModal } from "./modals";
import {
  DomainPerformanceView,
  LogTimelineView,
  VIEW_TYPE_DOMAIN_PERFORMANCE,
  VIEW_TYPE_LOG_TIMELINE
} from "./view";

export interface LifeDomainState {
  id: string;
  name: string;
  score: number;
}

export interface LifeDomain {
  id: string;
  name: string;
  states: LifeDomainState[];
  aggregationType: "sum" | "average" | "worst";
}

export interface LifeDomainSettings {
  domains: LifeDomain[];
}

export interface DomainLogEntry {
  stateId: string;
  score: number;
  ts: number;
  note?: string;
  tzOffset?: number;
}

export interface LifeDomainDataStore {
  logs: Record<string, Record<string, DomainLogEntry[]>>;
}

interface LifeDomainStorage {
  settings: LifeDomainSettings;
  data: LifeDomainDataStore;
}

export const DEFAULT_SETTINGS: LifeDomainSettings = {
  domains: []
};

const DEFAULT_DATA: LifeDomainDataStore = {
  logs: {}
};

export default class LifeDomainTrackerPlugin extends Plugin {
  settings!: LifeDomainSettings;
  dataStore!: LifeDomainDataStore;

  async onload() {
    await this.loadSettings();

    this.addSettingTab(new LifeDomainSettingsTab(this.app, this));

    this.registerView(VIEW_TYPE_DOMAIN_PERFORMANCE, (leaf) => new DomainPerformanceView(leaf, this));
    this.registerView(VIEW_TYPE_LOG_TIMELINE, (leaf) => new LogTimelineView(leaf, this));

    this.addCommand({
      id: "log-domain-state",
      name: "Log Domain State",
      callback: () => this.openLogUi()
    });

    this.addCommand({
      id: "show-domain-performance",
      name: "Show Domain Performance",
      callback: () => this.openPerformanceView()
    });

    this.addCommand({
      id: "delete-domain-logs",
      name: "Delete Domain Logs",
      callback: () => new DeleteLogsModal(this.app, this).open()
    });
  }

  async loadSettings() {
    const raw = (await this.loadData()) as Partial<LifeDomainStorage> | LifeDomainSettings | null;
    if (!raw) {
      this.settings = { ...DEFAULT_SETTINGS };
      this.dataStore = { ...DEFAULT_DATA };
      return;
    }

    if ("settings" in raw || "data" in raw) {
      const storage = raw as Partial<LifeDomainStorage>;
      this.settings = Object.assign({}, DEFAULT_SETTINGS, storage.settings);
      this.dataStore = Object.assign({}, DEFAULT_DATA, storage.data);
    } else {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, raw as LifeDomainSettings);
      this.dataStore = { ...DEFAULT_DATA };
    }

    this.ensureIds();
  }

  async saveSettings() {
    const payload: LifeDomainStorage = {
      settings: this.settings,
      data: this.dataStore
    };
    await this.saveData(payload);
  }

  addLog(domainId: string, stateId: string, note?: string, ts?: number) {
    const domain = this.settings.domains.find((d) => d.id === domainId);
    if (!domain) {
      new Notice("Domain not found.");
      return;
    }
    const state = domain.states.find((s) => s.id === stateId);
    if (!state) {
      new Notice("State not found.");
      return;
    }

    const tsFinal = ts ?? Date.now();
    const dateKey = getDateKeyFromTs(tsFinal);
    if (!this.dataStore.logs[dateKey]) this.dataStore.logs[dateKey] = {};
    if (!this.dataStore.logs[dateKey][domainId]) this.dataStore.logs[dateKey][domainId] = [];

    this.dataStore.logs[dateKey][domainId].push({
      stateId,
      score: state.score,
      ts: tsFinal,
      note: note?.trim() || undefined,
      tzOffset: new Date(tsFinal).getTimezoneOffset()
    });

    void this.saveSettings();
  }

  getLogsForDate(dateKey: string, domainId: string): DomainLogEntry[] {
    return this.dataStore.logs[dateKey]?.[domainId] ?? [];
  }

  async exportDomainCsv(domainId: string): Promise<string | null> {
    const domain = this.settings.domains.find((d) => d.id === domainId);
    if (!domain) {
      new Notice("Domain not found.");
      return null;
    }

    const rows: string[] = [];
    rows.push("date,time,state_name,score,note");

    const stateMap = new Map(domain.states.map((s) => [s.id, s] as const));
    const dates = Object.keys(this.dataStore.logs).sort();
    for (const dateKey of dates) {
      const logs = this.dataStore.logs[dateKey]?.[domainId] ?? [];
      for (const entry of logs) {
        const state = stateMap.get(entry.stateId);
        const ts = new Date(entry.ts);
        const time = `${pad2(ts.getHours())}:${pad2(ts.getMinutes())}`;
        const name = state?.name ?? "unknown";
        const note = entry.note ?? "";
        rows.push(`${dateKey},${time},${escapeCsv(name)},${entry.score},${escapeCsv(note)}`);
      }
    }

    const fileName = `life-domain-tracker-${normalizeKey(domain.name)}-${getTodayKey()}.csv`;
    const filePath = normalizePath(fileName);
    await this.app.vault.adapter.write(filePath, rows.join("\n"));
    return filePath;
  }

  private ensureIds() {
    let changed = false;
    for (const domain of this.settings.domains) {
      if (!domain.id) {
        domain.id = generateId();
        changed = true;
      }
      if (!domain.aggregationType) {
        domain.aggregationType = "sum";
        changed = true;
      }
      for (const state of domain.states) {
        const legacyState = state as unknown as { label?: string; value?: string };
        if (!state.id) {
          state.id = generateId();
          changed = true;
        }
        if (!state.name && legacyState.label) {
          state.name = legacyState.label;
          changed = true;
        }
      }
    }
    if (changed) void this.saveSettings();
  }

  async openPerformanceView() {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_DOMAIN_PERFORMANCE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async openLogUi() {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_LOG_TIMELINE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  async deleteLogs(
    dateKey: string,
    domainId: string,
    stateId?: string,
    entryIndex?: number
  ) {
    const dayLogs = this.dataStore.logs[dateKey]?.[domainId];
    if (!dayLogs) return;
    if (entryIndex !== undefined) {
      dayLogs.splice(entryIndex, 1);
    } else if (stateId) {
      this.dataStore.logs[dateKey][domainId] = dayLogs.filter((e) => e.stateId !== stateId);
    } else {
      delete this.dataStore.logs[dateKey][domainId];
    }
    if (this.dataStore.logs[dateKey] && Object.keys(this.dataStore.logs[dateKey]).length === 0) {
      delete this.dataStore.logs[dateKey];
    }
    await this.saveSettings();
  }

  async deleteAllForDate(dateKey: string) {
    delete this.dataStore.logs[dateKey];
    await this.saveSettings();
  }
}

export function normalizeKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function getTodayKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  return `${y}-${m}-${d}`;
}

export function getDateKeyFromTs(ts: number): string {
  const date = new Date(ts);
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  return `${y}-${m}-${d}`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function escapeCsv(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
