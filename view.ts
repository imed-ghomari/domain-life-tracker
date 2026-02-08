import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { Chart } from "chart.js/auto";
import LifeDomainTrackerPlugin, { getTodayKey } from "./main";

export const VIEW_TYPE_DOMAIN_PERFORMANCE = "life-domain-performance";

type RangeKey = "7d" | "30d" | "90d" | "365d" | "all";
type ViewKey = "domain" | "states" | "all-domains";

export class DomainPerformanceView extends ItemView {
  plugin: LifeDomainTrackerPlugin;
  chart: Chart | null = null;
  domainId: string | null = null;
  rangeKey: RangeKey = "30d";
  viewKey: ViewKey = "domain";
  smoothingEnabled = false;
  domainSelectEl: HTMLSelectElement | null = null;
  rangeSelectEl: HTMLSelectElement | null = null;
  viewSelectEl: HTMLSelectElement | null = null;
  statePickerEl: HTMLElement | null = null;
  canvasEl: HTMLCanvasElement | null = null;
  smoothingToggleEl: HTMLInputElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: LifeDomainTrackerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_DOMAIN_PERFORMANCE;
  }

  getDisplayText(): string {
    return "Life Domain Performance";
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("life-domain-modal");
    contentEl.createEl("h3", { text: "Life Domain Performance" });

    const domains = this.plugin.settings.domains;
    if (!domains.length) {
      contentEl.createEl("p", { text: "No domains configured. Add domains in settings." });
      return;
    }

    const controls = contentEl.createDiv({ cls: "life-domain-chart-controls" });
    this.viewSelectEl = controls.createEl("select");
    this.domainSelectEl = controls.createEl("select");
    this.rangeSelectEl = controls.createEl("select");
    const smoothingWrap = controls.createEl("label", { cls: "life-domain-smoothing" });
    this.smoothingToggleEl = smoothingWrap.createEl("input");
    this.smoothingToggleEl.type = "checkbox";
    smoothingWrap.createEl("span", { text: "Smoothing" });

    const views: { key: ViewKey; label: string }[] = [
      { key: "domain", label: "Domain score" },
      { key: "states", label: "State activity" },
      { key: "all-domains", label: "All domains" }
    ];
    for (const view of views) {
      this.viewSelectEl.createEl("option", { text: view.label, value: view.key });
    }

    for (const domain of domains) {
      this.domainSelectEl.createEl("option", { text: domain.name, value: domain.id });
    }

    const ranges: { key: RangeKey; label: string }[] = [
      { key: "7d", label: "Last 7 days" },
      { key: "30d", label: "Last 30 days" },
      { key: "90d", label: "Last 90 days" },
      { key: "365d", label: "Last 365 days" },
      { key: "all", label: "All time" }
    ];
    for (const range of ranges) {
      this.rangeSelectEl.createEl("option", { text: range.label, value: range.key });
    }
    this.rangeSelectEl.value = this.rangeKey;

    this.statePickerEl = contentEl.createDiv({ cls: "life-domain-state-picker" });
    this.canvasEl = contentEl.createEl("canvas");
    this.domainId = domains[0].id;

    this.viewSelectEl.addEventListener("change", () => {
      this.viewKey = (this.viewSelectEl?.value as ViewKey) ?? "domain";
      this.renderStatePicker();
      if (this.canvasEl) this.renderChart(this.canvasEl);
    });
    this.domainSelectEl.addEventListener("change", () => {
      this.domainId = this.domainSelectEl?.value ?? null;
      this.renderStatePicker();
      if (this.canvasEl) this.renderChart(this.canvasEl);
    });
    this.rangeSelectEl.addEventListener("change", () => {
      this.rangeKey = (this.rangeSelectEl?.value as RangeKey) ?? "30d";
      if (this.canvasEl) this.renderChart(this.canvasEl);
    });
    this.smoothingToggleEl.addEventListener("change", () => {
      this.smoothingEnabled = !!this.smoothingToggleEl?.checked;
      if (this.canvasEl) this.renderChart(this.canvasEl);
    });

    this.renderStatePicker();
    if (this.canvasEl) this.renderChart(this.canvasEl);
  }

  onClose() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }

  private renderStatePicker() {
    if (!this.statePickerEl) return;
    this.statePickerEl.empty();

    if (this.domainSelectEl) {
      this.domainSelectEl.disabled = this.viewKey === "all-domains";
    }

    if (this.viewKey !== "states") return;

    const domain = this.plugin.settings.domains.find((d) => d.id === this.domainId);
    if (!domain) return;

    this.statePickerEl.createEl("div", { text: "States to show:", cls: "life-domain-state-picker-title" });
    const list = this.statePickerEl.createDiv({ cls: "life-domain-state-picker-list" });

    for (const state of domain.states) {
      const label = list.createEl("label", { cls: "life-domain-state-picker-item" });
      const checkbox = label.createEl("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.dataset.stateId = state.id;
      label.createEl("span", { text: state.name || "Unnamed" });
      checkbox.addEventListener("change", () => {
        if (this.canvasEl) this.renderChart(this.canvasEl);
      });
    }
  }

  private renderChart(canvas: HTMLCanvasElement) {
    if (!this.domainId) {
      new Notice("No domains configured.");
      return;
    }

    const domain = this.plugin.settings.domains.find((d) => d.id === this.domainId);
    if (!domain) {
      new Notice("Domain not found.");
      return;
    }

    let chartData: {
      labels: string[];
      datasets: { label: string; data: number[]; borderColor: string; backgroundColor: string; spanGaps: boolean }[];
    };

    if (this.viewKey === "domain") {
      const series = buildDomainSeries(this.plugin, this.domainId, this.rangeKey);
      chartData = {
        labels: series.labels,
        datasets: [
          {
            label: domain.name,
            data: series.values,
            borderColor: "#2a9d8f",
            backgroundColor: "#2a9d8f",
            spanGaps: true
          }
        ]
      };
    } else if (this.viewKey === "states") {
      const selectedStateIds = getSelectedStateIds(this.statePickerEl);
      const series = buildStateSeries(this.plugin, this.domainId, selectedStateIds, this.rangeKey);
      chartData = {
        labels: series.labels,
        datasets: series.datasets
      };
    } else {
      const series = buildAllDomainsSeries(this.plugin, this.rangeKey);
      chartData = {
        labels: series.labels,
        datasets: series.datasets
      };
    }

    if (!chartData.labels.length) {
      new Notice("No data available for the selected view.");
      return;
    }

    const smoothingWindow = getSmoothingWindow(this.rangeKey);
    if (this.smoothingEnabled) {
      chartData = {
        labels: chartData.labels,
        datasets: chartData.datasets.map((ds) => ({
          ...ds,
          data: applyMovingAverage(ds.data, smoothingWindow)
        }))
      };
    }

    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }

    this.chart = new Chart(canvas, {
      type: "line",
      data: chartData,
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: true }
        },
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  }
}

function getSelectedStateIds(container: HTMLElement | null): string[] {
  if (!container) return [];
  const inputs = Array.from(container.querySelectorAll<HTMLInputElement>("input[type='checkbox']"));
  return inputs.filter((i) => i.checked && i.dataset.stateId).map((i) => i.dataset.stateId!);
}

function buildDomainSeries(
  plugin: LifeDomainTrackerPlugin,
  domainId: string,
  rangeKey: RangeKey
): { labels: string[]; values: number[] } {
  const domain = plugin.settings.domains.find((d) => d.id === domainId);
  if (!domain) return { labels: [], values: [] };
  const points = buildPoints(plugin, rangeKey, (dateKey) => {
    const logs = plugin.dataStore.logs[dateKey]?.[domainId] ?? [];
    return aggregateLogs(logs, domain.aggregationType);
  });
  return {
    labels: points.map((p) => p.date),
    values: points.map((p) => p.value)
  };
}

function buildStateSeries(
  plugin: LifeDomainTrackerPlugin,
  domainId: string,
  stateIds: string[],
  rangeKey: RangeKey
): { labels: string[]; datasets: { label: string; data: number[]; borderColor: string; backgroundColor: string; spanGaps: boolean }[] } {
  const domain = plugin.settings.domains.find((d) => d.id === domainId);
  if (!domain) return { labels: [], datasets: [] };

  const states = domain.states.filter((s) => stateIds.includes(s.id));
  if (!states.length) return { labels: [], datasets: [] };

  const points = buildPoints(plugin, rangeKey, (dateKey) => {
    const logs = plugin.dataStore.logs[dateKey]?.[domainId] ?? [];
    const counts = new Map<string, number>();
    for (const log of logs) {
      counts.set(log.stateId, (counts.get(log.stateId) ?? 0) + 1);
    }
    return counts;
  });

  const labels = points.map((p) => p.date);
  const datasets = states.map((state, idx) => {
    const color = colorForIndex(idx);
    return {
      label: state.name || "Unnamed",
      data: points.map((p) => (p.value as Map<string, number>).get(state.id) ?? 0),
      borderColor: color,
      backgroundColor: color,
      spanGaps: true
    };
  });
  return { labels, datasets };
}

function buildAllDomainsSeries(
  plugin: LifeDomainTrackerPlugin,
  rangeKey: RangeKey
): { labels: string[]; datasets: { label: string; data: number[]; borderColor: string; backgroundColor: string; spanGaps: boolean }[] } {
  const domains = plugin.settings.domains;
  const points = buildPoints(plugin, rangeKey, (dateKey) => {
    const perDomain: Record<string, number> = {};
    for (const domain of domains) {
      const logs = plugin.dataStore.logs[dateKey]?.[domain.id] ?? [];
      perDomain[domain.id] = aggregateLogs(logs, domain.aggregationType);
    }
    return perDomain;
  });

  const labels = points.map((p) => p.date);
  const datasets = domains.map((domain, idx) => {
    const color = colorForIndex(idx);
    return {
      label: domain.name,
      data: points.map((p) => (p.value as Record<string, number>)[domain.id] ?? 0),
      borderColor: color,
      backgroundColor: color,
      spanGaps: true
    };
  });
  return { labels, datasets };
}

function buildPoints<T>(
  plugin: LifeDomainTrackerPlugin,
  rangeKey: RangeKey,
  valueFn: (dateKey: string) => T
): { date: string; value: T }[] {
  const dates = Object.keys(plugin.dataStore.logs).sort();
  if (!dates.length) return [];

  const today = new Date();
  const rangeDays = rangeKey === "all" ? null : parseInt(rangeKey.replace("d", ""), 10);
  const startDate = rangeDays ? addDays(today, -(rangeDays - 1)) : null;

  const points: { date: string; value: T }[] = [];
  for (const dateKey of dates) {
    if (startDate && dateKey < toDateKey(startDate)) continue;
    if (dateKey > getTodayKey()) continue;
    points.push({ date: dateKey, value: valueFn(dateKey) });
  }

  const maxPoints = rangeKey === "all" ? 180 : 90;
  return downsample(points, maxPoints);
}

function downsample<T>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const sampled: T[] = [];
  for (let i = 0; i < points.length; i += step) {
    sampled.push(points[i]);
  }
  return sampled;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function colorForIndex(idx: number): string {
  const palette = [
    "#2a9d8f",
    "#e76f51",
    "#457b9d",
    "#f4a261",
    "#264653",
    "#e9c46a",
    "#8d99ae",
    "#ef476f"
  ];
  return palette[idx % palette.length];
}

function aggregateLogs(
  logs: { score: number }[],
  aggregation: "sum" | "average" | "worst"
): number {
  if (!logs.length) return 0;
  if (aggregation === "average") {
    return logs.reduce((acc, entry) => acc + entry.score, 0) / logs.length;
  }
  if (aggregation === "worst") {
    return Math.min(...logs.map((e) => e.score));
  }
  return logs.reduce((acc, entry) => acc + entry.score, 0);
}

function getSmoothingWindow(rangeKey: RangeKey): number {
  switch (rangeKey) {
    case "7d":
      return 2;
    case "30d":
      return 3;
    case "90d":
      return 5;
    case "365d":
      return 7;
    case "all":
      return 10;
    default:
      return 3;
  }
}

function applyMovingAverage(values: number[], window: number): number[] {
  if (window <= 1) return values;
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = values.slice(start, i + 1);
    const avg = slice.reduce((acc, v) => acc + v, 0) / slice.length;
    result.push(Number(avg.toFixed(3)));
  }
  return result;
}
