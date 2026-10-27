// =============================================================================
// DEVICES & TELEMETRY MODULE (DATA TABLE, E-FORMS CRUD & BUSINESS LOGIC)
// =============================================================================

let cachedDevices = [];
const pingingDevices = new Set();
const deviceLatencyCache = {};

// Helper: Phân loại mức độ độ trễ Latency/RTT
function getLatencyClass(val) {
  if (val === null || val === undefined || isNaN(val)) return 'unknown';
  if (val < 2) return 'ultra-fast'; // < 2ms: Cực nhanh
  if (val < 20) return 'good';       // 2-20ms: Tốt
  if (val < 80) return 'warning';    // 20-80ms: Trung bình
  return 'danger';                   // > 80ms: Cao
}

// Helper: Hiển thị badge độ trễ và thời gian phản hồi
function renderLatencyBadge(dev) {
  const cached = deviceLatencyCache[dev.id];
  const latency = cached !== undefined ? cached.latency : (dev.latency !== undefined ? Number(dev.latency) : 1.25);
  const cls = getLatencyClass(latency);
  
  let statusText = 'Tuyệt vời';
  if (cls === 'ultra-fast') statusText = 'Tuyệt vời';
  else if (cls === 'good') statusText = 'Tốt';
  else if (cls === 'warning') statusText = 'Trung bình';
  else statusText = 'Chậm';

  return `
    <span class="latency-indicator ${cls}" title="Độ trễ ICMP RTT: ${latency.toFixed(2)} ms (${statusText})">
      <span class="latency-dot"></span>
      <span class="latency-val">RTT: <strong>${latency.toFixed(2)} ms</strong></span>
      <span class="latency-tag">${statusText}</span>
    </span>
  `;
}

// Cập nhật lại khung độ trễ của riêng một dòng mà không cần render lại toàn bộ bảng
function updateDeviceLatencyRow(devId, latencyNum, statusNote = '') {
  const box = document.getElementById(`latency-box-${devId}`);
  if (!box) return;

  if (latencyNum === null || latencyNum === undefined || isNaN(latencyNum)) {
    box.innerHTML = `
      <span class="latency-indicator danger">
        <span class="latency-dot"></span>
        <span class="latency-text">Mất kết nối / Timeout</span>
      </span>
    `;
    return;
  }

  const cls = getLatencyClass(latencyNum);
  let statusText = 'Tuyệt vời';
  if (cls === 'ultra-fast') statusText = 'Tuyệt vời';
  else if (cls === 'good') statusText = 'Tốt';
  else if (cls === 'warning') statusText = 'Trung bình';
  else statusText = 'Chậm';

  box.innerHTML = `
    <span class="latency-indicator ${cls}" title="Độ trễ ICMP RTT: ${latencyNum.toFixed(2)} ms (${statusText})">
      <span class="latency-dot"></span>
      <span class="latency-val">RTT: <strong>${latencyNum.toFixed(2)} ms</strong></span>
      <span class="latency-tag">${statusText}</span>
    </span>
    ${statusNote ? `<span style="font-size:0.68rem; color:var(--text-muted); font-family:monospace;">• ${statusNote}</span>` : ''}
  `;
}

// Gửi yêu cầu ICMP Ping tức thời tới thiết bị khi nhấn nút "Ping ngay"
async function triggerDevicePing(devId, devIp, btnElement) {
  if (pingingDevices.has(devId)) return;
  pingingDevices.add(devId);

  // Đổi trạng thái hiển thị của nút
  if (btnElement) {
    btnElement.disabled = true;
    btnElement.classList.add('pinging');
    btnElement.innerHTML = `<span class="spin-icon" style="display:inline-block;animation:spin 1s linear infinite;">⏳</span> Ping...`;
  }

  const box = document.getElementById(`latency-box-${devId}`);
  if (box) {
    box.innerHTML = `
      <span class="latency-indicator pinging">
        <span class="latency-dot"></span>
        <span class="latency-val">Đang gửi gói tin ICMP...</span>
      </span>
    `;
  }

  try {
    const authHeaders = window.getAuthHeaders ? window.getAuthHeaders() : {};
    const res = await fetch(`/api/devices/${devId}/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders }
    });

    if (res.ok) {
      const data = await res.json();
      const latencyVal = Number(data.latency);
      deviceLatencyCache[devId] = {
        latency: latencyVal,
        rtt: data.rtt,
        lastPingTime: new Date().toLocaleTimeString('vi-VN')
      };

      const dev = cachedDevices.find(d => d.id === devId);
      if (dev) {
        dev.latency = latencyVal;
        dev.lastPingTime = new Date().toISOString();
      }

      updateDeviceLatencyRow(devId, latencyVal, '0% mất gói');
      window.showToast(`[ICMP Ping] ${dev ? dev.name : devId} (${devIp}): Phản hồi trong ${data.latency} ms (RTT)`, 'success');

      // Ghi log vào Quick Terminal ở Tab 2
      const quickTerm = document.getElementById('quickTerminalOutput');
      if (quickTerm) {
        quickTerm.textContent += `\n[${new Date().toLocaleTimeString('vi-VN')}] [ICMP PING] ${devIp}: RTT = ${data.latency} ms, Packet Loss = 0%`;
        quickTerm.scrollTop = quickTerm.scrollHeight;
      }
    } else {
      const err = await res.json();
      window.showToast(err.error || 'Lỗi kiểm tra kết nối', 'warning');
      updateDeviceLatencyRow(devId, null, 'Không phản hồi');
    }
  } catch (err) {
    console.error('Lỗi khi ping thiết bị:', err);
    window.showToast(`Lỗi mạng khi ping ${devIp}: ${err.message}`, 'danger');
    updateDeviceLatencyRow(devId, null, 'Lỗi mạng');
  } finally {
    pingingDevices.delete(devId);
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.classList.remove('pinging');
      btnElement.innerHTML = `<i data-lucide="activity" style="width:11px;height:11px;"></i> Ping ngay`;
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

// Tải danh sách thiết bị từ Back-end
async function loadDevices() {
  try {
    const res = await fetch('/api/devices');
    const data = await res.json();
    cachedDevices = data;
    renderDevicesTable();
    updatePushDeviceDropdown();
    loadStats();
  } catch (err) {
    console.error('Lỗi khi tải danh sách thiết bị:', err);
  }
}

// Tải thống kê KPI
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();
    
    document.getElementById('kpiTotalDevices').textContent = stats.totalDevices || 0;
    document.getElementById('kpiNormalCount').textContent = stats.normalCount || 0;
    document.getElementById('kpiWarningCount').textContent = stats.warningCount || 0;
    document.getElementById('kpiAvgMetrics').textContent = `${stats.avgTemperature}°C / ${stats.totalNetworkLoad}M`;

    // Cập nhật biểu đồ tròn
    if (window.updateDoughnutChart) {
      window.updateDoughnutChart(stats.normalCount || 0, stats.warningCount || 0);
    }
  } catch (err) {
    console.error('Lỗi khi tải thống kê:', err);
  }
}

// Hiển thị dữ liệu lên bảng với tìm kiếm và lọc
function renderDevicesTable() {
  const tbody = document.getElementById('devicesTableBody');
  if (!tbody) return;

  const searchQuery = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const statusFilter = document.getElementById('filterStatus')?.value || 'all';
  const typeFilter = document.getElementById('filterType')?.value || 'all';
  const currentRole = window.getCurrentRole ? window.getCurrentRole() : 'admin';

  const filtered = cachedDevices.filter(dev => {
    const matchSearch = dev.name.toLowerCase().includes(searchQuery) || 
                        dev.id.toLowerCase().includes(searchQuery) || 
                        dev.location.toLowerCase().includes(searchQuery);
    const matchStatus = (statusFilter === 'all') || (dev.status === statusFilter);
    const matchType = (typeFilter === 'all') || (dev.type === typeFilter);
    return matchSearch && matchStatus && matchType;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding: 24px; color: var(--text-muted);">Không tìm thấy thiết bị nào phù hợp</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(dev => {
    const isWarning = dev.status === 'Warning';
    const statusBadge = isWarning 
      ? `<span class="badge badge-warning"><i data-lucide="alert-triangle" style="width:12px;height:12px;"></i> Cảnh Báo</span>` 
      : `<span class="badge badge-normal"><i data-lucide="check" style="width:12px;height:12px;"></i> An Toàn</span>`;

    const isRelayOn = dev.relayStatus === 'ON';
    const relayBadge = isRelayOn
      ? `<span class="badge badge-relay-on"><i data-lucide="zap" style="width:11px;height:11px;"></i> BẬT</span>`
      : `<span class="badge badge-relay-off"><i data-lucide="zap-off" style="width:11px;height:11px;"></i> TẮT</span>`;

    const updatedFormatted = new Date(dev.lastUpdated).toLocaleTimeString('vi-VN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const isPinging = pingingDevices.has(dev.id);
    const latencyHtml = renderLatencyBadge(dev);

    const actionButtons = `
      <div style="display: flex; gap: 6px; justify-content: flex-end;">
        <button class="btn btn-primary btn-control-dev" data-id="${dev.id}" style="padding: 5px 12px; font-size: 0.82rem; font-weight: 600;" title="Kích hoạt bảng gửi lệnh điều khiển (Ping, Reboot, Relay...)">
          <i data-lucide="terminal" style="width:14px;height:14px;"></i> Lệnh
        </button>
        ${currentRole === 'admin' ? `
          <button class="btn btn-danger btn-delete-dev" data-id="${dev.id}" style="padding: 5px 9px; font-size: 0.82rem;" title="Xóa thiết bị (Admin)">
            <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
          </button>
        ` : ''}
      </div>
    `;

    return `
      <tr id="row-${dev.id}">
        <td><strong style="color:var(--accent-color);">${dev.id}</strong></td>
        <td>
          <div style="font-weight: 600; color: var(--text-main);">${dev.name}</div>
          <div style="font-size: 0.75rem; color: var(--text-muted); display:flex; align-items:center; gap:4px; margin-top:2px;">
            <i data-lucide="map-pin" style="width:11px;height:11px;"></i> ${dev.location}
          </div>
        </td>
        <td class="ip-latency-cell">
          <div class="ip-address-row">
            <span class="ip-badge"><i data-lucide="network" style="width:12px;height:12px;"></i> ${dev.ipAddress}</span>
            <button class="btn-ping-now ${isPinging ? 'pinging' : ''}" data-id="${dev.id}" data-ip="${dev.ipAddress}" title="Gửi gói tin ICMP Ping kiểm tra kết nối tới ${dev.ipAddress}" ${isPinging ? 'disabled' : ''}>
              ${isPinging 
                ? '<span class="spin-icon" style="display:inline-block;animation:spin 1s linear infinite;">⏳</span> Ping...' 
                : '<i data-lucide="activity" style="width:11px;height:11px;"></i> Ping ngay'}
            </button>
          </div>
          <div class="latency-status-row" id="latency-box-${dev.id}">
            ${latencyHtml}
          </div>
        </td>
        <td>
          <span class="mac-badge">${dev.macAddress}</span>
        </td>
        <td><span class="badge" style="background:var(--bg-primary);">${dev.type}</span></td>
        <td>
          <span style="font-size: 1.05rem; font-weight: 700; color: ${isWarning ? 'var(--status-danger)' : 'var(--accent-color)'};">
            ${dev.value} ${dev.unit}
          </span>
        </td>
        <td>
          <span class="threshold-pill" title="Ngưỡng an toàn: ${dev.minThreshold} - ${dev.maxThreshold} ${dev.unit}">
            <span style="color:var(--text-muted);">${dev.minThreshold}</span> - <span style="font-weight:600; color:${isWarning ? 'var(--status-danger)' : 'var(--text-main)'};">${dev.maxThreshold} ${dev.unit}</span>
          </span>
        </td>
        <td>${relayBadge}</td>
        <td>${statusBadge}</td>
        <td><span style="font-size: 0.8rem; color: var(--text-muted);">${updatedFormatted}</span></td>
        <td style="text-align: right;">${actionButtons}</td>
      </tr>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

// Cập nhật danh sách thiết bị trong modal gửi API IoT, OTA Target và Quick Control
function updatePushDeviceDropdown() {
  const select = document.getElementById('selectPushDevice');
  if (select) {
    select.innerHTML = cachedDevices.map(d => `<option value="${d.id}">${d.name} (${d.id}) - Hiện tại: ${d.value} ${d.unit}</option>`).join('');
  }
  const otaSelect = document.getElementById('otaTargetDeviceSelect');
  if (otaSelect) {
    otaSelect.innerHTML = cachedDevices.map(d => `<option value="${d.id}">${d.name} (${d.id}) [${d.ipAddress}]</option>`).join('');
  }
  const quickSelect = document.getElementById('quickCtrlDeviceSelect');
  if (quickSelect) {
    const currentVal = quickSelect.value;
    quickSelect.innerHTML = cachedDevices.map(d => 
      `<option value="${d.id}" ${d.id === currentVal ? 'selected' : ''}>${d.name} (${d.id}) [IP: ${d.ipAddress}] - Relay: ${d.relayStatus || 'OFF'}</option>`
    ).join('');
    updateQuickTerminalHost();
  }
}

function updateQuickTerminalHost() {
  const quickSelect = document.getElementById('quickCtrlDeviceSelect');
  const hostEl = document.getElementById('quickTerminalHost');
  const relayBtnText = document.getElementById('quickRelayBtnText');
  if (!quickSelect || !hostEl) return;
  const dev = cachedDevices.find(d => d.id === quickSelect.value);
  if (dev) {
    hostEl.textContent = `device-control@${dev.ipAddress}:~$`;
    if (relayBtnText) {
      relayBtnText.textContent = (dev.relayStatus === 'ON') ? 'Tắt Relay' : 'Bật Relay';
    }
  }
}

// -----------------------------------------------------------------------------
// EVENT HANDLERS: E-FORMS CRUD & BUSINESS LOGIC
// -----------------------------------------------------------------------------

function initDeviceEvents() {
  // Tìm kiếm và lọc
  document.getElementById('searchInput')?.addEventListener('input', renderDevicesTable);
  document.getElementById('filterStatus')?.addEventListener('change', renderDevicesTable);
  document.getElementById('filterType')?.addEventListener('change', renderDevicesTable);

  // Quick Control Select change
  document.getElementById('quickCtrlDeviceSelect')?.addEventListener('change', updateQuickTerminalHost);

  // Quick Control Action Buttons
  document.getElementById('btnQuickCmdPing')?.addEventListener('click', () => executeQuickDeviceCommand('ping'));
  document.getElementById('btnQuickCmdReboot')?.addEventListener('click', () => executeQuickDeviceCommand('reboot'));
  document.getElementById('btnQuickCmdRelay')?.addEventListener('click', () => executeQuickDeviceCommand('toggle_relay'));
  document.getElementById('btnQuickCmdCoolDown')?.addEventListener('click', () => executeQuickDeviceCommand('cool_down'));
  document.getElementById('btnQuickCmdWarning')?.addEventListener('click', () => executeQuickDeviceCommand('trigger_warning'));
  document.getElementById('btnQuickClearLog')?.addEventListener('click', () => {
    const term = document.getElementById('quickTerminalOutput');
    if (term) term.textContent = '> Đã xóa log dòng lệnh điều khiển.';
  });

  // Mở modal Thêm thiết bị
  document.getElementById('btnOpenAddModal')?.addEventListener('click', () => {
    if (window.getCurrentRole && window.getCurrentRole() !== 'admin') {
      window.showToast('Vui lòng đăng nhập quyền ADMIN để thêm thiết bị mới!', 'warning');
      if (window.openLoginModal) window.openLoginModal();
      return;
    }
    document.getElementById('modalAddDevice').classList.add('active');
  });

  // Mở modal Bắn gói tin API
  document.getElementById('btnOpenPushApiModal')?.addEventListener('click', () => {
    if (window.getCurrentRole && window.getCurrentRole() !== 'admin') {
      window.showToast('Vui lòng đăng nhập quyền ADMIN để gửi gói tin API!', 'warning');
      if (window.openLoginModal) window.openLoginModal();
      return;
    }
    updatePushDeviceDropdown();
    document.getElementById('modalPushApi').classList.add('active');
  });

  // Submit E-Form: Thêm thiết bị mới
  document.getElementById('formAddDevice')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (window.getCurrentRole && window.getCurrentRole() !== 'admin') {
      window.showToast('Chỉ tài khoản ADMIN mới có quyền thực hiện!', 'warning');
      if (window.openLoginModal) window.openLoginModal();
      return;
    }

    const payload = {
      name: document.getElementById('inputDevName').value,
      type: document.getElementById('selectDevType').value,
      location: document.getElementById('inputDevLocation').value,
      minThreshold: document.getElementById('inputMinThreshold').value,
      maxThreshold: document.getElementById('inputMaxThreshold').value,
      ipAddress: document.getElementById('inputIpAddress').value,
      macAddress: document.getElementById('inputMacAddress').value
    };

    try {
      const authHeaders = window.getAuthHeaders ? window.getAuthHeaders() : {};
      const res = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        document.getElementById('modalAddDevice').classList.remove('active');
        document.getElementById('formAddDevice').reset();
        window.showToast('Thêm thiết bị mới thành công qua E-Form!', 'success');
        loadDevices();
      } else {
        const err = await res.json();
        window.showToast(err.error || 'Không thể tạo thiết bị', 'warning');
        if (res.status === 403 && window.openLoginModal) window.openLoginModal();
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Submit E-Form: Bắn gói tin viễn trắc qua API
  document.getElementById('formPushApi')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const deviceId = document.getElementById('selectPushDevice').value;
    const value = document.getElementById('inputPushValue').value;

    try {
      const authHeaders = window.getAuthHeaders ? window.getAuthHeaders() : {};
      const res = await fetch('/api/telemetry/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ deviceId, value: Number(value) })
      });
      if (res.ok) {
        document.getElementById('modalPushApi').classList.remove('active');
        window.showToast(`Đã gửi gói tin API IoT thành công cho thiết bị ${deviceId}!`, 'success');
        loadDevices();
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Xử lý các nút trong bảng (Điều khiển / Xóa / Ping ngay)
  document.getElementById('devicesTableBody')?.addEventListener('click', async (e) => {
    const btnPingNow = e.target.closest('.btn-ping-now');
    const btnControl = e.target.closest('.btn-control-dev');
    const btnDelete = e.target.closest('.btn-delete-dev');

    if (btnPingNow) {
      const devId = btnPingNow.getAttribute('data-id');
      const devIp = btnPingNow.getAttribute('data-ip');
      await triggerDevicePing(devId, devIp, btnPingNow);
      return;
    }

    if (btnControl) {
      const devId = btnControl.getAttribute('data-id');
      const dev = cachedDevices.find(d => d.id === devId);
      if (dev) openControlModal(dev);
    }

    if (btnDelete) {
      if (window.getCurrentRole && window.getCurrentRole() !== 'admin') {
        window.showToast('Chỉ tài khoản ADMIN mới có quyền xóa thiết bị!', 'warning');
        if (window.openLoginModal) window.openLoginModal();
        return;
      }
      const devId = btnDelete.getAttribute('data-id');
      if (confirm(`Bạn có chắc chắn muốn xóa thiết bị ${devId}?`)) {
        try {
          const authHeaders = window.getAuthHeaders ? window.getAuthHeaders() : {};
          const res = await fetch(`/api/devices/${devId}`, { 
            method: 'DELETE',
            headers: authHeaders
          });
          if (res.ok) {
            window.showToast(`Đã xóa thiết bị ${devId}`, 'info');
            loadDevices();
          } else {
            const err = await res.json();
            window.showToast(err.error || 'Lỗi khi xóa thiết bị', 'warning');
            if (res.status === 403 && window.openLoginModal) window.openLoginModal();
          }
        } catch (err) {
          console.error(err);
        }
      }
    }
  });

  // Modal Điều khiển thiết bị: Các lệnh nghiệp vụ
  document.getElementById('btnCmdPing')?.addEventListener('click', () => executeDeviceCommand('ping'));
  document.getElementById('btnCmdReboot')?.addEventListener('click', () => executeDeviceCommand('reboot'));
  document.getElementById('btnCmdRelay')?.addEventListener('click', () => executeDeviceCommand('toggle_relay'));
  document.getElementById('btnCmdCoolDown')?.addEventListener('click', () => executeDeviceCommand('cool_down'));
  document.getElementById('btnCmdTriggerWarning')?.addEventListener('click', () => executeDeviceCommand('trigger_warning'));
  document.getElementById('btnClearTerminal')?.addEventListener('click', () => {
    const devId = document.getElementById('ctrlDevId').value;
    const dev = cachedDevices.find(d => d.id === devId);
    const terminal = document.getElementById('ctrlTerminalOutput');
    if (terminal) {
      terminal.textContent = `> Terminal cleared. Sẵn sàng nhận lệnh [${dev ? dev.ipAddress : ''}]...`;
    }
  });

  // Cập nhật tham số ngưỡng
  document.getElementById('btnSaveDeviceParams')?.addEventListener('click', async () => {
    if (window.getCurrentRole && window.getCurrentRole() !== 'admin') {
      window.showToast('Chỉ tài khoản ADMIN mới có quyền thay đổi thông số thiết bị!', 'warning');
      if (window.openLoginModal) window.openLoginModal();
      return;
    }

    const devId = document.getElementById('ctrlDevId').value;
    const minThreshold = document.getElementById('ctrlMinThreshold')?.value;
    const maxThreshold = document.getElementById('ctrlMaxThreshold')?.value;
    const location = document.getElementById('ctrlLocation')?.value;

    try {
      const authHeaders = window.getAuthHeaders ? window.getAuthHeaders() : {};
      const res = await fetch(`/api/devices/${devId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ minThreshold, maxThreshold, location })
      });
      if (res.ok) {
        const updated = await res.json();
        window.showToast('Cập nhật cấu hình thiết bị thành công!', 'success');
        const terminal = document.getElementById('ctrlTerminalOutput');
        if (terminal) {
          terminal.textContent += `\n[${new Date().toLocaleTimeString('vi-VN')}] [CẤU HÌNH] Đã lưu thông số: Ngưỡng (${updated.minThreshold} - ${updated.maxThreshold} ${updated.unit}), Vị trí (${updated.location}).`;
          terminal.scrollTop = terminal.scrollHeight;
        }
        loadDevices();
      } else {
        const err = await res.json();
        window.showToast(err.error || 'Lỗi cập nhật', 'warning');
        if (res.status === 403 && window.openLoginModal) window.openLoginModal();
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Xuất file CSV
  document.getElementById('btnExportCsv')?.addEventListener('click', exportToCsv);

  // In báo cáo
  document.getElementById('btnPrintReport')?.addEventListener('click', () => {
    window.print();
  });
}

function openControlModal(dev) {
  document.getElementById('ctrlDevId').value = dev.id;
  document.getElementById('ctrlDevName').textContent = `${dev.name} (${dev.id})`;
  
  const ipEl = document.getElementById('ctrlDevIp');
  if (ipEl) ipEl.innerHTML = `<i data-lucide="network" style="width:12px;height:12px;"></i> ${dev.ipAddress}`;

  const macEl = document.getElementById('ctrlDevMac');
  if (macEl) macEl.textContent = dev.macAddress;

  const locEl = document.getElementById('ctrlDevLocationText');
  if (locEl) locEl.textContent = dev.location;

  document.getElementById('ctrlDevCurrentValue').textContent = `${dev.value} ${dev.unit}`;
  
  const threshEl = document.getElementById('ctrlDevThresholdRange');
  if (threshEl) threshEl.textContent = `${dev.minThreshold} - ${dev.maxThreshold} ${dev.unit}`;

  if (document.getElementById('ctrlMinThreshold')) {
    document.getElementById('ctrlMinThreshold').value = dev.minThreshold;
  }
  document.getElementById('ctrlMaxThreshold').value = dev.maxThreshold;
  document.getElementById('ctrlLocation').value = dev.location;

  const badge = document.getElementById('ctrlDevStatusBadge');
  badge.className = `badge ${dev.status === 'Warning' ? 'badge-warning' : 'badge-normal'}`;
  badge.textContent = dev.status === 'Warning' ? 'Cảnh Báo' : 'An Toàn';

  const relayBadge = document.getElementById('ctrlDevRelayBadge');
  const isRelayOn = dev.relayStatus === 'ON';
  if (relayBadge) {
    relayBadge.className = `badge ${isRelayOn ? 'badge-relay-on' : 'badge-relay-off'}`;
    relayBadge.innerHTML = `<i data-lucide="${isRelayOn ? 'zap' : 'zap-off'}" style="width:11px;height:11px;"></i> ${isRelayOn ? 'BẬT (ON)' : 'TẮT (OFF)'}`;
  }

  const btnRelayText = document.getElementById('btnCmdRelayText');
  if (btnRelayText) {
    btnRelayText.textContent = isRelayOn ? 'Tắt Relay' : 'Bật Relay';
  }

  const terminalHost = document.getElementById('terminalDevHost');
  if (terminalHost) terminalHost.textContent = `device-cli@${dev.ipAddress}:~$`;

  const terminal = document.getElementById('ctrlTerminalOutput');
  if (terminal) {
    const timeStr = new Date().toLocaleTimeString('vi-VN');
    terminal.textContent = `[${timeStr}] Khởi tạo phiên điều khiển thiết bị ${dev.id} [${dev.ipAddress}]...\n` +
      `[${timeStr}] Thông số phần cứng: MAC: ${dev.macAddress} | Loại: ${dev.type} | Rơ-le: ${dev.relayStatus || 'OFF'}\n` +
      `[${timeStr}] Dữ liệu viễn trắc hiện tại: ${dev.value} ${dev.unit} (Trạng thái: ${dev.status})\n` +
      `> Sẵn sàng nhận lệnh điều khiển. Nhấn một trong các nút lệnh phía trên để thực thi...`;
    terminal.scrollTop = terminal.scrollHeight;
  }

  document.getElementById('modalDeviceControl').classList.add('active');
  if (window.lucide) window.lucide.createIcons();
}

async function executeDeviceCommand(command) {
  const devId = document.getElementById('ctrlDevId').value;
  const dev = cachedDevices.find(d => d.id === devId);
  const currentRole = window.getCurrentRole ? window.getCurrentRole() : 'guest';
  const terminal = document.getElementById('ctrlTerminalOutput');

  if (command !== 'ping' && currentRole !== 'admin') {
    window.showToast('Chỉ tài khoản ADMIN mới có quyền gửi lệnh can thiệp thiết bị!', 'warning');
    if (terminal) {
      terminal.textContent += `\n[${new Date().toLocaleTimeString('vi-VN')}] [TỪ CHỐI] Lệnh ${command.toUpperCase()} yêu cầu quyền ADMIN. Vui lòng đăng nhập!`;
      terminal.scrollTop = terminal.scrollHeight;
    }
    if (window.openLoginModal) window.openLoginModal();
    return;
  }

  const timestamp = new Date().toLocaleTimeString('vi-VN');
  if (terminal) {
    terminal.textContent += `\n\n[${timestamp}] > Đang gửi lệnh: ${command.toUpperCase()} tới ${dev ? dev.ipAddress : devId}...`;
    terminal.scrollTop = terminal.scrollHeight;
  }

  try {
    const authHeaders = window.getAuthHeaders ? window.getAuthHeaders() : {};
    const res = await fetch(`/api/devices/${devId}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ command })
    });
    
    if (res.ok) {
      const data = await res.json();
      window.showToast(data.message, 'success');

      if (terminal) {
        if (data.terminalLines && data.terminalLines.length > 0) {
          data.terminalLines.forEach(line => {
            terminal.textContent += `\n[${new Date().toLocaleTimeString('vi-VN')}] ${line}`;
          });
        } else {
          terminal.textContent += `\n[${new Date().toLocaleTimeString('vi-VN')}] ${data.message}`;
        }
        terminal.scrollTop = terminal.scrollHeight;
      }

      if (data.device) {
        const updated = data.device;
        const idx = cachedDevices.findIndex(d => d.id === devId);
        if (idx !== -1) cachedDevices[idx] = updated;

        document.getElementById('ctrlDevCurrentValue').textContent = `${updated.value} ${updated.unit}`;

        const badge = document.getElementById('ctrlDevStatusBadge');
        if (badge) {
          badge.className = `badge ${updated.status === 'Warning' ? 'badge-warning' : 'badge-normal'}`;
          badge.textContent = updated.status === 'Warning' ? 'Cảnh Báo' : 'An Toàn';
        }

        const relayBadge = document.getElementById('ctrlDevRelayBadge');
        const isRelayOn = updated.relayStatus === 'ON';
        if (relayBadge) {
          relayBadge.className = `badge ${isRelayOn ? 'badge-relay-on' : 'badge-relay-off'}`;
          relayBadge.innerHTML = `<i data-lucide="${isRelayOn ? 'zap' : 'zap-off'}" style="width:11px;height:11px;"></i> ${isRelayOn ? 'BẬT (ON)' : 'TẮT (OFF)'}`;
        }

        const btnRelayText = document.getElementById('btnCmdRelayText');
        if (btnRelayText) {
          btnRelayText.textContent = isRelayOn ? 'Tắt Relay' : 'Bật Relay';
        }

        if (window.lucide) window.lucide.createIcons();
      }

      loadDevices();
    } else {
      const err = await res.json();
      if (terminal) {
        terminal.textContent += `\n[${new Date().toLocaleTimeString('vi-VN')}] [LỖI] ${err.error || 'Lỗi thực thi lệnh'}`;
        terminal.scrollTop = terminal.scrollHeight;
      }
      window.showToast(err.error || 'Lỗi thực thi lệnh', 'warning');
      if (res.status === 403 && window.openLoginModal) window.openLoginModal();
    }
  } catch (err) {
    if (terminal) {
      terminal.textContent += `\n[${new Date().toLocaleTimeString('vi-VN')}] [LỖI MẠNG] Không thể kết nối tới server: ${err.message}`;
      terminal.scrollTop = terminal.scrollHeight;
    }
    console.error(err);
  }
}

// Thực thi lệnh điều khiển từ bảng điều khiển nhanh (Tab 2)
async function executeQuickDeviceCommand(command) {
  const select = document.getElementById('quickCtrlDeviceSelect');
  const devId = select ? select.value : (cachedDevices[0] ? cachedDevices[0].id : null);
  if (!devId) {
    window.showToast('Chưa có thiết bị nào được chọn!', 'warning');
    return;
  }
  const dev = cachedDevices.find(d => d.id === devId);
  const currentRole = window.getCurrentRole ? window.getCurrentRole() : 'guest';
  const terminal = document.getElementById('quickTerminalOutput');

  if (command !== 'ping' && currentRole !== 'admin') {
    window.showToast('Chỉ tài khoản ADMIN mới có quyền gửi lệnh can thiệp thiết bị!', 'warning');
    if (terminal) {
      terminal.textContent += `\n[${new Date().toLocaleTimeString('vi-VN')}] [TỪ CHỐI] Lệnh ${command.toUpperCase()} yêu cầu quyền ADMIN. Vui lòng đăng nhập!`;
      terminal.scrollTop = terminal.scrollHeight;
    }
    if (window.openLoginModal) window.openLoginModal();
    return;
  }

  const timestamp = new Date().toLocaleTimeString('vi-VN');
  if (terminal) {
    terminal.textContent += `\n\n[${timestamp}] > Đang gửi lệnh: ${command.toUpperCase()} tới ${dev ? dev.name : devId} [${dev ? dev.ipAddress : ''}]...`;
    terminal.scrollTop = terminal.scrollHeight;
  }

  try {
    const authHeaders = window.getAuthHeaders ? window.getAuthHeaders() : {};
    const res = await fetch(`/api/devices/${devId}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ command })
    });
    
    if (res.ok) {
      const data = await res.json();
      window.showToast(data.message, 'success');

      if (terminal) {
        if (data.terminalLines && data.terminalLines.length > 0) {
          data.terminalLines.forEach(line => {
            terminal.textContent += `\n[${new Date().toLocaleTimeString('vi-VN')}] ${line}`;
          });
        } else {
          terminal.textContent += `\n[${new Date().toLocaleTimeString('vi-VN')}] ${data.message}`;
        }
        terminal.scrollTop = terminal.scrollHeight;
      }

      loadDevices();
    } else {
      const err = await res.json();
      window.showToast(err.error || 'Thực thi lệnh thất bại', 'warning');
      if (terminal) {
        terminal.textContent += `\n[${new Date().toLocaleTimeString('vi-VN')}] [LỖI]: ${err.error || 'Thất bại'}`;
        terminal.scrollTop = terminal.scrollHeight;
      }
    }
  } catch (err) {
    console.error('Lỗi khi thực thi lệnh thiết bị:', err);
    if (terminal) {
      terminal.textContent += `\n[${new Date().toLocaleTimeString('vi-VN')}] [LỖI MẠNG]: Không thể kết nối tới máy chủ!`;
      terminal.scrollTop = terminal.scrollHeight;
    }
  }
}

// Xuất bảng dữ liệu ra file CSV
function exportToCsv() {
  if (cachedDevices.length === 0) {
    window.showToast('Không có dữ liệu để xuất', 'warning');
    return;
  }
  const headers = ['ID', 'Ten_Thiet_Bi', 'Vi_Tri', 'Loai_Cam_Bien', 'Gia_Tri', 'Don_Vi', 'Nguong_Max', 'Trang_Thai', 'Thoi_Gian'];
  const rows = cachedDevices.map(d => [
    d.id,
    `"${d.name.replace(/"/g, '""')}"`,
    `"${d.location.replace(/"/g, '""')}"`,
    d.type,
    d.value,
    d.unit,
    d.maxThreshold,
    d.status,
    `"${d.lastUpdated}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `iot_telemetry_report_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.showToast('Đã xuất báo cáo CSV thành công!', 'success');
}

// Cập nhật thiết bị trực tiếp từ SSE Tick mà không cần re-fetch toàn bộ nếu không cần thiết
function updateFromSSETick(devices) {
  // Bảo lưu thông số độ trễ ping đo được
  devices.forEach(d => {
    if (deviceLatencyCache[d.id] && deviceLatencyCache[d.id].latency !== undefined) {
      d.latency = deviceLatencyCache[d.id].latency;
    }
  });
  cachedDevices = devices;
  renderDevicesTable();
  loadStats();
}

window.loadDevices = loadDevices;
window.renderDevicesTable = renderDevicesTable;
window.initDeviceEvents = initDeviceEvents;
window.updateFromSSETick = updateFromSSETick;
