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
 *
 * Thử 3 cách theo thứ tự:
 * 1. GET /{psid}?fields=name,picture  (cần pages_messaging permission)
 * 2. GET /me/conversations?user_id={psid}&fields=participants  (lấy tên từ participant)
 * 3. Trả về chuỗi rỗng (Getfly sẽ dùng SĐT làm tên)
 */
export async function getSenderProfile(
  senderId: string,
  pageToken: string
): Promise<SenderProfile> {
  // ── Cách 1: direct profile lookup ─────────────────────────────────────────
  try {
    const data = await fbFetch<{
      name?: string;
      id: string;
      picture?: { data: { url: string; is_silhouette: boolean } };
    }>(`/${senderId}`, pageToken, {
      fields: "name,picture.width(200).height(200)",
    });

    if (data.name) {
      const pic = data.picture?.data;
      return {
        name: data.name,
        pictureUrl: pic && !pic.is_silhouette ? pic.url : null,
      };
    }
  } catch (err) {
    console.warn("[Facebook] Profile lookup thất bại, thử conversation participants:", err instanceof Error ? err.message : err);
  }

  // ── Cách 2: lấy tên từ danh sách participants của conversation ─────────────
  try {
    const convData = await fbFetch<{
      data: Array<{
        participants: { data: Array<{ id: string; name: string }> };
      }>;
    }>("/me/conversations", pageToken, {
      user_id: senderId,
      fields: "participants",
      limit: "1",
      platform: "MESSENGER",
    });

    const participant = convData.data?.[0]?.participants?.data?.find(
      (p) => p.id === senderId
    );
    if (participant?.name) {
      console.log(`[Facebook] Lấy tên từ conversation participants: ${participant.name}`);
      return { name: participant.name, pictureUrl: null };
    }
  } catch (err) {
    console.warn("[Facebook] Conversation participants thất bại:", err instanceof Error ? err.message : err);
  }

  return { name: "", pictureUrl: null };
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
  pageToken: string,
  pageId?: string
): Promise<string | null> {
  const cacheKey = `comment:${pageId ? `${pageId}_` : ""}${postId}`;
  const cached = postCommentCache.get(cacheKey) ?? postCommentCache.get(postId);
  if (cached && Date.now() - cached.fetchedAt < COMMENT_CACHE_TTL_MS) {
    return cached.text;
  }

  const candidateIds: string[] = [];
  if (!postId.includes("_") && pageId) {
    candidateIds.push(`${pageId}_${postId}`);
  } else {
    candidateIds.push(postId);
  }

  for (const id of candidateIds) {
    try {
      const data = await fbFetch<{
        data: Array<{ message: string }>;
      }>(`/${id}/comments`, pageToken, {
        filter: "stream",
        order: "ranked",
        limit: "3",
        fields: "message",
      });

      const firstComment = data.data?.[0]?.message ?? null;
      if (firstComment) {
        postCommentCache.set(cacheKey, { text: firstComment, fetchedAt: Date.now() });
        postCommentCache.set(postId, { text: firstComment, fetchedAt: Date.now() });
        return firstComment;
      }
    } catch {
      // Thử tiếp ID tiếp theo nếu có
    }
  }

  return null;
}

/**
 * Lấy caption từ Photo ID của Facebook (nếu bài quảng cáo là một Photo).
 */
export async function getPhotoText(
  photoId: string,
  pageToken: string
): Promise<string | null> {
  try {
    const data = await fbFetch<{ name?: string }>(`/${photoId}`, pageToken, {
      fields: "name",
    });
    const text = data.name?.trim() || null;
    if (text) {
      console.log(`[Facebook] Đã lấy caption từ photo_id=${photoId} (${text.length} kí tự): ${text.slice(0, 100)}...`);
    }
    return text;
  } catch {
    return null;
  }
}

/**
 * Trích xuất photo_id từ URL ảnh Facebook CDN.
 * Ví dụ URL: .../770183013_1494693706030690_1095200386841518000_n.jpg -> 1494693706030690
 */
export function extractPhotoIdFromUrl(photoUrl?: string): string | null {
  if (!photoUrl) return null;
  const match = photoUrl.match(/_(\d{10,20})_\d+_[a-z0-9]+\.jpg/i);
  return match ? match[1] : null;
}

/**
 * Lấy nội dung văn bản (message/story/attachments/photo caption) của một bài đăng Facebook.
 * Sử dụng trường hợp lệ trên Graph API v20+ và hỗ trợ fallback Photo Caption.
 */
export async function getPostText(
  postId: string,
  pageToken: string,
  pageId?: string,
  photoUrl?: string
): Promise<string | null> {
  const cacheKey = `post_text:${pageId ? `${pageId}_` : ""}${postId}`;
  const cached = postCommentCache.get(cacheKey) ?? postCommentCache.get(`post_text:${postId}`);
  if (cached && Date.now() - cached.fetchedAt < COMMENT_CACHE_TTL_MS) {
    return cached.text;
  }

  // 1. Thử đọc Post Object: {pageId}_{postId}
  const formattedPostId = !postId.includes("_") && pageId ? `${pageId}_${postId}` : postId;
  let lastError: unknown = null;

  try {
    const data = await fbFetch<{
      message?: string;
      story?: string;
      attachments?: {
        data?: Array<{ title?: string; description?: string }>;
      };
    }>(`/${formattedPostId}`, pageToken, {
      fields: "message,story,attachments{title,description}",
    });

    const attachmentTexts = data.attachments?.data?.map((a) => [a.title, a.description]).flat() || [];
    const textParts = [data.message, data.story, ...attachmentTexts]
      .filter((t): t is string => Boolean(t && t.trim()))
      .join(" ");

    const postText = textParts.trim() || null;
    if (postText) {
      postCommentCache.set(cacheKey, { text: postText, fetchedAt: Date.now() });
      postCommentCache.set(`post_text:${postId}`, { text: postText, fetchedAt: Date.now() });
      console.log(`[Facebook] Đã lấy nội dung post_id=${formattedPostId} (${postText.length} kí tự): ${postText.slice(0, 100)}...`);
      return postText;
    }
  } catch (err) {
    lastError = err;
  }

  // 2. Thử đọc Photo Caption từ photo_url (nếu có)
  const extractedPhotoId = extractPhotoIdFromUrl(photoUrl);
  if (extractedPhotoId) {
    const photoText = await getPhotoText(extractedPhotoId, pageToken);
    if (photoText) {
      postCommentCache.set(cacheKey, { text: photoText, fetchedAt: Date.now() });
      return photoText;
    }
  }

  // 3. Thử đọc trực tiếp postId như một Photo Object (nếu postId là ID của ảnh)
  const directPhotoText = await getPhotoText(postId, pageToken);
  if (directPhotoText) {
    postCommentCache.set(cacheKey, { text: directPhotoText, fetchedAt: Date.now() });
    return directPhotoText;
  }

  console.warn(
    `[Facebook] Không đọc được nội dung post_id=${postId}${pageId ? ` (pageId=${pageId})` : ""}:`,
    lastError instanceof Error ? lastError.message : lastError
  );
  return null;
}

/**
 * Lấy nội dung quảng cáo từ ad_id (Facebook Ad Creative).
 */
export async function getAdText(
  adId: string,
  pageToken: string
): Promise<string | null> {
  const cached = postCommentCache.get(`ad_text:${adId}`);
  if (cached && Date.now() - cached.fetchedAt < COMMENT_CACHE_TTL_MS) {
    return cached.text;
  }

  try {
    const data = await fbFetch<{
      name?: string;
      creative?: {
        body?: string;
        title?: string;
        object_story_id?: string;
        effective_object_story_id?: string;
      };
    }>(`/${adId}`, pageToken, {
      fields: "name,creative{body,title,object_story_id,effective_object_story_id}",
    });

    const creative = data.creative;
    const storyId = creative?.effective_object_story_id || creative?.object_story_id;
    if (storyId) {
      const storyText = await getPostText(storyId, pageToken);
      if (storyText) {
        postCommentCache.set(`ad_text:${adId}`, { text: storyText, fetchedAt: Date.now() });
        return storyText;
      }
    }

    const textParts = [creative?.title, creative?.body, data.name]
      .filter((t): t is string => Boolean(t && t.trim()))
      .join(" ");

    const adText = textParts.trim() || null;
    if (adText) {
      postCommentCache.set(`ad_text:${adId}`, { text: adText, fetchedAt: Date.now() });
      console.log(`[Facebook] Đã lấy nội dung ad_id=${adId} (${adText.length} kí tự)`);
    }
    return adText;
  } catch (err) {
    console.warn(`[Facebook] Không đọc được nội dung ad_id=${adId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Lấy nội dung văn bản quảng cáo tổng hợp từ referral (ưu tiên post_id, sau đó photo_url, sau đó ad_id).
 */
export async function getFBPostContent(
  referral: { post_id?: string; ad_id?: string; photo_url?: string },
  pageToken: string,
  pageId?: string
): Promise<string | null> {
  if (referral.post_id) {
    const postText = await getPostText(referral.post_id, pageToken, pageId, referral.photo_url);
    if (postText) return postText;
  }

  if (referral.photo_url) {
    const photoId = extractPhotoIdFromUrl(referral.photo_url);
    if (photoId) {
      const photoText = await getPhotoText(photoId, pageToken);
      if (photoText) return photoText;
    }
  }

  if (referral.ad_id) {
    const adText = await getAdText(referral.ad_id, pageToken);
    if (adText) return adText;
  }

  return null;
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
