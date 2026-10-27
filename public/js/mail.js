// =============================================================================
// WEBMAIL & SMTP MULTI-DOMAIN MODULE (GIAO THỨC SMTP RFC 5321)
// =============================================================================

let cachedEmails = [];
let currentDomainFilter = 'all';
let selectedMailId = null;

// Giải mã MIME Header RFC 2047 (=?UTF-8?B?...?= hoặc =?UTF-8?Q?...?=)
function decodeMimeWord(str) {
  if (!str) return '';
  return str.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (match, charset, encoding, text) => {
    try {
      const enc = encoding.toUpperCase();
      if (enc === 'B') {
        const bin = atob(text);
        const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
        return new TextDecoder(charset).decode(bytes);
      } else if (enc === 'Q') {
        const hexDecoded = text.replace(/_/g, ' ').replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => {
          return String.fromCharCode(parseInt(hex, 16));
        });
        const bytes = Uint8Array.from(hexDecoded, c => c.charCodeAt(0));
        return new TextDecoder(charset).decode(bytes);
      }
    } catch (e) {
      return text;
    }
    return match;
  });
}

// Giải mã Quoted-Printable cho nội dung thư
function decodeQuotedPrintableText(str) {
  if (!str || !str.includes('=')) return str;
  try {
    let s = str.replace(/=\r?\n/g, '');
    const bytes = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '=' && i + 2 < s.length && /[0-9A-Fa-f]{2}/.test(s.substr(i + 1, 2))) {
        bytes.push(parseInt(s.substr(i + 1, 2), 16));
        i += 2;
      } else {
        bytes.push(s.charCodeAt(i));
      }
    }
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  } catch (e) {
    return str;
  }
}

// Hàm chuẩn hóa làm sạch text tiêu đề và nội dung email
function cleanEmailText(text) {
  if (!text) return '';
  let cleaned = String(text).replace(/\r?\n[ \t]+/g, ' ');
  cleaned = cleaned.replace(/(=\?[^?]+\?[BQbq]\?[^?]*\?=)\s+(=\?[^?]+\?[BQbq]\?[^?]*\?=)/g, '$1$2');
  if (cleaned.includes('=?')) {
    cleaned = decodeMimeWord(cleaned);
  }
  if (cleaned.includes('=E1=') || cleaned.includes('=C3=') || cleaned.includes('=\r\n') || cleaned.includes('=\n')) {
    cleaned = decodeQuotedPrintableText(cleaned);
  }
  return cleaned;
}

async function loadEmails() {
  try {
    const res = await fetch(`/api/emails?domain=${currentDomainFilter}`);
    const data = await res.json();
    cachedEmails = data.emails || [];
    renderMailList();
  } catch (err) {
    console.error('Lỗi khi tải danh sách email:', err);
  }
}

function renderMailList() {
  const container = document.getElementById('mailItemsContainer');
  const countBadge = document.getElementById('mailCountBadge');
  if (!container) return;

  const searchQuery = (document.getElementById('mailSearchInput')?.value || '').toLowerCase();

  const filtered = cachedEmails.filter(m => {
    const s = cleanEmailText(m.subject).toLowerCase();
    const f = cleanEmailText(m.from).toLowerCase();
    const t = cleanEmailText(m.to).toLowerCase();
    const b = cleanEmailText(m.body).toLowerCase();
    return s.includes(searchQuery) || f.includes(searchQuery) || t.includes(searchQuery) || b.includes(searchQuery);
  });

  countBadge.textContent = `${filtered.length} Thư`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="padding: 36px; text-align: center; color: var(--text-muted);">
        <i data-lucide="inbox" style="width: 36px; height: 36px; opacity: 0.5; margin-bottom: 8px;"></i>
        <p>Không có thư nào</p>
      </div>
    `;
    const emptyPane = document.getElementById('mailPreviewEmpty');
    const contentPane = document.getElementById('mailPreviewContent');
    if (emptyPane) emptyPane.style.display = 'flex';
    if (contentPane) contentPane.style.display = 'none';
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  container.innerHTML = filtered.map(mail => {
    const isUnread = !mail.read;
    const isSelected = mail.id === selectedMailId;
    const dateFormatted = new Date(mail.date).toLocaleString('vi-VN', {
      hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit'
    });

    const displaySubject = cleanEmailText(mail.subject);
    const displayFrom = cleanEmailText(mail.from);
    const displayTo = cleanEmailText(mail.to);
    const isAlert = displaySubject.includes('CẢNH BÁO') || displaySubject.includes('BÁO ĐỘNG');

    return `
      <div class="mail-item ${isUnread ? 'unread' : ''} ${isSelected ? 'selected-mail' : ''}" data-id="${mail.id}">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <i data-lucide="${isAlert ? 'alert-octagon' : (isUnread ? 'mail' : 'mail-open')}" 
               style="width: 15px; height: 15px; color: ${isAlert ? '#ef4444' : (isUnread ? 'var(--accent-color)' : 'var(--text-sub)')};"></i>
            <span style="font-size: 0.84rem; font-weight: 600; color: var(--text-main);">${displayFrom}</span>
          </div>
          <span style="font-size: 0.72rem; color: var(--text-sub);">${dateFormatted}</span>
        </div>

        <div class="mail-subject" style="font-size: 0.88rem; margin-bottom: 4px; ${isAlert ? 'color:#ef4444; font-weight:700;' : ''}">
          ${displaySubject}
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; color: var(--text-muted);">
          <span>Tới: <strong>${displayTo}</strong></span>
          <span class="badge" style="background:var(--bg-primary); font-size:0.7rem;">${mail.domain}</span>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();

  // Tự động chọn email đầu tiên nếu chưa chọn hoặc email đã chọn không còn trong danh sách lọc
  if (!selectedMailId || !filtered.some(m => m.id === selectedMailId)) {
    if (filtered.length > 0) {
      selectEmail(filtered[0].id, false);
    }
  } else {
    selectEmail(selectedMailId, false);
  }
}

// Hàm chọn và hiển thị email lên Preview Pane
function selectEmail(mailId, markAsRead = true) {
  selectedMailId = mailId;
  const mail = cachedEmails.find(m => m.id === mailId);
  if (!mail) return;

  // Cập nhật highlight trong danh sách bên trái
  document.querySelectorAll('.mail-item').forEach(el => {
    if (el.getAttribute('data-id') === mailId) {
      el.classList.add('selected-mail');
    } else {
      el.classList.remove('selected-mail');
    }
  });

  // Đánh dấu đã đọc trên server và giao diện
  if (markAsRead && !mail.read) {
    fetch(`/api/emails/${mailId}/read`, { method: 'PUT' });
    mail.read = true;
    const itemEl = document.querySelector(`.mail-item[data-id="${mailId}"]`);
    if (itemEl) itemEl.classList.remove('unread');
  }

  // Ẩn empty state và hiển thị nội dung trên Preview Pane
  const emptyPane = document.getElementById('mailPreviewEmpty');
  const contentPane = document.getElementById('mailPreviewContent');
  if (emptyPane) emptyPane.style.display = 'none';
  if (contentPane) contentPane.style.display = 'flex';

  const subject = cleanEmailText(mail.subject);
  const from = cleanEmailText(mail.from);
  const to = cleanEmailText(mail.to);
  const body = cleanEmailText(mail.body);
  const isAlert = subject.includes('CẢNH BÁO') || subject.includes('BÁO ĐỘNG');

  const subjectEl = document.getElementById('previewMailSubject');
  if (subjectEl) {
    subjectEl.textContent = subject;
    subjectEl.style.color = isAlert ? '#ef4444' : 'var(--text-main)';
  }

  const fromEl = document.getElementById('previewMailFrom');
  if (fromEl) fromEl.textContent = from;

  const toEl = document.getElementById('previewMailTo');
  if (toEl) toEl.textContent = to;

  const dateEl = document.getElementById('previewMailDate');
  if (dateEl) {
    dateEl.textContent = new Date(mail.date).toLocaleString('vi-VN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
  }

  const bodyEl = document.getElementById('previewMailBody');
  if (bodyEl) bodyEl.textContent = body;

  const avatarEl = document.getElementById('previewSenderAvatar');
  if (avatarEl) {
    const rawName = from.split('@')[0].replace(/[^a-zA-Z0-9]/g, '');
    avatarEl.textContent = (rawName.charAt(0) || 'M').toUpperCase();
  }

  const domainBadge = document.getElementById('previewMailDomainBadge');
  if (domainBadge) {
    domainBadge.textContent = `@${mail.domain}`;
  }

  const alertBadge = document.getElementById('previewMailAlertBadge');
  if (alertBadge) {
    alertBadge.style.display = isAlert ? 'inline-flex' : 'none';
  }

  const alertBanner = document.getElementById('previewAlertBanner');
  if (alertBanner) {
    alertBanner.style.display = isAlert ? 'flex' : 'none';
  }

  // Chuẩn bị sẵn dữ liệu cho modal xem thư độc lập nếu người dùng muốn phóng to
  document.getElementById('viewMailSubject').textContent = subject;
  document.getElementById('viewMailFrom').textContent = from;
  document.getElementById('viewMailTo').textContent = to;
  document.getElementById('viewMailDate').textContent = new Date(mail.date).toLocaleString('vi-VN');
  document.getElementById('viewMailBody').textContent = body;

  if (window.lucide) window.lucide.createIcons();
}

function initMailEvents() {
  // Bộ lọc theo domain
  document.querySelectorAll('.mail-sidebar button[data-domain]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mail-sidebar button[data-domain]').forEach(b => {
        b.style.borderColor = 'var(--border-color)';
        b.style.background = 'var(--bg-card)';
      });
      btn.style.borderColor = 'var(--accent-color)';
      btn.style.background = 'var(--accent-light)';

      currentDomainFilter = btn.getAttribute('data-domain');
      loadEmails();
    });
  });

  // Tìm kiếm email nhanh trong danh sách
  document.getElementById('mailSearchInput')?.addEventListener('input', () => {
    renderMailList();
  });

  // Mở modal soạn thư
  document.getElementById('btnOpenComposeMail')?.addEventListener('click', () => {
    if (window.getCurrentRole && window.getCurrentRole() !== 'admin') {
      window.showToast('Vui lòng đăng nhập quyền ADMIN để soạn và gửi email!', 'warning');
      if (window.openLoginModal) window.openLoginModal();
      return;
    }
    document.getElementById('modalComposeMail').classList.add('active');
  });

  // Submit E-form Soạn thư gửi qua SMTP cổng 2525
  document.getElementById('formComposeMail')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentRole = window.getCurrentRole ? window.getCurrentRole() : 'guest';
    if (currentRole !== 'admin') {
      window.showToast('Chỉ tài khoản ADMIN mới có quyền gửi thư SMTP!', 'warning');
      if (window.openLoginModal) window.openLoginModal();
      return;
    }

    const payload = {
      from: document.getElementById('mailFrom').value,
      to: document.getElementById('mailTo').value,
      subject: document.getElementById('mailSubject').value,
      body: document.getElementById('mailBody').value
    };

    try {
      const authHeaders = window.getAuthHeaders ? window.getAuthHeaders() : {};
      const res = await fetch('/api/emails/send', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        document.getElementById('modalComposeMail').classList.remove('active');
        document.getElementById('formComposeMail').reset();
        window.showToast('Đã gửi email thành công qua giao thức SMTP (cổng 2525)!', 'success');
        loadEmails();
      } else {
        const err = await res.json();
        window.showToast(err.error || 'Gửi thư thất bại', 'warning');
        if (res.status === 403 && window.openLoginModal) window.openLoginModal();
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Kích hoạt cảnh báo tự động gửi mail
  document.getElementById('btnTriggerAlertMail')?.addEventListener('click', async () => {
    const currentRole = window.getCurrentRole ? window.getCurrentRole() : 'guest';
    if (currentRole !== 'admin') {
      window.showToast('Chỉ tài khoản ADMIN mới có quyền kích hoạt cảnh báo thử nghiệm!', 'warning');
      if (window.openLoginModal) window.openLoginModal();
      return;
    }

    try {
      const authHeaders = window.getAuthHeaders ? window.getAuthHeaders() : {};
      const res = await fetch('/api/alerts/trigger-test', { 
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify({})
      });
      if (res.ok) {
        window.showToast('Đã kích hoạt sự cố giả lập & tự động gửi mail SMTP cảnh báo!', 'warning');
        loadEmails();
      } else {
        const err = await res.json();
        window.showToast(err.error || 'Không thể kích hoạt', 'warning');
        if (res.status === 403 && window.openLoginModal) window.openLoginModal();
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Xem chi tiết thư trong Preview Pane khi click
  document.getElementById('mailItemsContainer')?.addEventListener('click', (e) => {
    const item = e.target.closest('.mail-item');
    if (!item) return;

    const mailId = item.getAttribute('data-id');
    selectEmail(mailId, true);
  });

  // Trả lời thư từ Preview Pane
  document.getElementById('btnReplyMail')?.addEventListener('click', () => {
    if (window.getCurrentRole && window.getCurrentRole() !== 'admin') {
      window.showToast('Vui lòng đăng nhập quyền ADMIN để gửi email SMTP!', 'warning');
      if (window.openLoginModal) window.openLoginModal();
      return;
    }
    const mail = cachedEmails.find(m => m.id === selectedMailId);
    if (!mail) return;

    document.getElementById('mailTo').value = mail.from;
    document.getElementById('mailFrom').value = mail.to || 'manager@monitoring-lab.vn';
    const cleanSubj = cleanEmailText(mail.subject);
    document.getElementById('mailSubject').value = cleanSubj.startsWith('Re: ') ? cleanSubj : `Re: ${cleanSubj}`;
    document.getElementById('mailBody').value = `\n\n--- Phản hồi thư từ ${mail.from} ngày ${new Date(mail.date).toLocaleString('vi-VN')} ---\n> ${cleanEmailText(mail.body).replace(/\n/g, '\n> ')}`;

    document.getElementById('modalComposeMail').classList.add('active');
  });

  // Đánh dấu chưa đọc từ Preview Pane
  document.getElementById('btnToggleUnread')?.addEventListener('click', () => {
    const mail = cachedEmails.find(m => m.id === selectedMailId);
    if (!mail) return;
    mail.read = !mail.read;
    const itemEl = document.querySelector(`.mail-item[data-id="${selectedMailId}"]`);
    if (itemEl) {
      if (!mail.read) {
        itemEl.classList.add('unread');
        window.showToast('Đã đánh dấu thư là chưa đọc', 'info');
      } else {
        itemEl.classList.remove('unread');
        window.showToast('Đã đánh dấu thư là đã đọc', 'info');
      }
    }
  });

  // In nội dung email
  document.getElementById('btnPrintMail')?.addEventListener('click', () => {
    window.print();
  });

  // Mở rộng modal toàn màn hình
  document.getElementById('btnExpandModalMail')?.addEventListener('click', () => {
    if (selectedMailId) {
      document.getElementById('modalViewMail').classList.add('active');
    }
  });
}

window.loadEmails = loadEmails;
window.renderMailList = renderMailList;
window.selectEmail = selectEmail;
window.initMailEvents = initMailEvents;
