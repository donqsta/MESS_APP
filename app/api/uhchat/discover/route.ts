import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

/**
 * Route tạm thời dùng để khám phá internal endpoints của uhchat.net.
 * Gọi GET /api/uhchat/discover để xem response từ uhchat admin panel.
 * XÓA route này sau khi đã xác định được endpoints.
 */
export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const email = process.env.UHCHAT_EMAIL;
  const password = process.env.UHCHAT_PASSWORD;

  if (!email || !password) {
    return NextResponse.json({ error: "UHCHAT_EMAIL / UHCHAT_PASSWORD chưa được cấu hình trong .env.local" }, { status: 500 });
  }

  const results: Record<string, unknown> = {};

  // ── Bước 1: Lấy trang login để tìm form action và CSRF token ──
  try {
    const loginPageRes = await fetch("https://uhchat.net/admin/", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "manual",
    });

    results.loginPage = {
      status: loginPageRes.status,
      headers: Object.fromEntries(loginPageRes.headers.entries()),
      setCookies: loginPageRes.headers.getSetCookie?.() ?? loginPageRes.headers.get("set-cookie"),
    };

    const loginHtml = await loginPageRes.text();
    // Tìm form action
    const formActionMatch = loginHtml.match(/action=["']([^"']+)["']/i);
    const csrfMatch = loginHtml.match(/name=["']_token["'][^>]*value=["']([^"']+)["']/i)
      ?? loginHtml.match(/name=["']csrf[_-]?token["'][^>]*value=["']([^"']+)["']/i);
    const inputFields = [...loginHtml.matchAll(/<input[^>]*name=["']([^"']+)["'][^>]*/gi)].map((m) => m[1]);

    results.loginPageParsed = {
      formAction: formActionMatch?.[1] ?? "(não encontrado)",
      csrfToken: csrfMatch?.[1] ?? "(não encontrado)",
      inputFields,
      htmlSnippet: loginHtml.slice(0, 3000),
    };

    // ── Bước 2: Thử POST login ──
    const formData = new URLSearchParams();
    formData.set("email", email);
    formData.set("password", password);
    if (csrfMatch?.[1]) formData.set("_token", csrfMatch[1]);

    // Lấy cookies ban đầu (session cookie trước login)
    const initCookies = loginPageRes.headers.get("set-cookie") ?? "";
    const sessionCookieMatch = initCookies.match(/([a-zA-Z_]+sess[a-zA-Z_]*=[^;]+)/i)
      ?? initCookies.match(/([^;,\s]+=[^;,\s]+)/);
    const initCookie = sessionCookieMatch?.[1] ?? "";

    const postTarget = formActionMatch?.[1]
      ? (formActionMatch[1].startsWith("http") ? formActionMatch[1] : `https://uhchat.net${formActionMatch[1]}`)
      : "https://uhchat.net/admin/login";

    const loginRes = await fetch(postTarget, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://uhchat.net/admin/",
        "Cookie": initCookie,
      },
      body: formData.toString(),
      redirect: "manual",
    });

    const loginCookies = loginRes.headers.get("set-cookie") ?? "";
    const loginBody = await loginRes.text();

    results.loginPost = {
      status: loginRes.status,
      location: loginRes.headers.get("location"),
      setCookies: loginCookies,
      bodySnippet: loginBody.slice(0, 2000),
    };

    // ── Bước 3: Thử truy cập dashboard sau login ──
    const authCookie = [initCookie, loginCookies]
      .flatMap((c) => c.split(","))
      .map((c) => c.split(";")[0].trim())
      .filter(Boolean)
      .join("; ");

    const redirectTarget = loginRes.headers.get("location");
    const dashboardUrl = redirectTarget
      ? (redirectTarget.startsWith("http") ? redirectTarget : `https://uhchat.net${redirectTarget}`)
      : "https://uhchat.net/admin/home";

    const dashboardRes = await fetch(dashboardUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Cookie": authCookie,
      },
      redirect: "manual",
    });

    const dashboardHtml = await dashboardRes.text();
    const dashboardLinks = [...dashboardHtml.matchAll(/href=["'](\/admin\/[^"']+)["']/gi)].map((m) => m[1]);
    const ajaxUrls = [...dashboardHtml.matchAll(/["'](\/admin\/[^"']*(?:chat|conv|session|list|data|ajax)[^"']*)["']/gi)].map((m) => m[1]);

    results.dashboard = {
      status: dashboardRes.status,
      location: dashboardRes.headers.get("location"),
      links: [...new Set(dashboardLinks)].slice(0, 30),
      ajaxEndpoints: [...new Set(ajaxUrls)].slice(0, 20),
      htmlSnippet: dashboardHtml.slice(0, 3000),
    };

    // ── Bước 4: Thử một số endpoint phổ biến ──
    const candidateEndpoints = [
      "/admin/chat",
      "/admin/chats",
      "/admin/conversations",
      "/admin/sessions",
      "/admin/messages",
      "/admin/home",
      "/admin/list",
      "/admin/ajax/chats",
      "/admin/ajax/sessions",
    ];

    const endpointProbe: Record<string, unknown> = {};
    for (const ep of candidateEndpoints.slice(0, 5)) {
      try {
        const r = await fetch(`https://uhchat.net${ep}`, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            "Cookie": authCookie,
            "Accept": "application/json, text/html",
          },
          redirect: "manual",
        });
        const body = await r.text();
        endpointProbe[ep] = {
          status: r.status,
          contentType: r.headers.get("content-type"),
          location: r.headers.get("location"),
          snippet: body.slice(0, 500),
        };
      } catch (e) {
        endpointProbe[ep] = { error: String(e) };
      }
    }
    results.endpointProbe = endpointProbe;

  } catch (err) {
    results.error = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json(results, { status: 200 });
}
