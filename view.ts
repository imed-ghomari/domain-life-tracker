import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { Chart } from "chart.js/auto";
import LifeDomainTrackerPlugin, { getDateKeyFromTs, getTodayKey } from "./main";

export const VIEW_TYPE_DOMAIN_PERFORMANCE = "life-domain-performance";
export const VIEW_TYPE_LOG_TIMELINE = "life-domain-log-timeline";

type RangeKey = "7d" | "30d" | "90d" | "365d" | "all";
type ViewKey = "domain" | "states" | "all-domains" | "calendar-heatmap" | "state-heatmap";
type AggregationKey = "default" | "sum" | "average" | "worst";

export class DomainPerformanceView extends ItemView {
  plugin: LifeDomainTrackerPlugin;
  chart: Chart | null = null;
  domainId: string | null = null;
  rangeKey: RangeKey = "30d";
  viewKey: ViewKey = "domain";
  smoothingEnabled = false;
  aggregationOverride: AggregationKey = "default";
  stateMetric: "count" | "score" = "count";
  domainSelectEl: HTMLSelectElement | null = null;
  rangeSelectEl: HTMLSelectElement | null = null;
  viewSelectEl: HTMLSelectElement | null = null;
  statePickerEl: HTMLElement | null = null;
  canvasEl: HTMLCanvasElement | null = null;
  customEl: HTMLElement | null = null;
  smoothingToggleEl: HTMLInputElement | null = null;
  aggregationSelectEl: HTMLSelectElement | null = null;
  stateMetricSelectEl: HTMLSelectElement | null = null;

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
    this.aggregationSelectEl = controls.createEl("select");
    this.stateMetricSelectEl = controls.createEl("select");
    const smoothingWrap = controls.createEl("label", { cls: "life-domain-smoothing" });
    this.smoothingToggleEl = smoothingWrap.createEl("input");
    this.smoothingToggleEl.type = "checkbox";
    smoothingWrap.createEl("span", { text: "Smoothing" });

    const views: { key: ViewKey; label: string }[] = [
      { key: "domain", label: "Domain score" },
      { key: "states", label: "State activity" },
      { key: "all-domains", label: "All domains" },
      { key: "calendar-heatmap", label: "Calendar heatmap" },
      { key: "state-heatmap", label: "State heatmap" }
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

    const aggs: { key: AggregationKey; label: string }[] = [
      { key: "default", label: "Use domain default" },
      { key: "sum", label: "Sum" },
      { key: "average", label: "Average" },
      { key: "worst", label: "Worst Case" }
    ];
    for (const agg of aggs) {
      this.aggregationSelectEl.createEl("option", { text: agg.label, value: agg.key });
    }

    const metrics: { key: "count" | "score"; label: string }[] = [
      { key: "count", label: "State count" },
      { key: "score", label: "State score" }
    ];
    for (const metric of metrics) {
      this.stateMetricSelectEl.createEl("option", { text: metric.label, value: metric.key });
    }

    this.statePickerEl = contentEl.createDiv({ cls: "life-domain-state-picker" });
    this.customEl = contentEl.createDiv({ cls: "life-domain-custom-view" });
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
    this.aggregationSelectEl.addEventListener("change", () => {
      this.aggregationOverride = (this.aggregationSelectEl?.value as AggregationKey) ?? "default";
      if (this.canvasEl) this.renderChart(this.canvasEl);
    });
    this.stateMetricSelectEl.addEventListener("change", () => {
      this.stateMetric = (this.stateMetricSelectEl?.value as "count" | "score") ?? "count";
      if (this.canvasEl) this.renderChart(this.canvasEl);
    });
    this.smoothingToggleEl.addEventListener("change", () => {
      this.smoothingEnabled = !!this.smoothingToggleEl?.checked;
      if (this.canvasEl) this.renderChart(this.canvasEl);
    });

    this.renderStatePicker();
    if (this.canvasEl) this.renderChart(this.canvasEl);
  }

  async onClose(): Promise<void> {
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
    if (this.aggregationSelectEl) {
      this.aggregationSelectEl.disabled = this.viewKey === "states";
    }
    if (this.stateMetricSelectEl) {
      this.stateMetricSelectEl.disabled = this.viewKey !== "states";
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
    if (this.customEl) this.customEl.empty();
    if (this.customEl) this.customEl.hide();
    canvas.style.display = "";

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

    const aggregateIndex = buildDomainAggregateIndex(this.plugin);

    if (this.viewKey === "calendar-heatmap") {
      this.renderCalendarHeatmap(domain.id);
      return;
    }
    if (this.viewKey === "state-heatmap") {
      this.renderStateHeatmap(domain.id);
      return;
    }

    if (this.viewKey === "domain") {
      const series = buildDomainSeries(
        this.plugin,
        this.domainId,
        this.rangeKey,
        this.aggregationOverride,
        aggregateIndex
      );
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
      const series = buildStateSeries(
        this.plugin,
        this.domainId,
        selectedStateIds,
        this.rangeKey,
        this.stateMetric
      );
      chartData = {
        labels: series.labels,
        datasets: series.datasets
      };
    } else {
      const series = buildAllDomainsSeries(
        this.plugin,
        this.rangeKey,
        this.aggregationOverride,
        aggregateIndex
      );
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
          x: { grid: { display: false }, border: { display: false } },
          y: { beginAtZero: true, grid: { display: false }, border: { display: false } }
        }
      }
    });
  }

  private renderCalendarHeatmap(domainId: string) {
    if (!this.customEl) return;
    this.customEl.style.display = "";
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
    if (this.canvasEl) this.canvasEl.style.display = "none";

    const domain = this.plugin.settings.domains.find((d) => d.id === domainId);
    if (!domain) return;

    const aggregateIndex = buildDomainAggregateIndex(this.plugin);
    const dates = buildDateRange(this.rangeKey, Object.keys(this.plugin.dataStore.logs));
    const values = dates.map((dateKey) => {
      const agg = this.aggregationOverride === "default" ? domain.aggregationType : this.aggregationOverride;
      return aggregateFromIndex(aggregateIndex, dateKey, domain.id, agg);
    });
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);

    const grid = this.customEl.createDiv({ cls: "life-domain-heatmap-grid" });
    for (let i = 0; i < dates.length; i++) {
      const cell = grid.createDiv({ cls: "life-domain-heatmap-cell" });
      const value = values[i];
      const intensity = normalizeValue(value, min, max);
      cell.style.backgroundColor = heatColor(value, intensity);
      cell.setAttr("title", `${dates[i]} • ${value.toFixed(2)}`);
      cell.setText(dates[i].slice(8));
    }
  }

  private renderStateHeatmap(domainId: string) {
    if (!this.customEl) return;
    this.customEl.style.display = "";
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
    if (this.canvasEl) this.canvasEl.style.display = "none";

    const domain = this.plugin.settings.domains.find((d) => d.id === domainId);
    if (!domain) return;

    const dates = buildDateRange(this.rangeKey, Object.keys(this.plugin.dataStore.logs));
    const stateIndex = buildStateMetricIndex(this.plugin, domain.id, this.stateMetric);

    const wrapper = this.customEl.createDiv({ cls: "life-domain-state-heatmap" });
    const header = wrapper.createDiv({ cls: "life-domain-state-heatmap-header" });
    header.createDiv({ text: "State" });
    const headerRow = header.createDiv({ cls: "life-domain-state-heatmap-row" });
    for (const dateKey of dates) {
      const cell = headerRow.createDiv({ cls: "life-domain-heatmap-cell header" });
      cell.setText(dateKey.slice(8));
    }

    for (const state of domain.states) {
      const row = wrapper.createDiv({ cls: "life-domain-state-heatmap-row" });
      row.createDiv({ text: state.name || "Unnamed", cls: "life-domain-state-label" });
      const values = dates.map((d) => stateIndex.get(d)?.get(state.id) ?? 0);
      const min = Math.min(...values, 0);
      const max = Math.max(...values, 0);
      for (let i = 0; i < dates.length; i++) {
        const cell = row.createDiv({ cls: "life-domain-heatmap-cell" });
        const value = values[i];
        const intensity = normalizeValue(value, min, max);
        cell.style.backgroundColor = heatColor(value, intensity);
        cell.setAttr("title", `${dates[i]} • ${value.toFixed(2)}`);
        cell.setText(value ? String(value) : "");
      }
    }
  }
}

export class LogTimelineView extends ItemView {
  plugin: LifeDomainTrackerPlugin;
  timelineEl: HTMLElement | null = null;
  statesEl: HTMLElement | null = null;
  noteInputEl: HTMLTextAreaElement | null = null;
  timeDisplayEl: HTMLElement | null = null;
  selectedTimeTs: number | null = null;
  selectedDateKey: string = getTodayKey();
  dateInputEl: HTMLInputElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: LifeDomainTrackerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_LOG_TIMELINE;
  }

  getDisplayText(): string {
    return "Life Domain Log";
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("life-domain-modal");

    contentEl.createEl("h3", { text: "Log Domain State" });

    const layout = contentEl.createDiv({ cls: "life-domain-log-layout" });
    const timelinePanel = layout.createDiv({ cls: "life-domain-log-timeline" });
    const statesPanel = layout.createDiv({ cls: "life-domain-log-states" });

    const timelineHeader = timelinePanel.createDiv({ cls: "life-domain-timeline-header" });
    timelineHeader.createEl("h4", { text: "Timeline" });
    this.dateInputEl = timelineHeader.createEl("input");
    this.dateInputEl.type = "date";
    this.dateInputEl.value = this.selectedDateKey;
    this.dateInputEl.addEventListener("change", () => {
      this.selectedDateKey = this.dateInputEl?.value || getTodayKey();
      this.selectedTimeTs = null;
      this.updateTimeDisplay();
      this.renderTimeline();
    });
    this.timelineEl = timelinePanel.createDiv({ cls: "life-domain-timeline-list" });

    const noteWrap = statesPanel.createDiv({ cls: "life-domain-note" });
    noteWrap.createEl("label", { text: "Contextual note (optional)" });
    this.noteInputEl = noteWrap.createEl("textarea");
    this.noteInputEl.setAttr("rows", "2");
    this.noteInputEl.setAttr("placeholder", "Add a short note for this log...");

    const timeRow = statesPanel.createDiv({ cls: "life-domain-log-time" });
    timeRow.createEl("label", { text: "Log time" });
    this.timeDisplayEl = timeRow.createDiv({ cls: "life-domain-log-time-value" });
    const resetBtn = timeRow.createEl("button", { text: "Use current time" });
    resetBtn.addEventListener("click", () => {
      this.selectedTimeTs = null;
      this.updateTimeDisplay();
      this.renderTimeline();
    });

    statesPanel.createEl("h4", { text: "States" });
    this.statesEl = statesPanel.createDiv({ cls: "life-domain-list" });

    this.renderStates();
    this.renderTimeline();
    this.updateTimeDisplay();
  }

  async onClose(): Promise<void> {
    // nothing to cleanup
  }

  private renderStates() {
    if (!this.statesEl) return;
    this.statesEl.empty();
    const domains = this.plugin.settings.domains;
    if (!domains.length) {
      this.statesEl.createEl("p", { text: "No domains configured. Add domains in settings." });
      return;
    }

    for (const domain of domains) {
      const domainBlock = this.statesEl.createDiv({ cls: "life-domain-group" });
      domainBlock.createEl("div", { text: domain.name || "Unnamed domain", cls: "life-domain-group-title" });

      for (const state of domain.states) {
        const row = domainBlock.createDiv({ cls: "life-domain-state-row" });
        const meta = row.createDiv({ cls: "life-domain-state-meta" });
        meta.createEl("div", { text: state.name || "Unnamed state" });
        const badges = meta.createDiv({ cls: "life-domain-badges" });
        const kindBadge = badges.createEl("span", { cls: "life-domain-badge" });
        kindBadge.textContent = state.score > 0 ? "GOOD" : state.score < 0 ? "BAD" : "NEUTRAL";
        badges.createEl("span", { text: `Score ${state.score}`, cls: "life-domain-badge" });

        const actions = row.createDiv({ cls: "life-domain-state-actions" });
        const btn = actions.createEl("button", { text: "Log" });
        btn.addEventListener("click", () => {
          const note = this.noteInputEl?.value ?? "";
          const logTs = this.getSelectedLogTs();
          this.plugin.addLog(domain.id, state.id, note, logTs);
          if (this.noteInputEl) this.noteInputEl.value = "";
          this.renderTimeline();
        });

        if (state.score > 0) row.classList.add("life-domain-good");
        if (state.score < 0) row.classList.add("life-domain-bad");
      }
    }
  }

  private renderTimeline() {
    if (!this.timelineEl) return;
    this.timelineEl.empty();

    const dateKey = this.selectedDateKey;
    const dayLogs = this.plugin.dataStore.logs[dateKey] ?? {};

    const entries: {
      ts: number;
      domainName: string;
      stateName: string;
      score: number;
      note?: string;
    }[] = [];

    for (const domain of this.plugin.settings.domains) {
      const logs = dayLogs[domain.id] ?? [];
      for (const entry of logs) {
        const state = domain.states.find((s) => s.id === entry.stateId);
        entries.push({
          ts: entry.ts,
          domainName: domain.name || "Unnamed domain",
          stateName: state?.name || "Unknown state",
          score: entry.score,
          note: entry.note
        });
      }
    }

    entries.sort((a, b) => a.ts - b.ts);

    const byHour = new Map<number, typeof entries>();
    for (const entry of entries) {
      const hour = new Date(entry.ts).getHours();
      if (!byHour.has(hour)) byHour.set(hour, []);
      byHour.get(hour)!.push(entry);
    }

    for (let hour = 0; hour < 24; hour++) {
      const hourBlock = this.timelineEl.createDiv({ cls: "life-domain-timeline-hour-block" });
      if (this.selectedTimeTs) {
        const selHour = new Date(this.selectedTimeTs).getHours();
        if (selHour === hour) hourBlock.addClass("is-selected");
      }
      hourBlock.addEventListener("click", () => {
        const selected = dateFromKey(this.selectedDateKey);
        selected.setHours(hour, 0, 0, 0);
        this.selectedTimeTs = selected.getTime();
        this.updateTimeDisplay();
        this.renderTimeline();
      });

        const hourLabel = hourBlock.createDiv({ cls: "life-domain-timeline-hour" });
        hourLabel.setText(formatHourLabel(hour));

      const hourItems = hourBlock.createDiv({ cls: "life-domain-timeline-items" });
      const hourEntries = byHour.get(hour) ?? [];
      if (!hourEntries.length) {
        hourItems.createEl("div", { text: "—", cls: "life-domain-timeline-empty" });
        continue;
      }

      for (const entry of hourEntries) {
        const time = new Date(entry.ts);
        const item = hourItems.createDiv({ cls: "life-domain-timeline-item" });
        item.addEventListener("click", (evt) => {
          evt.stopPropagation();
          this.selectedTimeTs = entry.ts;
          this.updateTimeDisplay();
          this.renderTimeline();
        });
        const timeLabel = item.createDiv({ cls: "life-domain-timeline-time" });
        timeLabel.setText(formatTimeLabel(time));

        const body = item.createDiv({ cls: "life-domain-timeline-body" });
        body.createEl("div", { text: `${entry.domainName} • ${entry.stateName}` });
        body.createEl("div", { text: `Score ${entry.score}`, cls: "life-domain-timeline-score" });
        if (entry.note) {
          body.createEl("div", { text: entry.note, cls: "life-domain-timeline-note" });
        }
      }
    }
  }

  private updateTimeDisplay() {
    if (!this.timeDisplayEl) return;
    if (!this.selectedTimeTs) {
      const dateLabel = this.selectedDateKey === getTodayKey() ? "Today" : this.selectedDateKey;
      this.timeDisplayEl.setText(`${dateLabel} • Current time`);
      return;
    }
    const t = new Date(this.selectedTimeTs);
    this.selectedDateKey = getDateKeyFromTs(this.selectedTimeTs);
    if (this.dateInputEl) this.dateInputEl.value = this.selectedDateKey;
    this.timeDisplayEl.setText(`${this.selectedDateKey} • ${formatTimeLabel(t)}`);
  }

  private getSelectedLogTs(): number {
    if (this.selectedTimeTs) return this.selectedTimeTs;
    const now = new Date();
    if (this.selectedDateKey === getTodayKey()) return now.getTime();
    const [y, m, d] = this.selectedDateKey.split("-").map((v) => Number(v));
    const ts = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), 0, 0);
    return ts.getTime();
  }
}

function formatHourLabel(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display} ${period}`;
}

function formatTimeLabel(date: Date): string {
  const hour = date.getHours();
  const minute = date.getMinutes().toString().padStart(2, "0");
  const period = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minute} ${period}`;
}

function dateFromKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map((v) => Number(v));
  return new Date(y, m - 1, d);
}

function getSelectedStateIds(container: HTMLElement | null): string[] {
  if (!container) return [];
  const inputs = Array.from(container.querySelectorAll<HTMLInputElement>("input[type='checkbox']"));
  return inputs.filter((i) => i.checked && i.dataset.stateId).map((i) => i.dataset.stateId!);
}

function buildDomainSeries(
  plugin: LifeDomainTrackerPlugin,
  domainId: string,
  rangeKey: RangeKey,
  aggregationOverride: AggregationKey,
  aggregateIndex: DomainAggregateIndex
): { labels: string[]; values: number[] } {
  const domain = plugin.settings.domains.find((d) => d.id === domainId);
  if (!domain) return { labels: [], values: [] };
  const points = buildPoints(plugin, rangeKey, (dateKey) => {
    const agg = aggregationOverride === "default" ? domain.aggregationType : aggregationOverride;
    return aggregateFromIndex(aggregateIndex, dateKey, domainId, agg);
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
  rangeKey: RangeKey,
  metric: "count" | "score"
): { labels: string[]; datasets: { label: string; data: number[]; borderColor: string; backgroundColor: string; spanGaps: boolean }[] } {
  const domain = plugin.settings.domains.find((d) => d.id === domainId);
  if (!domain) return { labels: [], datasets: [] };

  const states = domain.states.filter((s) => stateIds.includes(s.id));
  if (!states.length) return { labels: [], datasets: [] };

  const stateIndex = buildStateMetricIndex(plugin, domainId, metric);
  const points = buildPoints(plugin, rangeKey, (dateKey) => {
    return stateIndex.get(dateKey) ?? new Map<string, number>();
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
  rangeKey: RangeKey,
  aggregationOverride: AggregationKey,
  aggregateIndex: DomainAggregateIndex
): { labels: string[]; datasets: { label: string; data: number[]; borderColor: string; backgroundColor: string; spanGaps: boolean }[] } {
  const domains = plugin.settings.domains;
  const points = buildPoints(plugin, rangeKey, (dateKey) => {
    const perDomain: Record<string, number> = {};
    for (const domain of domains) {
      const agg = aggregationOverride === "default" ? domain.aggregationType : aggregationOverride;
      perDomain[domain.id] = aggregateFromIndex(aggregateIndex, dateKey, domain.id, agg);
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

function buildDateRange(rangeKey: RangeKey, availableDates: string[]): string[] {
  const todayKey = getTodayKey();
  const sorted = availableDates.sort();
  if (rangeKey === "all") return sorted.length ? sorted : [todayKey];

  const days = parseInt(rangeKey.replace("d", ""), 10);
  const end = new Date();
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    dates.push(getDateKeyFromTs(d.getTime()));
  }
  return dates;
}

function normalizeValue(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return (value - min) / (max - min);
}

function heatColor(value: number, intensity: number): string {
  const base = value >= 0 ? [42, 157, 143] : [231, 111, 81];
  const alpha = 0.15 + intensity * 0.65;
  return `rgba(${base[0]}, ${base[1]}, ${base[2]}, ${alpha})`;
}

function buildStateMetricIndex(
  plugin: LifeDomainTrackerPlugin,
  domainId: string,
  metric: "count" | "score"
): Map<string, Map<string, number>> {
  const index = new Map<string, Map<string, number>>();
  for (const [dateKey, domains] of Object.entries(plugin.dataStore.logs)) {
    const logs = domains[domainId];
    if (!logs) continue;
    const map = new Map<string, number>();
    for (const log of logs) {
      const inc = metric === "score" ? log.score : 1;
      map.set(log.stateId, (map.get(log.stateId) ?? 0) + inc);
    }
    index.set(dateKey, map);
  }
  return index;
}

type DomainAggregate = { sum: number; count: number; worst: number };
type DomainAggregateIndex = Map<string, Map<string, DomainAggregate>>;

function buildDomainAggregateIndex(plugin: LifeDomainTrackerPlugin): DomainAggregateIndex {
  const index: DomainAggregateIndex = new Map();
  for (const [dateKey, domains] of Object.entries(plugin.dataStore.logs)) {
    for (const [domainId, logs] of Object.entries(domains)) {
      let entry = index.get(dateKey);
      if (!entry) {
        entry = new Map();
        index.set(dateKey, entry);
      }
      const sum = logs.reduce((acc, l) => acc + l.score, 0);
      const count = logs.length;
      const worst = logs.reduce((acc, l) => Math.min(acc, l.score), logs[0]?.score ?? 0);
      entry.set(domainId, { sum, count, worst });
    }
  }
  return index;
}

function aggregateFromIndex(
  index: DomainAggregateIndex,
  dateKey: string,
  domainId: string,
  aggregation: "sum" | "average" | "worst"
): number {
  const domainMap = index.get(dateKey);
  const agg = domainMap?.get(domainId);
  if (!agg) return 0;
  if (aggregation === "average") {
    return agg.count ? agg.sum / agg.count : 0;
  }
  if (aggregation === "worst") {
    return agg.worst;
  }
  return agg.sum;
}
