// =============================================================================
// WEBMAIL & SMTP MULTI-DOMAIN MODULE (GIAO THỨC SMTP RFC 5321)
// =============================================================================

let cachedEmails = [];
let currentDomainFilter = 'all';

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

  countBadge.textContent = `${cachedEmails.length} Thư`;

  if (cachedEmails.length === 0) {
    container.innerHTML = `
      <div style="padding: 36px; text-align: center; color: var(--text-muted);">
        <i data-lucide="inbox" style="width: 36px; height: 36px; opacity: 0.5; margin-bottom: 8px;"></i>
        <p>Hộp thư rỗng</p>
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  container.innerHTML = cachedEmails.map(mail => {
    const isUnread = !mail.read;
    const dateFormatted = new Date(mail.date).toLocaleString('vi-VN', {
      hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric'
    });

    const isAlert = mail.subject.includes('CẢNH BÁO') || mail.subject.includes('BÁO ĐỘNG');

    return `
      <div class="mail-item ${isUnread ? 'unread' : ''}" data-id="${mail.id}">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <i data-lucide="${isAlert ? 'alert-octagon' : (isUnread ? 'mail' : 'mail-open')}" 
               style="width: 16px; height: 16px; color: ${isAlert ? '#ef4444' : (isUnread ? 'var(--accent-color)' : 'var(--text-sub)')};"></i>
            <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-main);">${mail.from}</span>
          </div>
          <span style="font-size: 0.75rem; color: var(--text-sub);">${dateFormatted}</span>
        </div>

        <div class="mail-subject" style="font-size: 0.92rem; margin-bottom: 4px; ${isAlert ? 'color:#ef4444; font-weight:700;' : ''}">
          ${mail.subject}
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; color: var(--text-muted);">
          <span>Gửi tới: <strong>${mail.to}</strong></span>
          <span class="badge" style="background:var(--bg-primary);">${mail.domain}</span>
        </div>
      </div>
    `;
  }).join('');

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

  // Mở modal soạn thư
  document.getElementById('btnOpenComposeMail')?.addEventListener('click', () => {
    if (window.getCurrentRole && window.getCurrentRole() !== 'admin') {
      window.showToast('Chỉ tài khoản ADMIN mới có quyền soạn và gửi email!', 'warning');
      return;
    }
    document.getElementById('modalComposeMail').classList.add('active');
  });

  // Submit E-form Soạn thư gửi qua SMTP cổng 2525
  document.getElementById('formComposeMail')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentRole = window.getCurrentRole ? window.getCurrentRole() : 'admin';
    if (currentRole !== 'admin') {
      window.showToast('Chỉ tài khoản ADMIN mới có quyền gửi thư SMTP!', 'warning');
      return;
    }

    const payload = {
      from: document.getElementById('mailFrom').value,
      to: document.getElementById('mailTo').value,
      subject: document.getElementById('mailSubject').value,
      body: document.getElementById('mailBody').value,
      role: currentRole
    };

    try {
      const res = await fetch('/api/emails/send', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User-Role': currentRole
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
        alert('Lỗi: ' + (err.error || 'Gửi thư thất bại'));
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Kích hoạt cảnh báo tự động gửi mail
  document.getElementById('btnTriggerAlertMail')?.addEventListener('click', async () => {
    const currentRole = window.getCurrentRole ? window.getCurrentRole() : 'admin';
    if (currentRole !== 'admin') {
      window.showToast('Chỉ tài khoản ADMIN mới có quyền kích hoạt cảnh báo thử nghiệm!', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/alerts/trigger-test', { 
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User-Role': currentRole
        },
        body: JSON.stringify({ role: currentRole })
      });
      if (res.ok) {
        window.showToast('Đã kích hoạt sự cố giả lập & tự động gửi mail SMTP cảnh báo!', 'warning');
        loadEmails();
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Xem chi tiết thư khi click
  document.getElementById('mailItemsContainer')?.addEventListener('click', async (e) => {
    const item = e.target.closest('.mail-item');
    if (!item) return;

    const mailId = item.getAttribute('data-id');
    const mail = cachedEmails.find(m => m.id === mailId);
    if (!mail) return;

    // Đánh dấu đã đọc
    fetch(`/api/emails/${mailId}/read`, { method: 'PUT' });
    mail.read = true;
    item.classList.remove('unread');

    document.getElementById('viewMailSubject').textContent = mail.subject;
    document.getElementById('viewMailFrom').textContent = mail.from;
    document.getElementById('viewMailTo').textContent = mail.to;
    document.getElementById('viewMailDate').textContent = new Date(mail.date).toLocaleString('vi-VN');
    document.getElementById('viewMailBody').textContent = mail.body;

    document.getElementById('modalViewMail').classList.add('active');
  });
}

window.loadEmails = loadEmails;
window.initMailEvents = initMailEvents;
