import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import LifeDomainTrackerPlugin, { LifeDomain, LifeDomainState } from "./main";

export class LifeDomainSettingsTab extends PluginSettingTab {
  plugin: LifeDomainTrackerPlugin;

  constructor(app: App, plugin: LifeDomainTrackerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("life-domain-settings");

    const header = containerEl.createDiv({ cls: "life-domain-settings-header" });
    header.createEl("h3", { text: "Domains" });
    const addDomainBtn = header.createEl("button", { text: "Add Domain", cls: "mod-cta" });
    addDomainBtn.addEventListener("click", async () => {
      this.plugin.settings.domains.push(createDomain());
      await this.plugin.saveSettings();
      this.display();
    });

    new Setting(containerEl)
      .setName("Log UI Mode")
      .setDesc("Choose between the classic modal or the timeline tab.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ modal: "Modal", tab: "Timeline Tab" })
          .setValue(this.plugin.settings.logUiMode ?? "modal")
          .onChange(async (value) => {
            this.plugin.settings.logUiMode = value as "modal" | "tab";
            await this.plugin.saveSettings();
          })
      );

    this.plugin.settings.domains.forEach((domain, domainIndex) => {
      const domainContainer = containerEl.createDiv({ cls: "life-domain-block" });
      const domainCard = domainContainer.createDiv({ cls: "life-domain-card" });
      const domainHeader = domainCard.createDiv({ cls: "life-domain-card-header" });

      new Setting(domainHeader)
        .setName(`Domain ${domainIndex + 1}`)
        .addText((text) =>
          text
            .setPlaceholder("Domain Name")
            .setValue(domain.name)
            .onChange(async (value) => {
              domain.name = value;
              await this.plugin.saveSettings();
            })
        )
        .addDropdown((dropdown) =>
          dropdown
            .addOptions({ sum: "Sum", average: "Average", worst: "Worst Case" })
            .setValue(domain.aggregationType ?? "sum")
            .onChange(async (value) => {
              domain.aggregationType = value as "sum" | "average" | "worst";
              await this.plugin.saveSettings();
            })
        )
        .addExtraButton((btn) =>
          btn
            .setIcon("download")
            .setTooltip("Export CSV")
            .onClick(async () => {
              const path = await this.plugin.exportDomainCsv(domain.id);
              if (path) new Notice(`Exported CSV to ${path}`);
            })
        )
        .addExtraButton((btn) =>
          btn
            .setIcon("trash-2")
            .setTooltip("Delete Domain")
            .onClick(async () => {
              this.plugin.settings.domains.splice(domainIndex, 1);
              await this.plugin.saveSettings();
              this.display();
            })
        );

      const statesHeader = domainCard.createDiv({ cls: "life-domain-states-header" });
      statesHeader.createEl("h4", { text: "States" });
      const addStateBtn = statesHeader.createEl("button", { text: "Add State" });
      addStateBtn.addEventListener("click", async () => {
        domain.states.push(createState());
        await this.plugin.saveSettings();
        this.display();
      });

      const statesBody = domainCard.createDiv({ cls: "life-domain-states-body" });
      domain.states.forEach((state, stateIndex) => {
        const stateContainer = statesBody.createDiv({ cls: "life-domain-state" });

        new Setting(stateContainer)
          .setName(`State ${stateIndex + 1}`)
          .addText((text) => {
            text
              .setPlaceholder("State name")
              .setValue(state.name)
              .onChange(async (value) => {
                state.name = value;
                await this.plugin.saveSettings();
              });
            text.inputEl.addClass("life-domain-state-name-input");
          })
          .addSlider((slider) =>
            slider
              .setLimits(-2, 2, 1)
              .setValue(state.score ?? 0)
              .setDynamicTooltip()
              .onChange(async (value) => {
                state.score = value;
                await this.plugin.saveSettings();
              })
          )
          .addExtraButton((btn) =>
            btn
              .setIcon("trash-2")
              .setTooltip("Delete State")
              .onClick(async () => {
                domain.states.splice(stateIndex, 1);
                await this.plugin.saveSettings();
                this.display();
              })
          );
      });

    });
  }
}

function createDomain(): LifeDomain {
  return {
    id: generateId(),
    name: "",
    states: [],
    aggregationType: "sum"
  };
}

function createState(): LifeDomainState {
  return {
    id: generateId(),
    name: "",
    score: 0
  };
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
