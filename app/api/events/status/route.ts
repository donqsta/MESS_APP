import { NextResponse } from "next/server";

const EVENT_NAME = "fb_webhook_message";

export async function GET() {
  return NextResponse.json({
    listeners: process.listenerCount(EVENT_NAME),
    event: EVENT_NAME,
  });
}
