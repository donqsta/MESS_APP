# Mess App — Facebook Fanpage Messenger

Ứng dụng quản lý tin nhắn Messenger trên nhiều Facebook Fanpage, xây dựng bằng **Next.js 15** (App Router) + **Graph API v25.0**.

## Tính năng

- Đăng nhập Facebook OAuth (lấy Page Access Token tự động)
- Quản lý nhiều fanpage cùng lúc
- Đọc danh sách hội thoại Messenger
- Đọc nội dung tin nhắn (text + attachments)
- Trả lời tin nhắn trực tiếp từ app
- Nhận tin nhắn real-time qua Webhook + SSE

## Cài đặt

### 1. Tạo Facebook App

1. Vào [developers.facebook.com](https://developers.facebook.com) → Tạo app mới
2. Thêm sản phẩm **Messenger**
3. Trong App Settings → Basic: lấy **App ID** và **App Secret**
4. Thêm **Valid OAuth Redirect URIs**: `http://localhost:3000/api/auth/callback`
5. Request permissions: `pages_messaging`, `pages_read_engagement`, `pages_manage_metadata`, `pages_show_list`

### 2. Cấu hình môi trường

```bash
cp .env.example .env.local
```

Điền vào `.env.local`:

```env
FACEBOOK_APP_ID=your_app_id
FACEBOOK_APP_SECRET=your_app_secret
FACEBOOK_REDIRECT_URI=http://localhost:3000/api/auth/callback
WEBHOOK_VERIFY_TOKEN=your_random_token
SESSION_SECRET=your_32_char_random_secret
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Chạy app

```bash
npm install
npm run dev
```

Mở [http://localhost:3000](http://localhost:3000)

## Cài đặt Webhook (nhận tin real-time)

Webhook yêu cầu HTTPS public URL. Khi dev local, dùng [ngrok](https://ngrok.com):

```bash
ngrok http 3000
```

1. Copy URL ngrok (vd: `https://abc123.ngrok.io`)
2. Cập nhật `.env.local`: `NEXT_PUBLIC_APP_URL=https://abc123.ngrok.io`
3. Trong Meta Developer Console → Messenger → Webhooks:
   - **Callback URL**: `https://abc123.ngrok.io/api/webhook`
   - **Verify Token**: giá trị `WEBHOOK_VERIFY_TOKEN` trong `.env.local`
   - Subscribe fields: `messages`, `messaging_postbacks`
4. Subscribe fanpage vào webhook:
   ```bash
   curl -X POST "https://graph.facebook.com/v25.0/{PAGE_ID}/subscribed_apps?subscribed_fields=messages&access_token={PAGE_ACCESS_TOKEN}"
   ```

## Cấu trúc thư mục

```
app/
  login/              # Trang đăng nhập
  dashboard/
    [pageId]/         # 3-pane layout: nav + conv list + thread
      [conversationId]/  # Chi tiết hội thoại
  api/
    auth/facebook/    # Redirect OAuth
    auth/callback/    # Nhận token
    auth/logout/      # Đăng xuất
    pages/            # List + refresh pages
    conversations/    # GET conversations
    messages/         # GET messages
    reply/            # POST gửi tin
    webhook/          # Meta webhook endpoint
    events/           # SSE real-time
lib/
  facebook.ts         # Graph API wrapper
  session.ts          # iron-session
  webhook-store.ts    # In-memory SSE pub/sub
  time.ts             # Format time helpers
components/
  PageSwitcher.tsx
  ConversationList.tsx
  MessageThread.tsx
  ReplyBox.tsx
```

## Giới hạn cần biết

- **Rate limit**: Graph API có giới hạn 80,000 calls/24h per page
- **Webhook**: Chỉ hoạt động với HTTPS, không hỗ trợ `localhost` trực tiếp
- **In-memory SSE**: `webhook-store.ts` dùng Map trong RAM → không scale khi nhiều server instance. Production nên dùng Redis Pub/Sub.
- **Message tags**: Từ 27/04/2026, một số tag bị Meta giới hạn → app dùng `messaging_type: "RESPONSE"` (chỉ hợp lệ trong 24h sau tin nhắn cuối của user)
