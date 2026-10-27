// =============================================================================
// TAB 6: ALERTS & INCIDENT LOGS / TRIGGER RULES MODULE
// =============================================================================

let cachedIncidents = [];
let cachedRules = [];

// Khởi tạo các sự kiện cho Tab Cảnh báo & Thông báo
function initAlertsEvents() {
  document.getElementById('btnSimulateBreach')?.addEventListener('click', handleSimulateBreach);
  document.getElementById('btnExportIncidentsCsv')?.addEventListener('click', handleExportIncidentsCsv);
  document.getElementById('btnRefreshIncidents')?.addEventListener('click', () => {
    loadIncidents();
    loadTriggerRules();
    showToast('Đã làm mới dữ liệu sự cố và quy tắc', 'info');
  });
}

// Tải danh sách sự cố hệ thống
async function loadIncidents() {
  try {
    const res = await fetch('/api/incidents');
    if (!res.ok) return;
    const data = await res.json();
    cachedIncidents = data;
    renderIncidentsTable();
    updateIncidentStats();
  } catch (err) {
    console.error('Lỗi tải nhật ký sự cố:', err);
  }
}

// Cập nhật thống kê sự cố
function updateIncidentStats() {
  const total = cachedIncidents.length;
  const critical = cachedIncidents.filter(i => i.severity === 'CRITICAL').length;
  const active = cachedIncidents.filter(i => i.status === 'Active').length;

  const statTotal = document.getElementById('statTotalIncidents');
  const statCritical = document.getElementById('statCriticalIncidents');
  const statActive = document.getElementById('statActiveIncidents');

  if (statTotal) statTotal.textContent = total;
  if (statCritical) statCritical.textContent = critical;
  if (statActive) statActive.textContent = active;
}

// Hiển thị bảng nhật ký sự cố
function renderIncidentsTable() {
  const tbody = document.getElementById('incidentsTableBody');
  if (!tbody) return;

  const currentRole = window.getCurrentRole ? window.getCurrentRole() : 'guest';

  if (cachedIncidents.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:24px; color:var(--text-muted);">Không có sự cố nào được ghi nhận</td></tr>`;
    return;
  }

  tbody.innerHTML = cachedIncidents.map(inc => {
    let sevBadge = `<span class="badge" style="background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid #60a5fa;">INFO</span>`;
    if (inc.severity === 'CRITICAL') {
      sevBadge = `<span class="badge badge-danger" style="animation:pulse 2s infinite;"><i data-lucide="alert-octagon" style="width:12px;height:12px;"></i> KHẨN CẤP</span>`;
    } else if (inc.severity === 'WARNING') {
      sevBadge = `<span class="badge badge-warning"><i data-lucide="alert-triangle" style="width:12px;height:12px;"></i> CẢNH BÁO</span>`;
    }

    const isResolved = inc.status === 'Resolved';
    const statusBadge = isResolved
      ? `<span class="badge badge-normal"><i data-lucide="check" style="width:12px;height:12px;"></i> Đã xử lý</span>`
      : `<span class="badge badge-warning" style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid #ef4444;"><i data-lucide="alert-circle" style="width:12px;height:12px;"></i> Đang kích hoạt</span>`;

    const formattedTime = new Date(inc.timestamp).toLocaleTimeString('vi-VN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }) + ' ' + new Date(inc.timestamp).toLocaleDateString('vi-VN');

    return `
      <tr>
        <td><strong style="color:var(--accent-color); font-family:monospace;">${inc.id}</strong></td>
        <td style="font-size:0.8rem; color:var(--text-muted); font-family:monospace;">${formattedTime}</td>
        <td>
          <div style="font-weight:600; color:var(--text-main);">${inc.deviceName}</div>
          <div style="font-size:0.75rem; color:var(--text-sub);">ID: <code>${inc.deviceId}</code></div>
        </td>
        <td>${sevBadge}</td>
        <td>
          <span style="font-weight:700; color:#ef4444;">${inc.value}</span>
          <span style="font-size:0.75rem; color:var(--text-muted); margin-left:4px;">(Max: ${inc.threshold})</span>
        </td>
        <td style="font-size:0.82rem; color:var(--text-sub); max-width:280px; line-height:1.4;">${inc.actionTaken}</td>
        <td>${statusBadge}</td>
        <td style="text-align:right;">
          ${(!isResolved && currentRole === 'admin') ? `
            <button class="btn btn-primary btn-resolve-inc" data-id="${inc.id}" style="padding:4px 10px; font-size:0.78rem;">
              <i data-lucide="check-check" style="width:12px;height:12px;"></i> Đã Xử Lý
            </button>
          ` : `
            <span style="font-size:0.78rem; color:var(--text-muted);">${isResolved ? 'Hoàn tất' : 'Chỉ xem'}</span>
          `}
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();

  tbody.querySelectorAll('.btn-resolve-inc').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      await resolveIncident(id);
    });
  });
}

// Xử lý sự cố
async function resolveIncident(id) {
  try {
    const res = await fetch(`/api/incidents/${id}/resolve`, {
      method: 'POST',
      headers: window.getAuthHeaders ? window.getAuthHeaders() : {}
    });
    if (res.status === 403) {
      showToast('Cần quyền Admin để xác nhận xử lý sự cố!', 'warning');
      return;
    }
    const data = await res.json();
    if (res.ok) {
      showToast(`Đã đóng sự cố ${id}!`, 'success');
      loadIncidents();
    }
  } catch (err) {
    console.error(err);
  }
}

// Tải danh sách quy tắc cảnh báo
async function loadTriggerRules() {
  try {
    const res = await fetch('/api/trigger-rules');
    if (!res.ok) return;
    const data = await res.json();
    cachedRules = data;
    renderTriggerRules();
  } catch (err) {
    console.error('Lỗi tải quy tắc cảnh báo:', err);
  }
}

// Hiển thị danh sách quy tắc cảnh báo
function renderTriggerRules() {
  const container = document.getElementById('triggerRulesContainer');
  if (!container) return;

  const currentRole = window.getCurrentRole ? window.getCurrentRole() : 'guest';

  container.innerHTML = cachedRules.map(rule => {
    const isEnabled = rule.enabled;

    return `
      <div class="rule-card ${isEnabled ? 'rule-active' : ''}">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
          <div>
            <div style="font-weight:700; color:var(--text-main); font-size:0.92rem; display:flex; align-items:center; gap:6px;">
              <i data-lucide="shield-alert" style="width:15px;height:15px; color:${rule.severity === 'CRITICAL' ? '#ef4444' : '#f59e0b'};"></i>
              ${rule.name}
            </div>
            <div style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;">
              Mã quy tắc: <code>${rule.id}</code> • Mức độ: <strong style="color:${rule.severity === 'CRITICAL' ? '#ef4444' : '#f59e0b'};">${rule.severity}</strong>
            </div>
          </div>

          <label class="switch-toggle" title="${isEnabled ? 'Đang kích hoạt' : 'Đã vô hiệu hóa'}">
            <input type="checkbox" class="chk-rule-toggle" data-id="${rule.id}" ${isEnabled ? 'checked' : ''} ${currentRole !== 'admin' ? 'disabled' : ''}>
            <span class="slider"></span>
          </label>
        </div>

        <p style="font-size:0.82rem; color:var(--text-sub); line-height:1.5; margin-bottom:12px;">
          ${rule.description}
        </p>

        <div class="rule-meta-box">
          <div><span style="color:var(--text-muted);">Điều kiện:</span> <code style="color:#38bdf8;">${rule.condition}</code></div>
          <div><span style="color:var(--text-muted);">Email nhận:</span> <strong style="color:var(--accent-color);">${rule.targetEmail}</strong></div>
          <div><span style="color:var(--text-muted);">Rơ-le hành động:</span> <code>${rule.relayAction}</code></div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();

  container.querySelectorAll('.chk-rule-toggle').forEach(chk => {
    chk.addEventListener('change', async () => {
      const id = chk.getAttribute('data-id');
      const enabled = chk.checked;
      await toggleRule(id, enabled);
    });
  });
}

// Bật/tắt quy tắc
async function toggleRule(id, enabled) {
  try {
    const res = await fetch(`/api/trigger-rules/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(window.getAuthHeaders ? window.getAuthHeaders() : {})
      },
      body: JSON.stringify({ enabled })
    });
    if (res.status === 403) {
      showToast('Cần quyền Admin để bật/tắt quy tắc!', 'warning');
      loadTriggerRules();
      return;
    }
    const data = await res.json();
    if (res.ok) {
      showToast(`Đã ${enabled ? 'BẬT' : 'TẮT'} quy tắc ${id}`, 'info');
      loadTriggerRules();
    }
  } catch (err) {
    console.error(err);
  }
}

// Mô phỏng vi phạm quy tắc
async function handleSimulateBreach() {
  if (window.getCurrentRole && window.getCurrentRole() !== 'admin') {
    showToast('Chỉ tài khoản ADMIN mới có quyền mô phỏng vi phạm quy tắc!', 'warning');
    if (window.openLoginModal) window.openLoginModal();
    return;
  }

  const btn = document.getElementById('btnSimulateBreach');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-block;animation:spin 1s linear infinite;">⏳</span> Đang kích hoạt...';
  }

  try {
    const res = await fetch('/api/trigger-rules/simulate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(window.getAuthHeaders ? window.getAuthHeaders() : {})
      },
      body: JSON.stringify({ ruleId: 'RULE-01' })
    });

    const data = await res.json();
    if (res.ok) {
      showToast('Đã mô phỏng vượt ngưỡng: Relay đã BẬT, Sự cố được ghi nhận & Email SMTP đã gửi đi!', 'danger');
      loadIncidents();
      if (window.loadEmails) window.loadEmails();
      if (window.loadDevices) window.loadDevices();
    } else {
      showToast(data.error || 'Lỗi khi kích hoạt mô phỏng', 'warning');
    }
  } catch (err) {
    console.error(err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="zap"></i> Mô Phỏng Vi Phạm Quy Tắc';
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

// Xuất danh sách sự cố ra CSV
function handleExportIncidentsCsv() {
  if (!cachedIncidents || cachedIncidents.length === 0) {
    showToast('Không có dữ liệu sự cố để xuất!', 'warning');
    return;
  }

  let csv = 'Mã sự cố,Thời gian,Mã thiết bị,Tên thiết bị,Mức độ,Giá trị đo,Ngưỡng,Hành động,Trạng thái\n';
  cachedIncidents.forEach(i => {
    csv += `"${i.id}","${i.timestamp}","${i.deviceId}","${i.deviceName}","${i.severity}","${i.value}","${i.threshold}","${i.actionTaken}","${i.status}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `incident_report_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('Đã xuất báo cáo sự cố hệ thống ra file CSV!', 'success');
}

// Xuất các hàm ra phạm vi toàn cục
window.initAlertsEvents = initAlertsEvents;
window.loadIncidents = loadIncidents;
window.loadTriggerRules = loadTriggerRules;
window.handleNewIncidentFromSSE = function(inc) {
  cachedIncidents.unshift(inc);
  renderIncidentsTable();
  updateIncidentStats();
};
