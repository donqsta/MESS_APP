/**
 * uhchat.net scraper — dựa trên cấu trúc HTML thực tế:
 *
 * Login:
 *   POST https://uhchat.net/admin/
 *   fields: email, matkhau (không phải "password"), remember=on, dangnhap=Login
 *   No CSRF token — PHP session via PHPSESSID cookie
 *
 * Conversation list:
 *   GET  https://uhchat.net/admin/         → HTML với <div class="khach" id="<sessionId>">
 *   POST https://uhchat.net/admin/ (body: showallchat=...) → tải thêm hội thoại cũ
 *
 * Conversation detail:
 *   GET  https://uhchat.net/chat/admin/index.php?user=<sessionId>
 *   → HTML với <div class="khach"> (tin visitor) và <div class="admin"> (tin admin)
 *   → Có <span>Đã gửi lúc HH:MM</span>
 *   → Có <span>Đang xem <a href="URL">...</a></span> (trang đang xem)
 *   → Có <span>Đến từ website <a href="URL">...</a></span> (referrer)
 *
 * Visitor detail:
 *   GET  https://uhchat.net/admin/detail.php?user=<sessionId>  → IP, thông tin thêm
 */

import fs from "fs";
import path from "path";
import { extractPhoneNumbers } from "@/lib/getfly";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UhchatMessage {
  from: "visitor" | "admin";
  text: string;
  time?: string;
}

export interface UhchatConversation {
  sessionId: string;
  visitorName?: string;
  ipAddress?: string;
  currentPage?: string;
  referrer?: string;
  country?: string;
  startTime?: string;
  messages: UhchatMessage[];
  /** Preview tin nhắn cuối từ danh sách — dùng để phát hiện tin nhắn mới */
  lastMsgPreview?: string;
  /** Tất cả trang khách đã xem trong cuộc hội thoại (theo thứ tự thời gian) */
  visitedPages?: string[];
}

export interface UhchatLead extends UhchatConversation {
  phone?: string;       // SĐT đầu tiên tìm thấy (backward-compat)
  phones?: string[];    // Tất cả SĐT trong cuộc hội thoại
  getflysynced?: boolean;
  processedAt: Date;
  /** "chat" = từ trang Tin nhắn, "stats" = từ trang Thống kê (truy cập nhưng có thể không chat) */
  source?: "chat" | "stats";
  /** ID record số trên trang Thống kê (e.g., "28066646") */
  statsRecordId?: string;
}

// ── Session cache ─────────────────────────────────────────────────────────────

interface SessionCache {
  cookie: string; // "PHPSESSID=xxx; tk=xxx"
  expiresAt: number;
  isManual?: boolean; // true = cookie được set thủ công (không auto-expire)
}

let _cache: SessionCache | null = null;
const SESSION_TTL_MS = 25 * 60 * 1000; // 25 phút

// ── Cookie file persistence ────────────────────────────────────────────────────

const COOKIE_FILE = path.join(process.cwd(), "data", "uhchat-cookie.json");

function saveCookieToFile(cookie: string | null): void {
  try {
    if (cookie === null) {
      if (fs.existsSync(COOKIE_FILE)) fs.unlinkSync(COOKIE_FILE);
    } else {
      fs.writeFileSync(COOKIE_FILE, JSON.stringify({ cookie }), "utf-8");
    }
  } catch (e) {
    console.error("[uhchat] Không thể ghi cookie file:", e);
  }
}

function loadCookieFromFile(): string | null {
  try {
    if (!fs.existsSync(COOKIE_FILE)) return null;
    const raw = fs.readFileSync(COOKIE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as { cookie?: string };
    return parsed.cookie?.trim() || null;
  } catch {
    return null;
  }
}

/** Đặt cookie thủ công (từ browser DevTools) — bỏ qua auto-login */
export function setManualCookie(cookie: string): void {
  if (!cookie) {
    _cache = null;
    saveCookieToFile(null);
    console.log("[uhchat] Đã xóa manual cookie");
    return;
  }
  // Lưu vô thời hạn trong file; in-memory dùng TTL rất dài (1 năm)
  _cache = { cookie, expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000, isManual: true };
  saveCookieToFile(cookie);
  console.log("[uhchat] Đã lưu manual cookie:", cookie.slice(0, 60));
}

const BASE = "https://uhchat.net";
const CHAT_ADMIN = `${BASE}/chat/admin/index.php`;

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Gom tất cả Set-Cookie thành chuỗi cookie đơn, deduplicate giữ giá trị cuối */
function extractCookies(headers: Headers): string {
  const raw: string[] = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  if (raw.length === 0) {
    const s = headers.get("set-cookie");
    if (s) raw.push(...s.split(/,(?=\s*[A-Za-z_][A-Za-z0-9_-]*=)/));
  }
  // Deduplicate: giữ giá trị CUỐI CÙNG của mỗi cookie name
  // (tránh gửi cả "tk=; tk=deleted; tk=realvalue" — PHP nhận tk rỗng đầu tiên)
  const map = new Map<string, string>();
  for (const c of raw) {
    const pair = c.split(";")[0].trim();
    const eqIdx = pair.indexOf("=");
    if (eqIdx <= 0) continue;
    const name = pair.slice(0, eqIdx);
    const val = pair.slice(eqIdx + 1);
    // Bỏ qua giá trị rỗng hoặc "deleted" — trừ khi đây là lần đầu tiên thấy
    if (val === "" || val === "deleted") {
      if (!map.has(name)) map.set(name, pair); // giữ nếu chưa có giá trị tốt hơn
    } else {
      map.set(name, pair); // giá trị thực → luôn ghi đè
    }
  }
  return [...map.values()].filter((v) => !v.endsWith("=") && !v.endsWith("=deleted")).join("; ");
}

/** HTML entity decode tối giản */
function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Đăng nhập ─────────────────────────────────────────────────────────────────

/** Ghép mảng Set-Cookie vào Map<name, "name=value">, giữ giá trị cuối cùng thực */
function mergeCookies(map: Map<string, string>, setCookies: string[]): void {
  const splitted = setCookies.flatMap((h) =>
    h.split(/,(?=\s*[A-Za-z_][A-Za-z0-9_-]*=)/)
  );
  for (const c of splitted) {
    const pair = c.split(";")[0].trim();
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const val = pair.slice(eq + 1).trim();
    if (val && val !== "deleted") {
      map.set(name, `${name}=${val}`);
    } else if (!map.has(name)) {
      map.set(name, `${name}=${val}`);
    }
  }
}

/** Xuất cookie string từ Map, bỏ qua giá trị rỗng / deleted */
function cookiesToString(map: Map<string, string>): string {
  return [...map.values()]
    .filter((v) => !v.endsWith("=") && !v.endsWith("=deleted"))
    .join("; ");
}

export async function loginUhchat(): Promise<string> {
  const email = process.env.UHCHAT_EMAIL;
  const password = process.env.UHCHAT_PASSWORD;
  if (!email || !password) throw new Error("UHCHAT_EMAIL / UHCHAT_PASSWORD chưa cấu hình");

  const cookieMap = new Map<string, string>();

  const BASE_HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
  };

  // ── Bước 0: GET trang login để lấy PHPSESSID ban đầu (giống browser) ──
  const res0 = await fetch(`${BASE}/admin/`, {
    headers: { ...BASE_HEADERS },
    redirect: "follow",
  });
  const setCookies0 = (res0.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? res0.headers.get("set-cookie")?.split(/,(?=\s*[A-Za-z_][A-Za-z0-9_-]*=)/) ?? [];
  mergeCookies(cookieMap, setCookies0);
  console.log(`[uhchat] GET login page → HTTP ${res0.status} cookies=${setCookies0.length}`);

  // ── Bước A: POST đăng nhập, không follow redirect để lấy cookie ──
  const formBody = new URLSearchParams({
    email,
    matkhau: password,
    remember: "on",
    dangnhap: "Login",
  }).toString();

  const resA = await fetch(`${BASE}/admin/`, {
    method: "POST",
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": BASE,
      "Referer": `${BASE}/admin/`,
      ...(cookiesToString(cookieMap) ? { Cookie: cookiesToString(cookieMap) } : {}),
    },
    body: formBody,
    redirect: "manual",
  });

  const setCookiesA = (resA.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? resA.headers.get("set-cookie")?.split(/,(?=\s*[A-Za-z_][A-Za-z0-9_-]*=)/) ?? [];
  mergeCookies(cookieMap, setCookiesA);
  const locationA = resA.headers.get("location") ?? "/admin/";
  console.log(`[uhchat] POST login → HTTP ${resA.status} location=${locationA} cookies=${setCookiesA.length}`);

  if (!cookiesToString(cookieMap)) {
    throw new Error("Đăng nhập uhchat thất bại: không nhận được cookie từ POST (sai email/mật khẩu?)");
  }

  // ── Bước B: GET trang redirect để nhận thêm cookies (tk token) ──
  const redirectUrl = locationA.startsWith("http")
    ? locationA
    : `${BASE}${locationA.startsWith("/") ? "" : "/"}${locationA}`;

  const resB = await fetch(redirectUrl, {
    headers: { ...BASE_HEADERS, Cookie: cookiesToString(cookieMap) },
    redirect: "manual",
  });

  const setCookiesB = (resB.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
    ?? resB.headers.get("set-cookie")?.split(/,(?=\s*[A-Za-z_][A-Za-z0-9_-]*=)/) ?? [];
  mergeCookies(cookieMap, setCookiesB);
  console.log(`[uhchat] GET redirect ${redirectUrl} → HTTP ${resB.status} cookies=${setCookiesB.length}`);

  const finalCookie = cookiesToString(cookieMap);
  if (!finalCookie) throw new Error("Không nhận được cookie sau GET redirect");
  console.log("[uhchat] Final cookie:", finalCookie.slice(0, 120));

  // ── Bước C: Verify — GET dashboard, không follow redirect, kiểm tra không còn trang login ──
  const resC = await fetch(`${BASE}/admin/`, {
    headers: { ...BASE_HEADERS, Cookie: finalCookie },
    redirect: "follow",
  });
  const testHtml = await resC.text();
  const stillOnLoginPage =
    testHtml.includes('id="formdangnhap"') ||
    testHtml.includes('name="dangnhap"') ||
    testHtml.includes('name="matkhau"');

  if (stillOnLoginPage) {
    console.warn("[uhchat] Vẫn thấy trang login sau xác thực. HTML đầu:", testHtml.slice(0, 300));
    throw new Error("Đăng nhập uhchat thất bại: sai email/mật khẩu hoặc tài khoản bị khóa");
  }

  _cache = { cookie: finalCookie, expiresAt: Date.now() + SESSION_TTL_MS };
  saveCookieToFile(finalCookie); // persist để sống sót qua server restart
  console.log("[uhchat] Đăng nhập thành công, cookie hợp lệ");
  return finalCookie;
}

/** Raw GET không có session-expired check — dùng nội bộ trong loginUhchat */
async function authedGetRaw(cookie: string, url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Cookie: cookie, Referer: `${BASE}/admin/` },
    redirect: "follow",
  });
  return res.text();
}

// ── Cookie hợp lệ ─────────────────────────────────────────────────────────────

async function getCookie(): Promise<string> {
  // 1. Manual cookie (in-memory) — ưu tiên cao nhất
  if (_cache && Date.now() < _cache.expiresAt) return _cache.cookie;

  // 2. Manual cookie từ file (persist vô thời hạn, ghi đè khi có cookie mới)
  const fileCookie = loadCookieFromFile();
  if (fileCookie) {
    _cache = { cookie: fileCookie, expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000, isManual: true };
    console.log("[uhchat] Khôi phục manual cookie từ file");
    return fileCookie;
  }

  // 3. UHCHAT_COOKIE từ .env.local (fallback cứng)
  const envCookie = process.env.UHCHAT_COOKIE?.trim();
  if (envCookie) {
    _cache = { cookie: envCookie, expiresAt: Date.now() + 8 * 60 * 60 * 1000, isManual: true };
    return envCookie;
  }

  // 4. Auto-login bằng email/password
  return loginUhchat();
}

// ── Fetch có auth ─────────────────────────────────────────────────────────────

async function authedGet(url: string, retry = true): Promise<string> {
  const cookie = await getCookie();
  const text = await authedGetRaw(cookie, url);

  // Nếu nhận về trang login → session hết hạn, xóa cache (kể cả manual) rồi thử lại
  if (text.includes('id="formdangnhap"') || text.includes('name="dangnhap"')) {
    console.warn("[uhchat] Session hết hạn, đang đăng nhập lại...");
    invalidateSession(true); // force=true: xóa cả manual cookie để auto-login
    saveCookieToFile(null);  // xóa file cookie cũ
    if (retry) return authedGet(url, false);
    throw new Error("Không thể xác thực với uhchat.net");
  }

  return text;
}

async function authedPost(url: string, formBody: URLSearchParams): Promise<string> {
  const cookie = await getCookie();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
      Cookie: cookie,
      Referer: `${BASE}/admin/`,
    },
    body: formBody.toString(),
    redirect: "follow",
  });
  return res.text();
}

// ── Parse danh sách conversation từ HTML trang chính ─────────────────────────
//
// Mẫu HTML thực tế:
//   <div class="khach" id="631211d236e3980a980defea96ae67b3">
//     <a href="#load=2405:4803:e833:" onClick="loadbox('631211d236e3980a980defea96ae67b3','2405:4803:e833:');">
//       ...text tin nhắn cuối...
//       <span><i></i>3 giờ trước <a ...>x</a> <span>0915586199</span></span>
//     </a>
//   </div>

function parseConversationList(html: string): Array<{ sessionId: string; ipAddress: string; lastMsg: string; phone: string; timeAgo: string }> {
  const list: Array<{ sessionId: string; ipAddress: string; lastMsg: string; phone: string; timeAgo: string }> = [];

  // Mỗi .khach div KHÔNG có nested div nên </div> là terminator an toàn
  // uhchat dùng &quot; thay cho nháy đơn/đôi trong onclick
  const divRegex = /<div class="khach" id="([a-f0-9]{32})">([\s\S]*?)<\/div>/g;
  let m: RegExpExecArray | null;

  while ((m = divRegex.exec(html)) !== null) {
    const sessionId = m[1];
    const inner = m[2];

    // IP từ loadbox — HTML dùng &quot; thay cho nháy đơn
    // Pattern: loadbox(&quot;sessionId&quot;,&quot;ip&quot;)
    const ipMatch = inner.match(/loadbox\(&quot;[a-f0-9]{32}&quot;,&quot;([^&]+)&quot;\)/);
    const ipAddress = ipMatch?.[1]?.trim() ?? "";

    // Số điện thoại từ <span> lồng bên trong — pattern: <span>0xxxxxxxxx</span>
    const phoneMatch = inner.match(/<span>(0[3-9]\d{8})<\/span>/);
    const phone = phoneMatch?.[1] ?? "";

    // Lấy toàn bộ text của <span> chứa "giờ trước / ngày trước / phút trước"
    // Pattern: <span><i></i>N giờ trước ... </span>
    const timeMatch = inner.match(/(\d+\s*(?:phút|giờ|ngày|tháng)\s*tr[uư][ớo]c)/);
    const timeAgo = timeMatch?.[1] ?? "";

    // Text tin nhắn cuối = nội dung text ngay trong thẻ <a>, trước <span>
    const aContent = inner.match(/<a [^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "";
    const lastMsg = decodeHtml(
      aContent
        .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")
        .replace(/<img[^>]*>/g, "")
        .split(/<span>/)[0]
        .replace(/<[^>]+>/g, " ")
    );

    list.push({ sessionId, ipAddress, lastMsg, phone, timeAgo });
  }

  return list;
}

// ── Lấy danh sách cuộc hội thoại ─────────────────────────────────────────────

// "Xem tất cả" yêu cầu reCAPTCHA nên không tự động được.
// Trang chính hiển thị ~50 cuộc chat gần nhất — đủ cho polling.
export async function getConversations(): Promise<UhchatConversation[]> {
  const html = await authedGet(`${BASE}/admin/`);
  const isLoggedIn = html.includes('id="cachopthoai"') || html.includes('class="khach"');
  const raw = parseConversationList(html);
  console.log(`[uhchat] Dashboard: loggedIn=${isLoggedIn} htmlLen=${html.length} sessions=${raw.length}`);

  return raw.map((r) => ({
    sessionId: r.sessionId,
    ipAddress: r.ipAddress || undefined,
    startTime: r.timeAgo || undefined,
    lastMsgPreview: r.lastMsg?.trim() || undefined,
    messages: [],
  }));
}

// ── Parse chi tiết hội thoại ──────────────────────────────────────────────────
//
// Cấu trúc thực tế từ chat/admin/index.php?user=<sessionId>:
//
//   <div class="khach">  (visitor)
//     <a href="/admin/detail.php?user=..."><img class="img"/></a>
//     TEXT TIN NHẮN <a href="..."><img ...></a><br />
//     <span>Đã gửi lúc HH:MM</span><br />
//     <span>Đến từ website <a href="REFERRER">...</a></span><br />
//     <span>Đang xem <a href="CURRENT_URL" title="TITLE">...</a></span>
//   </div>
//
//   <div class="admin">  (admin)
//     <img src="/avatar/..." class="img"/>
//     TEXT TIN NHẮN<br />
//     <span>Đã gửi lúc HH:MM</span>
//   </div>

function parseConversationDetail(html: string, sessionId: string): { messages: UhchatMessage[]; meta: Partial<UhchatConversation> } {
  const messages: UhchatMessage[] = [];
  const meta: Partial<UhchatConversation> = { sessionId };
  const allVisitedPages: string[] = []; // Thu thập TẤT CẢ trang đã xem theo thứ tự

  // Giới hạn vùng chat (bỏ qua phần form gửi tin ở dưới)
  const chatBlock = html.match(/<div id="ndht">([\s\S]*?)(?:<div id="guinhanh"|<\/body>)/)?.[1] ?? html;

  // Tách từng message div — khach hoặc admin (không lồng nhau)
  const msgRegex = /<div class="(khach|admin)">([\s\S]*?)(?=<div class="(?:khach|admin)"|<br><div id="blank"|$)/g;
  let m: RegExpExecArray | null;

  while ((m = msgRegex.exec(chatBlock)) !== null) {
    const role = m[1];
    const inner = m[2];

    // ── Metadata chỉ từ visitor ──
    if (role === "khach") {
      // Thu thập URL "Đang xem" trong từng message của visitor
      const spans = [...inner.matchAll(/<span>([^<]*)<a href=["']([^"']+)["'][^>]*>/g)];
      for (const s of spans) {
        const label = s[1].toLowerCase();
        const url = s[2];
        if ((label.includes("xem") || url.startsWith("http")) && !url.includes("google.com")) {
          // Chỉ thêm nếu chưa có (tránh trùng)
          if (!allVisitedPages.includes(url)) {
            allVisitedPages.push(url);
          }
          break; // Chỉ lấy 1 URL "Đang xem" mỗi message
        }
      }
      // Fallback nếu không có span rõ ràng
      if (allVisitedPages.length === 0) {
        const allLinks = [...inner.matchAll(/href=["'](https?:\/\/[^"']+)["']/g)];
        const nonGoogle = allLinks.find((l) => !l[1].includes("google.com/?q="));
        if (nonGoogle && !allVisitedPages.includes(nonGoogle[1])) {
          allVisitedPages.push(nonGoogle[1]);
        }
      }

      // Referrer — tìm span có href mà label chứa "đến từ" hoặc "website"
      if (!meta.referrer) {
        const refSpans = [...inner.matchAll(/<span>[^<]*(?:t[ừu]|website)[^<]*<a href=["']([^"']+)["']/gi)];
        if (refSpans[0]) meta.referrer = refSpans[0][1];
      }
    }

    // ── Time ──
    const timeMatch = inner.match(/l[uú]c\s*([\d]{1,2}:[\d]{2})/i);
    const time = timeMatch?.[1];

    // ── Text nội dung ──
    let text = inner;
    // 1. Xóa avatar link: <a href="/admin/detail.php..."><img class="img"/></a>
    text = text.replace(/<a href="\/admin\/detail\.php[^"]*"><img[^>]*><\/a>/g, "");
    // 2. Xóa avatar img admin: <img src="/avatar/..." class="img"/>
    text = text.replace(/<img[^>]*class="img"[^>]*>/g, "");
    // 3. Xóa tất cả <span>...</span> (metadata: time, referrer, current page)
    text = text.replace(/<span>[\s\S]*?<\/span>/g, "");
    // 4. Xóa link ảnh nhà mạng kèm SĐT: <a href="..."><img...></a>
    text = text.replace(/<a[^>]*><img[^>]*><\/a>/g, "");
    // 5. Xóa còn lại
    text = decodeHtml(text);

    if (text.length > 0) {
      messages.push({ from: role === "khach" ? "visitor" : "admin", text, time });
    }
  }

  // currentPage = trang CUỐI CÙNG khách xem (quan trọng nhất)
  // visitedPages = toàn bộ hành trình, để ghi vào Getfly note
  if (allVisitedPages.length > 0) {
    meta.currentPage = allVisitedPages[allVisitedPages.length - 1];
    meta.visitedPages = allVisitedPages;
  }

  return { messages, meta };
}

// ── Lấy tin nhắn của một session ─────────────────────────────────────────────

export async function getMessages(sessionId: string): Promise<{ messages: UhchatMessage[]; meta: Partial<UhchatConversation> }> {
  const url = `${CHAT_ADMIN}?user=${sessionId}`;
  try {
    const html = await authedGet(url);
    return parseConversationDetail(html, sessionId);
  } catch (err) {
    console.warn(`[uhchat] Lỗi lấy messages sessionId=${sessionId}:`, err instanceof Error ? err.message : err);
    return { messages: [], meta: { sessionId } };
  }
}

// ── Hàm chính: kéo tất cả chat mới ──────────────────────────────────────────

/**
 * Kéo tất cả hội thoại:
 * - Session CHƯA có trong store → fetch đầy đủ, trả về lead mới
 * - Session đã có nhưng lastMsgPreview thay đổi → fetch lại messages,
 *   cập nhật store tại chỗ, trả về lead đó (để sync Getfly nếu cần)
 * - Session đã có và không đổi → bỏ qua (tiết kiệm request)
 */
export async function fetchAllNewChats(
  seenIds: Set<string>,
  getLeadById: (id: string) => UhchatLead | undefined,
  updateMessages: (
    id: string,
    messages: UhchatMessage[],
    patch: Partial<UhchatConversation>,
  ) => void,
): Promise<UhchatLead[]> {
  const conversations = await getConversations();
  const leads: UhchatLead[] = [];

  // Xử lý từ cũ nhất → mới nhất để addLead (unshift) đặt mới nhất lên đầu store
  for (const convo of [...conversations].reverse()) {
    try {
      const existing = getLeadById(convo.sessionId);

      if (existing) {
        // Session đã biết — chỉ re-fetch nếu lastMsgPreview thay đổi
        const preview = convo.lastMsgPreview?.trim() ?? "";
        const storedPreview = existing.lastMsgPreview?.trim() ?? "";
        if (preview && preview === storedPreview) continue; // không có gì mới
        if (!preview) continue; // không có preview thì bỏ qua

        // Có tin nhắn mới → fetch lại
        const { messages, meta } = await getMessages(convo.sessionId);
        const fullVisitorText = messages
          .filter((m) => m.from === "visitor")
          .map((m) => m.text)
          .join(" ");

        // Cập nhật messages trong store tại chỗ
        updateMessages(convo.sessionId, messages, {
          lastMsgPreview: preview,
          currentPage: meta.currentPage,
          referrer: meta.referrer,
        });

        // Thử extract tất cả SĐT (kể cả khi đã có phone trước đó — có thể có thêm SĐT mới)
        const phones = await extractPhoneNumbers(fullVisitorText);
        const allPhones = phones.length > 0 ? phones : (existing.phones ?? (existing.phone ? [existing.phone] : []));
        const firstPhone = allPhones[0];
        if (firstPhone || existing.phone) {
          updateMessages(convo.sessionId, messages, {
            phone: firstPhone ?? existing.phone,
            phones: allPhones.length > 0 ? allPhones : undefined,
          } as Partial<UhchatLead>);
          leads.push({
            ...existing,
            messages,
            ...meta,
            phone: firstPhone ?? existing.phone,
            phones: allPhones.length > 0 ? allPhones : existing.phones,
            lastMsgPreview: preview,
            processedAt: new Date(),
          });
        }
        console.log(`[uhchat] Tin nhắn mới trong session ${convo.sessionId.slice(0, 8)}… (preview thay đổi)`);
        continue;
      }

      // Session hoàn toàn mới
      if (seenIds.has(convo.sessionId)) continue; // safety check
      const { messages, meta } = await getMessages(convo.sessionId);
      const fullVisitorText = messages
        .filter((msg) => msg.from === "visitor")
        .map((msg) => msg.text)
        .join(" ");
      const phones = await extractPhoneNumbers(fullVisitorText);

      leads.push({
        ...convo,
        ...meta,
        messages,
        phone: phones[0],
        phones: phones.length > 0 ? phones : undefined,
        lastMsgPreview: convo.lastMsgPreview,
        getflysynced: false,
        processedAt: new Date(),
      });
    } catch (err) {
      console.warn(`[uhchat] Lỗi xử lý sessionId=${convo.sessionId}:`, err);
    }
  }

  console.log(`[uhchat] Tổng ${leads.length} chat mới/cập nhật cần xử lý`);
  return leads;
}

// ── Lấy dữ liệu từ trang Thống kê (?menu=stats) ──────────────────────────────
//
// Cấu trúc HTML mỗi entry:
//
//   <div id="tg28066646" style="height:36px;">
//     <a href="#load=0345168398"
//        onClick="alert(&quot;16:45 ngày 29-04-2026\nTruy cập nhưng không chat\nPage Title\nhttps://url&quot)">
//       <span>...<img src="/themes/eye.png" .../> 9 giờ trước</span>
//     </a>
//     <a href="#del=..." onClick="deletechat('28066646')" ...>x</a>
//   </div>
//
//   Với người đã chat:
//   onClick="loadbox(&quot;sessionId&quot;,&quot;phone&quot;);"  ← không có alert
//
//   Cột phải (phone hiển thị rõ):
//   <div id="28066646"><a href="#load=0345168398" ...>0345168398</a></div>

function parseStatsPage(html: string): Array<{
  recordId: string;
  phone: string;
  visitTime: string;
  pageTitle: string;
  pageUrl: string;
  didChat: boolean;
  sessionId?: string;
}> {
  const results: Array<{
    recordId: string;
    phone: string;
    visitTime: string;
    pageTitle: string;
    pageUrl: string;
    didChat: boolean;
    sessionId?: string;
  }> = [];

  // Tách từng entry từ cột trái <div id="tg<id>">
  const entryRegex = /<div id="tg(\d+)"[^>]*>([\s\S]*?)(?=<div id="tg\d+"|<div style="text-align:center|$)/g;
  let m: RegExpExecArray | null;

  while ((m = entryRegex.exec(html)) !== null) {
    const recordId = m[1];
    const inner = m[2];

    // Lấy phone từ href="#load=<phone>"
    const phoneMatch = inner.match(/href="#load=([^"]+)"/);
    const phone = phoneMatch?.[1]?.trim() ?? "";
    if (!phone || !phone.match(/^[0-9+]/)) continue; // bỏ email, IP...

    // Kiểm tra có chat không: loadbox = có chat, alert = không chat
    const didChat = inner.includes("loadbox(");

    // Lấy sessionId nếu đã chat
    const sessionMatch = inner.match(/loadbox\(&quot;([a-f0-9]{32})&quot;/);
    const sessionId = sessionMatch?.[1];

    // Lấy thông tin từ alert text
    let visitTime = "";
    let pageTitle = "";
    let pageUrl = "";

    if (!didChat) {
      // Alert format: "HH:MM ngày DD-MM-YYYY\nTruy cập nhưng không chat\nPage Title\nhttps://url"
      const alertMatch = inner.match(/alert\(&quot;([\s\S]*?)&quot;?\)/);
      if (alertMatch) {
        const alertText = alertMatch[1]
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/\\n/g, "\n");
        const lines = alertText.split("\n");
        visitTime = lines[0]?.trim() ?? "";
        // lines[1] = "Truy cập nhưng không chat" — bỏ qua
        pageTitle = lines[2]?.trim() ?? "";
        pageUrl = lines[3]?.trim() ?? "";
      }
    }

    // Lấy time từ span nếu chưa có
    if (!visitTime) {
      const timeMatch = inner.match(/(\d+\s*(?:phút|giờ|ngày|tháng)\s*trước)/);
      visitTime = timeMatch?.[1] ?? "";
    }

    results.push({ recordId, phone, visitTime, pageTitle, pageUrl, didChat, sessionId });
  }

  return results;
}

/** Lấy danh sách visitor từ trang Thống kê */
export async function getStatsVisitors(seenStatIds: Set<string>): Promise<UhchatLead[]> {
  let html: string;
  try {
    html = await authedGet(`${BASE}/admin/?menu=stats`);
  } catch (err) {
    console.warn("[uhchat] Lỗi lấy trang thống kê:", err instanceof Error ? err.message : err);
    return [];
  }

  const raw = parseStatsPage(html);
  console.log(`[uhchat] Thống kê: tìm thấy ${raw.length} visitor`);

  const leads: UhchatLead[] = [];
  for (const entry of raw) {
    const key = `stats_${entry.recordId}`;
    if (seenStatIds.has(key)) continue;

    // Bỏ qua người đã chat — đã được xử lý bởi fetchAllNewChats với đầy đủ thông tin
    if (entry.didChat) continue;

    // Lấy số điện thoại hợp lệ (VN format)
    const phone = entry.phone.match(/^(0[3-9]\d{8}|\+84[3-9]\d{8})$/) ? entry.phone : undefined;
    if (!phone) continue; // chỉ lấy SĐT hợp lệ

    console.log(`[uhchat/stats] phone=${phone} pageUrl="${entry.pageUrl}" time="${entry.visitTime}"`);

    leads.push({
      sessionId: key, // dùng key thay thế sessionId
      statsRecordId: entry.recordId,
      source: "stats",
      phone,
      currentPage: entry.pageUrl || undefined,
      visitorName: undefined,
      startTime: entry.visitTime || undefined,
      messages: [],
      getflysynced: false,
      processedAt: new Date(),
    });
  }

  console.log(`[uhchat] Thống kê: ${leads.length} visitor mới có SĐT hợp lệ`);
  return leads;
}

// ── Invalidate session ────────────────────────────────────────────────────────

export function invalidateSession(force = false) {
  if (_cache?.isManual && !force) {
    console.log("[uhchat] Giữ nguyên manual cookie (không auto-invalidate)");
    return;
  }
  _cache = null;
  console.log("[uhchat] Session cache đã xóa");
}
