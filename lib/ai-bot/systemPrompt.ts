import * as fs from "fs";
import * as path from "path";

const SKILLS_DIR = path.join(process.cwd(), "skills");

// Mapping pageId → tên file skill dự án (trong thư mục skills/)
const PAGE_SKILL: Record<string, string> = {
  "1691322607843700": "springville",        // Spring Ville (Gamuda, Nhơn Trạch)
  "280565692725266":  "van-phuc-city",      // Khu ĐT Vạn Phúc
  "646002805264466":  "prime-master",       // Prime Master
  "349848852373105":  "picity-skyzen",      // Pi Group (Picity Sky Park + SkyZen)
  "1807504546139538": "gamuda",             // Gamuda Land VN (Artisan, Celadon, Elysian, Meadow)
  "1584010335165016": "default",            // Khải Hoàn Imperial
  "245115559231275":  "default",            // TNP Holdings
  "729397667519994":  "default",            // TNP Vibes
};

// Cache để không đọc file liên tục
const cache: Record<string, string> = {};

function readSkill(name: string): string {
  if (cache[name]) return cache[name];
  const filePath = path.join(SKILLS_DIR, `${name}.md`);
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    cache[name] = content;
    return content;
  } catch {
    console.warn(`[SystemPrompt] Không tìm thấy skill file: ${filePath}`);
    return "";
  }
}

/**
 * Xây dựng system prompt đầy đủ cho một hội thoại:
 * = base-prompt.md (kỹ năng bán hàng BĐS)
 * + skills/{project}.md (thông tin dự án theo fanpage)
 */
export function buildSystemPrompt(pageId: string): string {
  const base = readSkill("base-prompt");
  const projectSkillName = PAGE_SKILL[pageId] ?? "default";
  const projectSkill = readSkill(projectSkillName);

  const parts = [base];
  if (projectSkill && projectSkillName !== "default") {
    parts.push("---\n\n## THÔNG TIN DỰ ÁN\n\n" + projectSkill);
  } else if (projectSkill) {
    parts.push("---\n\n" + projectSkill);
  }

  return parts.filter(Boolean).join("\n\n");
}

/** Xóa cache khi cần reload skills (dev mode) */
export function resetPromptCache(): void {
  for (const key of Object.keys(cache)) delete cache[key];
}
