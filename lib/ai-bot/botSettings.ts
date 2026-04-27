/**
 * Global bot settings — persist ra data/bot-settings.json
 */

import * as fs from "fs";
import * as path from "path";

const SETTINGS_FILE = path.join(process.cwd(), "data", "bot-settings.json");

export interface BotGlobalSettings {
  defaultEnabled: boolean;  // Bật bot mặc định cho tất cả hội thoại mới
}

const DEFAULT_SETTINGS: BotGlobalSettings = {
  defaultEnabled: true,
};

// ── Singleton trên process object ─────────────────────────────────────────────

const proc = process as NodeJS.Process & {
  _botGlobalSettings?: BotGlobalSettings;
};

function loadFromFile(): BotGlobalSettings {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return { ...DEFAULT_SETTINGS };
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as BotGlobalSettings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeToFile(settings: BotGlobalSettings): void {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch (e) {
    console.error("[BotSettings] Lỗi ghi file:", e);
  }
}

function getSettings(): BotGlobalSettings {
  if (!proc._botGlobalSettings) {
    proc._botGlobalSettings = loadFromFile();
  }
  return proc._botGlobalSettings;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function getBotGlobalSettings(): BotGlobalSettings {
  return { ...getSettings() };
}

export function updateBotGlobalSettings(updates: Partial<BotGlobalSettings>): BotGlobalSettings {
  const current = getSettings();
  const updated = { ...current, ...updates };
  proc._botGlobalSettings = updated;
  writeToFile(updated);
  console.log("[BotSettings] Updated:", updated);
  return { ...updated };
}

/** Shortcut: lấy giá trị mặc định bật/tắt bot */
export function getDefaultBotEnabled(): boolean {
  return getSettings().defaultEnabled;
}
