import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import {
  loadConfig,
  saveConfig,
  upsertEmployee,
  deleteEmployee,
  setProjectDistribution,
  resetProjectState,
  getCandidates,
  Employee,
  ProjectDistribution,
  DistributionConfig,
} from "@/lib/lead-distributor";
import { sendZaloMessage } from "@/lib/zalo-bot";

// GET: lấy toàn bộ config + trạng thái queue
export async function GET() {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const config = loadConfig();
  return NextResponse.json(config);
}

// POST: lưu config hoặc thực hiện action
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
  }

  const body = await req.json() as {
    action?: string;
    employee?: Employee;
    employeeId?: string;
    projectId?: string | number;
    distribution?: ProjectDistribution;
    config?: DistributionConfig;
    zaloId?: string;
    message?: string;
  };

  const { action } = body;

  try {
    switch (action) {
      case "upsert_employee": {
        if (!body.employee) return NextResponse.json({ error: "Thiếu employee" }, { status: 400 });
        upsertEmployee(body.employee);
        return NextResponse.json({ success: true });
      }

      case "delete_employee": {
        if (!body.employeeId) return NextResponse.json({ error: "Thiếu employeeId" }, { status: 400 });
        deleteEmployee(body.employeeId);
        return NextResponse.json({ success: true });
      }

      case "set_project_distribution": {
        if (!body.projectId || !body.distribution) {
          return NextResponse.json({ error: "Thiếu projectId hoặc distribution" }, { status: 400 });
        }
        setProjectDistribution(body.projectId, body.distribution);
        return NextResponse.json({ success: true });
      }

      case "reset_project_state": {
        if (!body.projectId) return NextResponse.json({ error: "Thiếu projectId" }, { status: 400 });
        resetProjectState(body.projectId);
        return NextResponse.json({ success: true });
      }

      case "save_full_config": {
        if (!body.config) return NextResponse.json({ error: "Thiếu config" }, { status: 400 });
        saveConfig(body.config);
        return NextResponse.json({ success: true });
      }

      case "test_ping": {
        if (!body.zaloId) return NextResponse.json({ error: "Thiếu zaloId" }, { status: 400 });
        const msg = body.message ?? "🔔 Đây là tin nhắn test từ hệ thống phân chia lead.";
        const sent = await sendZaloMessage(body.zaloId, msg);
        return NextResponse.json({ success: sent, sent });
      }

      case "get_candidates": {
        if (!body.projectId) return NextResponse.json({ error: "Thiếu projectId" }, { status: 400 });
        const candidates = getCandidates(body.projectId);
        return NextResponse.json({ candidates });
      }

      default:
        return NextResponse.json({ error: `Action không hợp lệ: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[lead-distribution API] Lỗi:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
