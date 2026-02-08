import { Modal, Notice } from "obsidian";
import LifeDomainTrackerPlugin, { LifeDomain, LifeDomainState, getTodayKey } from "./main";

export class LogDomainModal extends Modal {
  plugin: LifeDomainTrackerPlugin;
  domain: LifeDomain | null = null;
  domainSelectEl: HTMLSelectElement | null = null;
  summaryEl: HTMLElement | null = null;
  listEl: HTMLElement | null = null;
  noteInputEl: HTMLTextAreaElement | null = null;

  constructor(app: LifeDomainTrackerPlugin["app"], plugin: LifeDomainTrackerPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("life-domain-modal");

    contentEl.createEl("h3", { text: "Log Domain State" });

    const domains = this.plugin.settings.domains;
    if (!domains.length) {
      contentEl.createEl("p", { text: "No domains configured. Add domains in settings." });
      return;
    }

    const controls = contentEl.createDiv({ cls: "life-domain-controls" });
    controls.createEl("label", { text: "Domain" });
    this.domainSelectEl = controls.createEl("select");
    for (const domain of domains) {
      this.domainSelectEl.createEl("option", { text: domain.name, value: domain.id });
    }

    this.summaryEl = contentEl.createDiv({ cls: "life-domain-summary" });
    const noteWrap = contentEl.createDiv({ cls: "life-domain-note" });
    noteWrap.createEl("label", { text: "Contextual note (optional)" });
    this.noteInputEl = noteWrap.createEl("textarea");
    this.noteInputEl.setAttr("rows", "2");
    this.noteInputEl.setAttr("placeholder", "Add a short note for this log...");
    this.listEl = contentEl.createDiv({ cls: "life-domain-list" });

    this.domainSelectEl.addEventListener("change", () => {
      const id = this.domainSelectEl?.value ?? "";
      this.domain = domains.find((d) => d.id === id) ?? null;
      this.renderDomain();
    });

    this.domain = domains[0];
    this.renderDomain();
  }

  private renderDomain() {
    if (!this.domain || !this.summaryEl || !this.listEl) return;
    const dateKey = getTodayKey();
    const logs = this.plugin.getLogsForDate(dateKey, this.domain.id);
    const counts = countByState(logs);

    this.summaryEl.empty();
    const total = logs.length;
    const loggedStates = this.domain.states.filter((s) => counts.get(s.id));
    const missingStates = this.domain.states.filter((s) => !counts.get(s.id));

    const header = this.summaryEl.createDiv({ cls: "life-domain-summary-row" });
    header.createEl("div", { text: `Today: ${dateKey}` });
    header.createEl("div", { text: `Logs: ${total}` });
    header.createEl("div", { text: `Logged: ${loggedStates.length} / ${this.domain.states.length}` });

    const chips = this.summaryEl.createDiv({ cls: "life-domain-chips" });
    if (missingStates.length) {
      for (const state of missingStates) {
        const chip = chips.createEl("span", {
          text: state.name || "Unnamed",
          cls: "life-domain-chip life-domain-chip-missing"
        });
        chip.setAttr("title", "Missing today");
      }
    } else {
      chips.createEl("span", { text: "All states logged today", cls: "life-domain-chip" });
    }

    this.listEl.empty();
    for (const state of this.domain.states) {
      this.listEl.appendChild(this.renderStateRow(state, counts.get(state.id) ?? 0));
    }
  }

  private renderStateRow(state: LifeDomainState, count: number): HTMLElement {
    const row = document.createElement("div");
    row.classList.add("life-domain-state-row");

    const meta = document.createElement("div");
    meta.classList.add("life-domain-state-meta");

    const title = document.createElement("div");
    title.textContent = state.name || "Unnamed state";
    meta.appendChild(title);

    const badges = document.createElement("div");
    badges.classList.add("life-domain-badges");
    const kindBadge = document.createElement("span");
    kindBadge.classList.add("life-domain-badge");
    kindBadge.textContent = state.score > 0 ? "GOOD" : state.score < 0 ? "BAD" : "NEUTRAL";
    badges.appendChild(kindBadge);
    const scoreBadge = document.createElement("span");
    scoreBadge.classList.add("life-domain-badge");
    scoreBadge.textContent = `Score ${state.score}`;
    badges.appendChild(scoreBadge);
    const countBadge = document.createElement("span");
    countBadge.classList.add("life-domain-badge");
    countBadge.textContent = `Logged ${count}`;
    badges.appendChild(countBadge);
    meta.appendChild(badges);

    const actions = document.createElement("div");
    actions.classList.add("life-domain-state-actions");

    const btn = document.createElement("button");
    btn.textContent = "Log";
    btn.addEventListener("click", () => {
      const note = this.noteInputEl?.value ?? "";
      this.plugin.addLog(this.domain?.id ?? "", state.id, note);
      new Notice(`Logged ${this.domain?.name}: ${state.name}`);
      if (this.noteInputEl) this.noteInputEl.value = "";
      this.renderDomain();
    });
    actions.appendChild(btn);

    row.appendChild(meta);
    row.appendChild(actions);

    if (state.score > 0) row.classList.add("life-domain-good");
    if (state.score < 0) row.classList.add("life-domain-bad");

    return row;
  }
}

function countByState(logs: { stateId: string }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of logs) {
    map.set(entry.stateId, (map.get(entry.stateId) ?? 0) + 1);
  }
  return map;
}

export class DeleteLogsModal extends Modal {
  plugin: LifeDomainTrackerPlugin;
  dateSelectEl: HTMLSelectElement | null = null;
  domainSelectEl: HTMLSelectElement | null = null;
  stateSelectEl: HTMLSelectElement | null = null;
  listEl: HTMLElement | null = null;

  constructor(app: LifeDomainTrackerPlugin["app"], plugin: LifeDomainTrackerPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("life-domain-modal");
    contentEl.createEl("h3", { text: "Delete Domain Logs" });

    const dates = Object.keys(this.plugin.dataStore.logs).sort().reverse();
    if (!dates.length) {
      contentEl.createEl("p", { text: "No logs available." });
      return;
    }

    const controls = contentEl.createDiv({ cls: "life-domain-controls" });
    controls.createEl("label", { text: "Date" });
    this.dateSelectEl = controls.createEl("select");
    for (const date of dates) {
      this.dateSelectEl.createEl("option", { text: date, value: date });
    }

    controls.createEl("label", { text: "Domain" });
    this.domainSelectEl = controls.createEl("select");
    for (const domain of this.plugin.settings.domains) {
      this.domainSelectEl.createEl("option", { text: domain.name, value: domain.id });
    }

    controls.createEl("label", { text: "State" });
    this.stateSelectEl = controls.createEl("select");

    const actions = contentEl.createDiv({ cls: "life-domain-controls" });
    const deleteFilteredBtn = actions.createEl("button", { text: "Delete Filtered Logs" });
    deleteFilteredBtn.addEventListener("click", async () => {
      const dateKey = this.dateSelectEl?.value ?? "";
      const domainId = this.domainSelectEl?.value ?? "";
      const stateId = this.stateSelectEl?.value || undefined;
      await this.plugin.deleteLogs(dateKey, domainId, stateId);
      this.renderList();
    });

    const deleteDomainBtn = actions.createEl("button", { text: "Delete All For Domain" });
    deleteDomainBtn.addEventListener("click", async () => {
      const dateKey = this.dateSelectEl?.value ?? "";
      const domainId = this.domainSelectEl?.value ?? "";
      await this.plugin.deleteLogs(dateKey, domainId);
      this.renderList();
    });

    const deleteDayBtn = actions.createEl("button", { text: "Delete All For Day" });
    deleteDayBtn.addEventListener("click", async () => {
      const dateKey = this.dateSelectEl?.value ?? "";
      await this.plugin.deleteAllForDate(dateKey);
      this.onOpen();
    });

    this.listEl = contentEl.createDiv({ cls: "life-domain-list" });

    this.dateSelectEl.addEventListener("change", () => this.renderList());
    this.domainSelectEl.addEventListener("change", () => this.renderList());
    this.stateSelectEl.addEventListener("change", () => this.renderList());

    this.renderList();
  }

  private renderList() {
    if (!this.listEl || !this.dateSelectEl || !this.domainSelectEl || !this.stateSelectEl) return;
    const dateKey = this.dateSelectEl.value;
    const domainId = this.domainSelectEl.value;
    const domain = this.plugin.settings.domains.find((d) => d.id === domainId);
    if (!domain) return;

    const logs = this.plugin.dataStore.logs[dateKey]?.[domainId] ?? [];
    this.stateSelectEl.empty();
    this.stateSelectEl.createEl("option", { text: "All states", value: "" });
    for (const state of domain.states) {
      this.stateSelectEl.createEl("option", { text: state.name || "Unnamed", value: state.id });
    }

    const filterStateId = this.stateSelectEl.value || undefined;

    this.listEl.empty();
    if (!logs.length) {
      this.listEl.createEl("p", { text: "No logs for the selected date/domain." });
      return;
    }

    logs.forEach((entry, index) => {
      if (filterStateId && entry.stateId !== filterStateId) return;
      const state = domain.states.find((s) => s.id === entry.stateId);
      const row = this.listEl!.createDiv({ cls: "life-domain-state-row" });
      const meta = row.createDiv({ cls: "life-domain-state-meta" });
      const time = new Date(entry.ts);
      meta.createEl("div", { text: `${state?.name ?? "Unknown"} • ${time.toLocaleTimeString()}` });
      const badges = meta.createDiv({ cls: "life-domain-badges" });
      badges.createEl("span", { text: `Score ${entry.score}`, cls: "life-domain-badge" });
      if (entry.note) badges.createEl("span", { text: entry.note, cls: "life-domain-badge" });

      const actions = row.createDiv({ cls: "life-domain-state-actions" });
      const delBtn = actions.createEl("button", { text: "Delete" });
      delBtn.addEventListener("click", async () => {
        await this.plugin.deleteLogs(dateKey, domainId, undefined, index);
        this.renderList();
      });
    });
  }
}
