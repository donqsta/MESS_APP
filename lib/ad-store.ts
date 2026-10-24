import * as fs from "fs";
import * as path from "path";
import { AdReferral } from "./webhook-store";

export interface AdLead {
  senderId: string;
  pageId: string;
  referral: AdReferral;
  firstMessageText: string;
  timestamp: number;
}

const MAX = 500;

// Lưu ra file để danh sách "Khách vừa nhắn" không mất khi restart server
const STORE_PATH = path.join(process.cwd(), "data", "ad-leads.json");

function loadFromDisk(): AdLead[] {
  try {
    if (!fs.existsSync(STORE_PATH)) return [];
    const data = JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
    return Array.isArray(data) ? (data as AdLead[]).slice(0, MAX) : [];
  } catch (err) {
    console.warn("[AdStore] Lỗi đọc ad-leads.json:", err instanceof Error ? err.message : err);
    return [];
  }
}

const proc = process as NodeJS.Process & {
  _adLeads?: AdLead[];
  _adSenderMap?: Map<string, AdLead>;
  _adSaveTimer?: NodeJS.Timeout;
};
if (!proc._adLeads) {
  proc._adLeads = loadFromDisk();
  proc._adSenderMap = new Map(proc._adLeads.map((l) => [l.senderId, l]));
}
if (!proc._adSenderMap) proc._adSenderMap = new Map();

const leads = proc._adLeads;
const senderMap = proc._adSenderMap;

// Gom nhiều lần ghi liên tiếp (webhook cập nhật post_text ngay sau khi record) thành 1 lần
function scheduleSave() {
  if (proc._adSaveTimer) clearTimeout(proc._adSaveTimer);
  proc._adSaveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
      fs.writeFileSync(STORE_PATH, JSON.stringify(leads), "utf-8");
    } catch (err) {
      console.warn("[AdStore] Lỗi ghi ad-leads.json:", err instanceof Error ? err.message : err);
    }
  }, 1000);
}

export function recordAdLead(lead: AdLead) {
  senderMap.set(lead.senderId, lead);
  const idx = leads.findIndex((l) => l.senderId === lead.senderId);
  if (idx >= 0) leads.splice(idx, 1);
  leads.unshift(lead);
  if (leads.length > MAX) {
    const removed = leads.pop();
    if (removed && senderMap.get(removed.senderId) === removed) senderMap.delete(removed.senderId);
  }
  scheduleSave();
}

export function getAdLeads(pageId?: string): AdLead[] {
  if (pageId) return leads.filter((l) => l.pageId === pageId);
  return leads;
}

export function getAdLeadBySender(senderId: string): AdLead | undefined {
  return senderMap.get(senderId);
}
