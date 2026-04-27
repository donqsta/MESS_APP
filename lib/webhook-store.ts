/**
 * Pub/sub dùng Node.js process events.
 * process là singleton thực sự, chia sẻ giữa TẤT CẢ module trong cùng process —
 * kể cả khi Next.js compile webhook route và events route thành module graph riêng.
 */

export interface AdReferral {
  source: string;
  type: string;
  ref?: string;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  ad_title?: string;
  photo_url?: string;
  video_url?: string;
  post_id?: string;
}

export interface WebhookMessage {
  pageId: string;
  senderId: string;
  senderName?: string;
  conversationId?: string;
  text: string;
  timestamp: number;
  mid: string;
  referral?: AdReferral;
}

const EVENT_NAME = "fb_webhook_message";

export function subscribe(pageId: string, fn: (msg: WebhookMessage) => void): () => void {
  const handler = (msg: WebhookMessage) => {
    if (msg.pageId === pageId) fn(msg);
  };

  process.on(EVENT_NAME, handler);
  console.log(`[SSE] subscribed pageId=${pageId} listeners=${process.listenerCount(EVENT_NAME)}`);

  return () => {
    process.off(EVENT_NAME, handler);
    console.log(`[SSE] unsubscribed pageId=${pageId} listeners=${process.listenerCount(EVENT_NAME)}`);
  };
}

export function publish(msg: WebhookMessage) {
  console.log(`[SSE] publish pageId=${msg.pageId} listeners=${process.listenerCount(EVENT_NAME)}`);
  process.emit(EVENT_NAME as never, msg as never);
}
