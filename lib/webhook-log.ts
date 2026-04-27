export interface WebhookLog {
  id: string;
  timestamp: number;
  method: string;
  query: string;
  body: unknown;
}

const MAX_LOGS = 50;

// process là singleton thực sự — dùng để lưu log qua hot-reload
const proc = process as NodeJS.Process & { _webhookLogs?: WebhookLog[] };
if (!proc._webhookLogs) proc._webhookLogs = [];
const logs = proc._webhookLogs;

export function addLog(entry: Omit<WebhookLog, "id">) {
  logs.unshift({ id: Date.now().toString(), ...entry });
  if (logs.length > MAX_LOGS) logs.pop();
}

export function getLogs(): WebhookLog[] {
  return logs;
}

export function clearLogs(): void {
  logs.splice(0, logs.length);
}
