/**
 * projectMatcher.ts
 *
 * Đọc danh sách dự án từ data/projects.json.
 * Matching theo 2 bước:
 *   1. Keyword / domain: nhanh, không tốn token
 *   2. Gemini AI fallback: khi text/URL mơ hồ hoặc có dự án mới chưa có keyword
 *
 * Thêm dự án mới: chỉ cần sửa data/projects.json — không cần đụng code.
 */

import * as fs from "fs";
import * as path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProjectEntry {
  id: number;
  name: string;
  keywords: string[];
  domains: string[];
  pageIds?: string[];   // Fanpage IDs mặc định → dự án này (fallback khi không match keyword)
}

interface ProjectConfig {
  fallbackId: number;
  projects: ProjectEntry[];
}

// ── Load & cache config ───────────────────────────────────────────────────────

const CONFIG_PATH = path.join(process.cwd(), "data", "projects.json");

// Singleton cache trên process object để hot-reload an toàn
declare global {
  // eslint-disable-next-line no-var
  var __projectConfig: { data: ProjectConfig; mtime: number } | undefined;
}

function loadConfig(): ProjectConfig {
  try {
    const stat = fs.statSync(CONFIG_PATH);
    const mtime = stat.mtimeMs;

    if (global.__projectConfig && global.__projectConfig.mtime === mtime) {
      return global.__projectConfig.data;
    }

    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const data = JSON.parse(raw) as ProjectConfig;
    global.__projectConfig = { data, mtime };
    console.log("[ProjectMatcher] Loaded projects.json:", data.projects.length, "projects");
    return data;
  } catch (err) {
    console.error("[ProjectMatcher] Lỗi đọc projects.json:", err);
    return { fallbackId: 41, projects: [] };
  }
}

export function getProjects(): ProjectEntry[] {
  return loadConfig().projects;
}

export function getFallbackId(): number {
  return loadConfig().fallbackId ?? 41;
}

// ── Step 1: Keyword / domain match ───────────────────────────────────────────

/**
 * Match nhanh bằng keyword hoặc domain substring.
 * Tự động loại bỏ "Chưa rõ" (fallbackId) khỏi danh sách match.
 */
export function matchByKeyword(text: string): number | null {
  const config = loadConfig();
  const needle = text.toLowerCase();

  for (const project of config.projects) {
    if (project.id === config.fallbackId) continue; // bỏ qua "Chưa rõ"

    for (const kw of project.keywords) {
      if (needle.includes(kw.toLowerCase())) return project.id;
    }
    for (const domain of project.domains) {
      if (needle.includes(domain.toLowerCase())) return project.id;
    }
  }
  return null;
}

// ── Step 2: Gemini AI fallback ────────────────────────────────────────────────

let geminiClient: GoogleGenerativeAI | null = null;

function getGemini(): GoogleGenerativeAI | null {
  if (!process.env.GOOGLE_AI_API_KEY) return null;
  if (!geminiClient) geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  return geminiClient;
}

/**
 * Dùng Gemini để chọn dự án phù hợp nhất từ danh sách.
 * Trả về project ID hoặc null nếu không xác định được.
 */
export async function matchByAI(text: string): Promise<number | null> {
  const gemini = getGemini();
  if (!gemini) return null;

  const config = loadConfig();
  const candidates = config.projects.filter((p) => p.id !== config.fallbackId);
  if (candidates.length === 0) return null;

  const projectList = candidates
    .map((p) => `- ID ${p.id}: ${p.name} (từ khóa: ${p.keywords.slice(0, 3).join(", ")})`)
    .join("\n");

  const prompt =
    `Dựa vào đoạn text/URL dưới đây, hãy xác định đây đang đề cập đến dự án bất động sản nào.\n\n` +
    `DANH SÁCH DỰ ÁN:\n${projectList}\n\n` +
    `TEXT/URL: "${text}"\n\n` +
    `Nếu có thể xác định được, trả về JSON: {"id": <số ID>}\n` +
    `Nếu KHÔNG thể xác định (không liên quan đến bất kỳ dự án nào), trả về: {"id": null}`;

  try {
    const model = gemini.getGenerativeModel({
      model: "gemini-3.1-pro-preview",
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    });

    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    const parsed = JSON.parse(raw) as { id: number | null };
    if (typeof parsed.id === "number") {
      console.log(`[ProjectMatcher] AI matched "${text.slice(0, 60)}" → project ID ${parsed.id}`);
      return parsed.id;
    }
    return null;
  } catch (err) {
    console.warn("[ProjectMatcher] AI match lỗi:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Fanpage → project fallback ────────────────────────────────────────────────

/**
 * Tìm project ID mặc định cho một Fanpage ID.
 * Đọc từ `pageIds` trong projects.json — không cần hardcode trong code.
 */
export function getProjectForPage(pageId: string): number {
  const config = loadConfig();
  for (const project of config.projects) {
    if (project.pageIds?.includes(pageId)) return project.id;
  }
  return config.fallbackId ?? 41;
}

// ── Cập nhật 1 project trong JSON ────────────────────────────────────────────

export function updateProject(
  id: number,
  patch: Partial<Pick<ProjectEntry, "keywords" | "domains" | "name" | "pageIds">>
): void {
  const config = loadConfig();
  const project = config.projects.find((p) => p.id === id);
  if (!project) throw new Error(`Không tìm thấy project ID ${id}`);

  if (patch.name     !== undefined) project.name     = patch.name;
  if (patch.keywords !== undefined) project.keywords = patch.keywords;
  if (patch.domains  !== undefined) project.domains  = patch.domains;
  if (patch.pageIds  !== undefined) project.pageIds  = patch.pageIds;

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  global.__projectConfig = undefined; // reset cache
  console.log(`[ProjectMatcher] Updated project ID ${id}:`, patch);
}

// ── Sync từ Getfly API ───────────────────────────────────────────────────────

const GETFLY_BASE_URL = process.env.GETFLY_BASE_URL ?? "";
const GETFLY_API_KEY  = process.env.GETFLY_API_KEY  ?? "";

interface GetflyFieldOption {
  id: number;
  list_value: string;
  valid?: number;
}

interface GetflyField {
  field_name: string;
  field_description: string;
  custom_field_lists?: GetflyFieldOption[];
}

/**
 * Dùng Gemini để suggest keywords và domains cho một dự án mới.
 * Trả về { keywords, domains } phù hợp với tên dự án.
 */
async function suggestKeywordsForProject(
  projectName: string
): Promise<{ keywords: string[]; domains: string[] }> {
  const gemini = getGemini();
  if (!gemini) return { keywords: [], domains: [] };

  const prompt =
    `Bạn là chuyên gia SEO BĐS Việt Nam. Dự án có tên: "${projectName}".\n\n` +
    `Hãy tạo:\n` +
    `1. keywords: mảng từ khóa thường xuất hiện trong tin nhắn khách hoặc tên quảng cáo khi nói về dự án này\n` +
    `   - Gồm: tên tiếng Anh, biến thể không dấu, viết liền, viết cách, viết gạch ngang\n` +
    `   - Không quá 8 keywords\n` +
    `2. domains: mảng các pattern thường thấy trong tên miền website của dự án\n` +
    `   - Chỉ lấy phần đặc trưng (không lấy TLD .com .vn)\n` +
    `   - Không quá 3 items\n\n` +
    `Trả về JSON duy nhất:\n` +
    `{"keywords":["..."],"domains":["..."]}`;

  try {
    const model = gemini.getGenerativeModel({
      model: "gemini-3.1-pro-preview",
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    });
    const result = await model.generateContent(prompt);
    const parsed = JSON.parse(result.response.text().trim()) as {
      keywords?: string[];
      domains?: string[];
    };
    return {
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String) : [],
      domains:  Array.isArray(parsed.domains)  ? parsed.domains.map(String)  : [],
    };
  } catch (err) {
    console.warn("[ProjectMatcher] AI suggest keywords lỗi:", err instanceof Error ? err.message : err);
    return { keywords: [], domains: [] };
  }
}

/**
 * Fetch danh sách dự án từ Getfly API (GET /api/v6/accounts/custom_fields)
 * và merge vào projects.json:
 *   - Thêm entry mới: tên lấy từ Getfly, keywords/domains do Gemini suggest
 *   - Cập nhật `name` nếu Getfly đổi tên
 *   - Giữ nguyên `keywords` và `domains` của entry đã có (người dùng tự chỉnh)
 */
export async function syncProjectsFromGetfly(
  options: { fillEmptyKeywords?: boolean } = {}
): Promise<{ added: string[]; updated: string[]; filled: string[]; unchanged: number }> {
  if (!GETFLY_BASE_URL || !GETFLY_API_KEY) {
    throw new Error("Chưa cấu hình GETFLY_BASE_URL hoặc GETFLY_API_KEY");
  }

  // Fetch custom fields
  const res = await fetch(
    `${GETFLY_BASE_URL}/api/v6/accounts/custom_fields?limit=100&fields=field_name,field_description,custom_field_lists`,
    { headers: { "X-API-KEY": GETFLY_API_KEY } }
  );
  if (!res.ok) throw new Error(`Getfly API error: ${res.status}`);

  const json = await res.json() as { data: GetflyField[] };
  const duAnField = (json.data ?? []).find((f) => f.field_name === "du_an_quan_tam");
  if (!duAnField?.custom_field_lists?.length) {
    throw new Error("Không tìm thấy field du_an_quan_tam trong Getfly");
  }

  const config = loadConfig();
  const existingById = new Map(config.projects.map((p) => [p.id, p]));

  const added: string[] = [];
  const updated: string[] = [];
  const filled: string[] = [];

  for (const option of duAnField.custom_field_lists) {
    if (!option.id || option.valid === 0) continue;

    const existing = existingById.get(option.id);
    if (!existing) {
      // Dự án mới — Gemini suggest keywords/domains
      console.log(`[ProjectMatcher] Dự án mới: ID ${option.id} "${option.list_value}" — suggesting keywords...`);
      const suggested = await suggestKeywordsForProject(option.list_value);

      config.projects.push({
        id: option.id,
        name: option.list_value,
        keywords: suggested.keywords,
        domains:  suggested.domains,
      });
      added.push(`ID ${option.id}: ${option.list_value} → keywords: [${suggested.keywords.join(", ") || "—"}]`);
    } else {
      // Tên đổi → cập nhật
      if (existing.name !== option.list_value) {
        updated.push(`ID ${option.id}: "${existing.name}" → "${option.list_value}"`);
        existing.name = option.list_value;
      }

      // fillEmptyKeywords: AI suggest cho project đang có keywords rỗng
      if (options.fillEmptyKeywords && existing.keywords.length === 0 && option.id !== config.fallbackId) {
        console.log(`[ProjectMatcher] Fill keywords cho ID ${option.id} "${existing.name}"...`);
        const suggested = await suggestKeywordsForProject(existing.name);
        if (suggested.keywords.length > 0) {
          existing.keywords = suggested.keywords;
          if (existing.domains.length === 0) existing.domains = suggested.domains;
          filled.push(`ID ${option.id}: ${existing.name} → keywords: [${suggested.keywords.join(", ")}]`);
        }
      }
    }
  }

  // Ghi lại file nếu có thay đổi
  if (added.length > 0 || updated.length > 0 || filled.length > 0) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
    global.__projectConfig = undefined;
    console.log("[ProjectMatcher] Sync xong. Added:", added.length, "Updated:", updated.length, "Filled:", filled.length);
  }

  return {
    added,
    updated,
    filled,
    unchanged: config.projects.length - added.length - filled.length,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Match project từ text/URL:
 *   1. Keyword/domain match (nhanh)
 *   2. Gemini fallback (chỉ khi text có nội dung đủ dài để AI phân tích)
 *   3. Trả về null nếu không xác định
 */
export async function matchProject(text: string, useAI = true): Promise<number | null> {
  if (!text) return null;

  // Step 1: keyword/domain
  const fromKeyword = matchByKeyword(text);
  if (fromKeyword !== null) return fromKeyword;

  // Step 2: AI fallback (chỉ khi text đủ dài / có ngữ cảnh)
  if (useAI && text.length >= 5) {
    return matchByAI(text);
  }

  return null;
}
