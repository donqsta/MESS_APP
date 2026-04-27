import { PageToken } from "@/lib/session";

/**
 * Đọc danh sách pages từ environment variables.
 * Hỗ trợ PAGE_TOKEN_1..10, PAGE_ID_1..10, PAGE_NAME_1..10
 * Không lưu vào session cookie → tránh cookie quá lớn.
 */
export function getPagesFromEnv(): PageToken[] {
  const pages: PageToken[] = [];
  for (let i = 1; i <= 10; i++) {
    const token = process.env[`PAGE_TOKEN_${i}`]?.trim();
    const id = process.env[`PAGE_ID_${i}`]?.trim();
    const name = process.env[`PAGE_NAME_${i}`]?.trim();
    if (!token || !id) continue;
    pages.push({ id, name: name || `Page ${id}`, accessToken: token, category: "Page" });
  }
  return pages;
}

export function getPageFromEnv(pageId: string): PageToken | undefined {
  return getPagesFromEnv().find((p) => p.id === pageId);
}
