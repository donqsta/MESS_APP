/**
 * TNP Holdings — Web Form Tracker
 * Nhúng vào <head> mỗi website để bắt form submission và gửi lead về MESS_APP.
 *
 * Cách dùng — chỉ cần 1 dòng, endpoint tự suy ra từ src:
 *   <script src="https://YOUR_MESS_APP/form-tracker.js"
 *           data-site="Vạn Phúc City"></script>
 *
 * Hoặc qua Google Tag Manager (Custom HTML tag).
 */
(function () {
  'use strict';

  // ── Cấu hình từ script tag ──────────────────────────────────────────────────
  var currentScript = document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName('script');
      return scripts[scripts.length - 1];
    })();

  var SITE_NAME = (currentScript && currentScript.getAttribute('data-site')) || document.title || window.location.hostname;

  // Tự suy ra APP_URL từ src của script tag — không cần khai báo thêm biến nào.
  // Ví dụ: src="https://mess.tnp.vn/form-tracker.js" → APP_URL = "https://mess.tnp.vn"
  var APP_URL = (function () {
    var src = currentScript && currentScript.src;
    if (src) {
      try { return new URL(src).origin; } catch (e) {}
    }
    return window.location.origin; // fallback khi cùng domain
  })();

  var ENDPOINT = APP_URL + '/api/form-lead';

  console.log('[FormTracker] Loaded. ENDPOINT:', ENDPOINT, '| SITE:', SITE_NAME);

  // ── Session dedup: tránh gửi 2 lần cùng số điện thoại ─────────────────────
  var sentPhones = {};

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  }

  function getUTM() {
    var params = new URLSearchParams(window.location.search);
    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    var utm = {};
    keys.forEach(function (k) {
      utm[k] = params.get(k) || getCookie(k) || '';
    });
    return utm;
  }

  function normalizePhone(raw) {
    var digits = raw.replace(/[^\d+]/g, '');
    if (digits.startsWith('+84')) digits = '0' + digits.slice(3);
    if (/^84\d{9}$/.test(digits))  digits = '0' + digits.slice(2);
    return digits;
  }

  var VALID_PHONE = /^0(?:3[2-9]|5[2689]|7[06-9]|8[0-9]|9[0-9])\d{7}$/;

  function looksLikePhone(value) {
    return VALID_PHONE.test(normalizePhone(value.replace(/[\s.\-()']/g, '')));
  }

  // ── Extract dữ liệu từ form ─────────────────────────────────────────────────

  function extractFromForm(form) {
    var result = { name: '', phone: '', email: '', checkboxes: [] };
    var inputs = form.querySelectorAll('input, select, textarea');

    inputs.forEach(function (el) {
      var fieldName = (el.name || el.id || el.getAttribute('data-key') || '').toLowerCase();
      var value     = (el.value || '').trim();
      if (!value) return;

      // Checkbox / radio đã chọn → thêm vào description
      if ((el.type === 'checkbox' || el.type === 'radio') && el.checked) {
        result.checkboxes.push(value);
        return;
      }
      if (el.type === 'checkbox' || el.type === 'radio') return;

      // Phone: theo tên field hoặc pattern số Việt
      if (!result.phone && (
        /phone|sdt|dien_thoai|mobile|tel|so_dt|so_dien_thoai|dienthoai/.test(fieldName) ||
        looksLikePhone(value)
      )) {
        var normalized = normalizePhone(value.replace(/[\s.\-()']/g, ''));
        if (VALID_PHONE.test(normalized)) {
          result.phone = normalized;
          return;
        }
      }

      // Email
      if (!result.email && (
        /email|mail/.test(fieldName) ||
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      )) {
        result.email = value;
        return;
      }

      // Name: theo tên field (ưu tiên) hoặc text dài hơn 1 từ không phải số/email
      if (!result.name && (
        /name|ten|ho_ten|fullname|full_name|hovaten|first_name|ho_va_ten/.test(fieldName)
      )) {
        result.name = value;
      }
    });

    return result;
  }

  // ── Gửi về MESS_APP ─────────────────────────────────────────────────────────

  function sendLead(data) {
    if (!data.phone) return;
    if (sentPhones[data.phone]) return; // dedup trong session
    sentPhones[data.phone] = true;

    var utm    = getUTM();
    var hasAds = !!(utm.utm_source || utm.utm_campaign);

    var payload = {
      name:        data.name,
      phone:       data.phone,
      email:       data.email,
      description: data.checkboxes.join(', '),
      pageUrl:     window.location.href,
      siteName:    SITE_NAME,
      hasAds:      hasAds,
      utm:         utm,
    };

    // Non-blocking — luôn dùng fetch để nhìn được response trong console
    var json = JSON.stringify(payload);
    console.log('[FormTracker] Sending to:', ENDPOINT, payload);

    fetch(ENDPOINT, {
      method:    'POST',
      headers:   { 'Content-Type': 'application/json' },
      body:      json,
      keepalive: true,
    }).then(function (r) {
      return r.json().then(function (d) {
        console.log('[FormTracker] Response:', r.status, d);
      });
    }).catch(function (err) {
      console.error('[FormTracker] Fetch error:', err);
    });
  }

  // ── Lắng nghe form submit ───────────────────────────────────────────────────

  // Generic: bắt tất cả form submit
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    var data = extractFromForm(form);
    console.log('[FormTracker] Form submit detected. Extracted:', JSON.stringify(data));
    if (data.phone) {
      sendLead(data);
    } else {
      console.warn('[FormTracker] No valid phone found in form. Fields:', Array.from(form.querySelectorAll('input,textarea,select')).map(function(el){ return { name: el.name, value: el.value, type: el.type }; }));
    }
  }, true);

  // FluentForms: fire sau khi submit thành công
  document.addEventListener('fluentform_submission_success', function (e) {
    if (e.detail && e.detail.response && e.detail.response.data) {
      // formData nằm trong detail.formData hoặc phải extract lại từ form
      var form = e.target && e.target.closest ? e.target.closest('form') : null;
      if (form) {
        var data = extractFromForm(form);
        if (data.phone) sendLead(data);
      }
    }
  });

  // Elementor Forms: hook vào jQuery event nếu có
  if (window.jQuery) {
    window.jQuery(document).on('submit_success', '.elementor-form', function () {
      var data = extractFromForm(this);
      if (data.phone) sendLead(data);
    });
  }

  // Contact Form 7
  document.addEventListener('wpcf7mailsent', function (e) {
    if (e.detail && e.detail.inputs) {
      var name = '', phone = '', email = '', checkboxes = [];
      e.detail.inputs.forEach(function (input) {
        var n = (input.name || '').toLowerCase();
        var v = (input.value || '').trim();
        if (!v) return;
        if (/phone|sdt|tel|mobile/.test(n) || looksLikePhone(v)) {
          var norm = normalizePhone(v.replace(/[\s.\-()']/g, ''));
          if (VALID_PHONE.test(norm) && !phone) phone = norm;
        } else if (/email|mail/.test(n) && !email) {
          email = v;
        } else if (/name|ten/.test(n) && !name) {
          name = v;
        }
      });
      if (phone) sendLead({ name: name, phone: phone, email: email, checkboxes: checkboxes });
    }
  });

})();
