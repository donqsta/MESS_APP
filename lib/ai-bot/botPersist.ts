/**
 * Persist bot enabled state ra file data/bot-enabled.json
 * để sống qua server restart — không mất cấu hình bật/tắt bot của từng conversation.
 */

import * as fs from "fs";
import * as path from "path";

const STATE_FILE = path.join(process.cwd(), "data", "bot-enabled.json");

// ── Đọc / ghi file ────────────────────────────────────────────────────────────

function readFile(): Record<string, boolean> {
  try {
    if (!fs.existsSync(STATE_FILE)) return {};
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeFile(state: Record<string, boolean>): void {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (e) {
    console.error("[BotPersist] Lỗi ghi file:", e);
  }
}

// ── Singleton: load vào Map một lần ──────────────────────────────────────────

const proc = process as NodeJS.Process & {
  _botPersistLoaded?: boolean;
};

/**
 * Gọi khi app khởi động (trong setBotEnabled / isBotEnabled lần đầu).
 * Nạp trạng thái từ file vào enabledState Map.
 */
export function loadPersistedState(enabledState: Map<string, boolean>): void {
  if (proc._botPersistLoaded) return;
  proc._botPersistLoaded = true;

  const saved = readFile();
  let count = 0;
  for (const [convId, enabled] of Object.entries(saved)) {
    enabledState.set(convId, enabled);
    count++;
  }
  if (count > 0) {
    console.log(`[BotPersist] Restored ${count} conversation state(s) from file`);
  }
}

/**
 * Gọi mỗi khi trạng thái thay đổi — ghi ra file.
 */
export function persistState(enabledState: Map<string, boolean>): void {
  const obj: Record<string, boolean> = {};
  for (const [k, v] of enabledState.entries()) {
    obj[k] = v;
  }
  writeFile(obj);
}

/**
 * Xóa toàn bộ state đã lưu (dùng khi reset).
 */
export function clearPersistedState(): void {
  try {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    proc._botPersistLoaded = false;
  } catch (e) {
    console.error("[BotPersist] Lỗi xóa file:", e);
  }
}
