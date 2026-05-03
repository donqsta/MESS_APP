/**
 * zalo-employee-registry.ts
 *
 * Lưu trữ mapping: phone → zaloId cho nhân viên.
 * Nhân viên đăng ký bằng cách nhắn tin vào Zalo Bot:
 *   Bất kỳ tin nhắn nào từ người CHƯA có trong registry → hỏi SĐT
 *   Nhân viên trả lời SĐT → lưu mapping phone→zaloId
 *
 * File: data/zalo-employee-registry.json
 */

import fs from "fs";
import path from "path";

const REGISTRY_FILE = path.join(process.cwd(), "data", "zalo-employee-registry.json");
const DISTRIBUTION_FILE = path.join(process.cwd(), "data", "lead-distribution.json");

interface Registry {
  // phone (10 digits) → zaloId
  byPhone: Record<string, string>;
  // zaloId → phone
  byZaloId: Record<string, string>;
  // zaloId of people who have started registration but not confirmed phone yet
  pendingRegistration: string[];
}

function loadRegistry(): Registry {
  try {
    if (!fs.existsSync(REGISTRY_FILE)) return emptyRegistry();
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf-8")) as Registry;
  } catch {
    return emptyRegistry();
  }
}

function saveRegistry(r: Registry): void {
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(r, null, 2), "utf-8");
}

function emptyRegistry(): Registry {
  return { byPhone: {}, byZaloId: {}, pendingRegistration: [] };
}

export function getZaloIdByPhone(phone: string): string | null {
  return loadRegistry().byPhone[normalizePhone(phone)] ?? null;
}

export function getPhoneByZaloId(zaloId: string): string | null {
  return loadRegistry().byZaloId[zaloId] ?? null;
}

export function registerEmployee(phone: string, zaloId: string): void {
  const r = loadRegistry();
  const p = normalizePhone(phone);
  r.byPhone[p] = zaloId;
  r.byZaloId[zaloId] = p;
  r.pendingRegistration = r.pendingRegistration.filter((id) => id !== zaloId);
  saveRegistry(r);
  console.log(`[zalo-registry] Đã đăng ký: phone=${p} zaloId=${zaloId}`);

  // Tự động cập nhật zaloId vào employee trong lead-distribution.json
  syncZaloIdToDistribution(p, zaloId);
}

/**
 * Tìm employee có phone khớp trong lead-distribution.json và cập nhật zaloId.
 */
function syncZaloIdToDistribution(phone: string, zaloId: string): void {
  try {
    if (!fs.existsSync(DISTRIBUTION_FILE)) return;
    const config = JSON.parse(fs.readFileSync(DISTRIBUTION_FILE, "utf-8")) as {
      employees: Array<{ id: string; phone?: string; zaloId: string }>;
      [key: string]: unknown;
    };

    let updated = false;
    for (const emp of config.employees) {
      const empPhone = normalizePhone(emp.phone ?? "");
      if (empPhone && empPhone === phone) {
        emp.zaloId = zaloId;
        updated = true;
        console.log(`[zalo-registry] Cập nhật zaloId cho employee ${emp.id}: ${zaloId}`);
      }
    }

    if (updated) {
      fs.writeFileSync(DISTRIBUTION_FILE, JSON.stringify(config, null, 2), "utf-8");
    }
  } catch (err) {
    console.warn("[zalo-registry] Không thể sync zaloId vào distribution config:", err);
  }
}

export function startPendingRegistration(zaloId: string): void {
  const r = loadRegistry();
  if (!r.pendingRegistration.includes(zaloId)) {
    r.pendingRegistration.push(zaloId);
    saveRegistry(r);
  }
}

export function isPendingRegistration(zaloId: string): boolean {
  return loadRegistry().pendingRegistration.includes(zaloId);
}

export function clearPendingRegistration(zaloId: string): void {
  const r = loadRegistry();
  r.pendingRegistration = r.pendingRegistration.filter((id) => id !== zaloId);
  saveRegistry(r);
}

export function getAllMappings(): Array<{ phone: string; zaloId: string }> {
  const r = loadRegistry();
  return Object.entries(r.byPhone).map(([phone, zaloId]) => ({ phone, zaloId }));
}

export function deleteMapping(phone: string): void {
  const r = loadRegistry();
  const p = normalizePhone(phone);
  const zaloId = r.byPhone[p];
  if (zaloId) delete r.byZaloId[zaloId];
  delete r.byPhone[p];
  saveRegistry(r);
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("84") && digits.length === 11) return "0" + digits.slice(2);
  return digits;
}
