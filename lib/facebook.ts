const FB_GRAPH = "https://graph.facebook.com/v25.0";

export interface FBConversation {
  id: string;
  updated_time: string;
  participants: {
    data: Array<{ id: string; name: string; email?: string }>;
  };
  snippet?: string;
  unread_count?: number;
  message_count?: number;
}

export interface FBMessage {
  id: string;
  message: string;
  created_time: string;
  from: { id: string; name: string };
  attachments?: {
    data: Array<{
      id: string;
      name?: string;
      mime_type?: string;
      image_data?: { url: string; preview_url: string };
      file_url?: string;
    }>;
  };
}

export interface FBPage {
  id: string;
  name: string;
  category: string;
  accessToken: string;
  picture?: string;
}

async function fbFetch<T>(
  path: string,
  accessToken: string,
  params: Record<string, string> = {}
): Promise<T> {
  const url = new URL(`${FB_GRAPH}${path}`);
  url.searchParams.set("access_token", accessToken);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  const data = await res.json();

  if (data.error) {
    throw new Error(
      `Facebook API error ${data.error.code}: ${data.error.message}`
    );
  }

  return data as T;
}

/**
 * Lấy danh sách hội thoại của một fanpage (Messenger only).
 */
export async function getConversations(
  pageId: string,
  pageToken: string,
  cursor?: string
): Promise<{
  data: FBConversation[];
  paging?: { cursors?: { before: string; after: string }; next?: string };
}> {
  const params: Record<string, string> = {
    platform: "MESSENGER",
    fields:
      "id,updated_time,participants,snippet,unread_count,message_count",
    limit: "30",
  };
  if (cursor) params["after"] = cursor;

  return fbFetch(`/${pageId}/conversations`, pageToken, params);
}

/**
 * Lấy tin nhắn trong một hội thoại.
 */
export async function getMessages(
  conversationId: string,
  pageToken: string,
  cursor?: string
): Promise<{
  data: FBMessage[];
  paging?: { cursors?: { before: string; after: string }; next?: string; previous?: string };
}> {
  const params: Record<string, string> = {
    fields: "id,message,created_time,from,attachments",
    limit: "50",
  };
  if (cursor) params["before"] = cursor;

  return fbFetch(`/${conversationId}/messages`, pageToken, params);
}

/**
 * Lấy thông tin một hội thoại (participants, etc.)
 */
export async function getConversation(
  conversationId: string,
  pageToken: string
): Promise<FBConversation> {
  return fbFetch(`/${conversationId}`, pageToken, {
    fields: "id,updated_time,participants,snippet,unread_count,message_count",
  });
}

/**
 * Lấy tên hiển thị của người dùng qua Page-Scoped User ID.
 * Facebook webhook chỉ gửi sender.id, không có tên → cần gọi Graph API.
 */
export async function getSenderName(
  senderId: string,
  pageToken: string
): Promise<string> {
  try {
    const data = await fbFetch<{ name?: string; id: string }>(
      `/${senderId}`,
      pageToken,
      { fields: "name" }
    );
    return data.name ?? "";
  } catch {
    return "";
  }
}

export interface SenderProfile {
  name: string;
  pictureUrl: string | null;
}

/**
 * Lấy tên + avatar của người dùng — dùng cho phát hiện giới tính.
 */
export async function getSenderProfile(
  senderId: string,
  pageToken: string
): Promise<SenderProfile> {
  try {
    const data = await fbFetch<{
      name?: string;
      id: string;
      picture?: { data: { url: string; is_silhouette: boolean } };
    }>(`/${senderId}`, pageToken, {
      fields: "name,picture.width(200).height(200)",
    });

    const pic = data.picture?.data;
    return {
      name: data.name ?? "",
      // Nếu là ảnh mặc định (silhouette) thì không dùng
      pictureUrl: pic && !pic.is_silhouette ? pic.url : null,
    };
  } catch {
    return { name: "", pictureUrl: null };
  }
}

// Cache comment đầu tiên theo post_id (tránh gọi API nhiều lần cho cùng bài đăng)
const postCommentCache = new Map<string, { text: string; fetchedAt: number }>();
const COMMENT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 phút

/**
 * Lấy nội dung bình luận đầu tiên (thường là comment gim) của một bài đăng.
 * Dùng để xác định dự án khi page admin gim tên dự án ở bình luận đầu.
 * Trả về chuỗi text hoặc null nếu không có / lỗi.
 */
export async function getPostFirstComment(
  postId: string,
  pageToken: string
): Promise<string | null> {
  const cached = postCommentCache.get(postId);
  if (cached && Date.now() - cached.fetchedAt < COMMENT_CACHE_TTL_MS) {
    return cached.text;
  }

  try {
    const data = await fbFetch<{
      data: Array<{ message: string }>;
    }>(`/${postId}/comments`, pageToken, {
      filter: "stream",
      order: "ranked",
      limit: "3",
      fields: "message",
    });

    const firstComment = data.data?.[0]?.message ?? null;
    if (firstComment) {
      postCommentCache.set(postId, { text: firstComment, fetchedAt: Date.now() });
    }
    return firstComment;
  } catch (err) {
    console.warn("[Facebook] Không đọc được comment của post", postId, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Gửi tin nhắn văn bản đến user trong hội thoại.
 */
export async function sendMessage(
  pageId: string,
  pageToken: string,
  recipientId: string,
  text: string
): Promise<{ message_id: string; recipient_id: string }> {
  // Dùng /me/messages thay vì /{pageId}/messages để đảm bảo tương thích tốt nhất
  const url = `${FB_GRAPH}/me/messages?access_token=${pageToken}`;

  const sendReq = async () =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
        messaging_type: "RESPONSE",
      }),
    });

  let res = await sendReq();
  let data = await res.json();

  // Lỗi #10: Another app is controlling this thread now (Handover Protocol)
  // Xử lý bằng cách tự động "cướp" quyền điều khiển hội thoại (Take Thread Control) rồi thử gửi lại
  if (data.error && data.error.code === 10) {
    console.log(`[Facebook] Lỗi #10. Đang lấy quyền điều khiển hội thoại (Take Thread Control) cho ID: ${recipientId}...`);
    const takeControlUrl = `${FB_GRAPH}/me/take_thread_control?access_token=${pageToken}`;
    const takeRes = await fetch(takeControlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient: { id: recipientId } }),
    });
    const takeData = await takeRes.json();
    if (takeData.error) {
      console.warn(`[Facebook] Take thread control thất bại:`, takeData.error.message);
      throw new Error(`Lỗi #10 — App chưa phải Primary Receiver hoặc thiếu pages_manage_metadata. Chi tiết: ${takeData.error.message}`);
    }
    console.log(`[Facebook] Lấy quyền thành công! Đang thử gửi lại...`);

    // Thử gửi lại lần 2
    res = await sendReq();
    data = await res.json();
  }

  if (data.error) {
    throw new Error(
      `Send API error ${data.error.code}: ${data.error.message}`
    );
  }

  return data;
}
