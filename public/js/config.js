// =============================================================================
// TAB 3: CONFIG & DRIVERS MODULE (HARDWARE DRIVERS & COMMUNICATION PARAMS)
// =============================================================================

let cachedConfig = { comm: {}, drivers: [] };

// Khởi tạo các sự kiện cho Tab Cấu hình & Driver
function initConfigEvents() {
  const formComm = document.getElementById('formCommParams');
  if (formComm) {
    formComm.addEventListener('submit', handleSaveCommParams);
  }

  document.getElementById('btnResetCommParams')?.addEventListener('click', handleResetCommParams);
  document.getElementById('btnReloadAllDrivers')?.addEventListener('click', handleReloadAllDrivers);
  document.getElementById('btnExportConfigJson')?.addEventListener('click', handleExportConfigJson);
}

// Tải dữ liệu cấu hình từ Back-end
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('Không thể tải cấu hình');
    const data = await res.json();
    cachedConfig = data;

    renderCommParams(data.comm || {});
    renderDriversList(data.drivers || []);
  } catch (err) {
    console.error('Lỗi khi tải cấu hình:', err);
  }
}

// Điền thông số vào Form
function renderCommParams(comm) {
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined) el.value = val;
  };

  setVal('commBaudrate', comm.baudrate || 115200);
  setVal('commDataBits', comm.databits || 8);
  setVal('commParity', comm.parity || 'None');
  setVal('commStopBits', comm.stopbits || 1);
  setVal('commGatewayIp', comm.gatewayIp || '192.168.1.1');
  setVal('commSubnetMask', comm.subnetMask || '255.255.255.0');
  setVal('commModbusAddr', comm.modbusAddress || 1);
  setVal('commPollingInterval', comm.pollingInterval || 3);
  setVal('commTimeoutMs', comm.timeoutMs || 1500);
  setVal('commRetryLimit', comm.retryLimit || 3);
  setVal('commTransMode', comm.transmissionMode || 'RS485 Half-Duplex');

  // Cập nhật thẻ trạng thái tóm tắt
  const summaryEl = document.getElementById('commConfigSummary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <span>Baud: <strong>${comm.baudrate || 115200}</strong> bps</span> • 
      <span>Khung: <strong>${comm.databits || 8}${comm.parity ? comm.parity[0] : 'N'}${comm.stopbits || 1}</strong></span> • 
      <span>Gateway: <strong>${comm.gatewayIp || '192.168.1.1'}</strong></span> • 
      <span>Slave: <strong>#${comm.modbusAddress || 1}</strong></span> • 
      <span>Quét: <strong>${comm.pollingInterval || 3}s</strong></span>
    `;
  }
}

// Hiển thị danh sách Driver phần cứng
function renderDriversList(drivers) {
  const container = document.getElementById('driversListContainer');
  if (!container) return;

  const currentRole = window.getCurrentRole ? window.getCurrentRole() : 'guest';

  if (!drivers || drivers.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted); padding:20px; text-align:center;">Không có driver nào</div>';
    return;
  }

  container.innerHTML = drivers.map(drv => {
    const isActive = drv.status === 'Active';
    const statusBadge = isActive
      ? `<span class="badge badge-normal"><i data-lucide="check-circle" style="width:12px;height:12px;"></i> Đang chạy (Active)</span>`
      : `<span class="badge" style="background:rgba(245,158,11,0.15); color:#f59e0b; border:1px solid #f59e0b;"><i data-lucide="clock" style="width:12px;height:12px;"></i> Chờ (Standby)</span>`;

    const lastSyncTime = drv.lastSync 
      ? new Date(drv.lastSync).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '--:--:--';

    return `
      <div class="driver-card">
        <div class="driver-card-header">
          <div style="display: flex; align-items: center; gap: 10px;">
            <div class="driver-icon-box ${isActive ? 'active' : ''}">
              <i data-lucide="cpu"></i>
            </div>
            <div>
              <div class="driver-name">${drv.name}</div>
              <div class="driver-meta">ID: <code>${drv.id}</code> • Phiên bản: <strong style="color:var(--accent-color);">v${drv.version}</strong></div>
            </div>
          </div>
          <div>${statusBadge}</div>
        </div>

        <div class="driver-specs-grid">
          <div class="spec-item">
            <span class="spec-label">Phần cứng (Chipset):</span>
            <span class="spec-val">${drv.chipset}</span>
          </div>
          <div class="spec-item">
            <span class="spec-label">Giao diện (Bus / Port):</span>
            <span class="spec-val"><code>${drv.bus}</code></span>
          </div>
          <div class="spec-item">
            <span class="spec-label">Đồng bộ gần nhất:</span>
            <span class="spec-val">${lastSyncTime}</span>
          </div>
        </div>

        <div class="driver-actions">
          ${currentRole === 'admin' ? `
            <button class="btn btn-secondary btn-toggle-driver" data-id="${drv.id}" style="padding: 4px 10px; font-size: 0.78rem;">
              <i data-lucide="${isActive ? 'pause' : 'play'}" style="width:12px;height:12px;"></i>
              <span>${isActive ? 'Tạm Dừng' : 'Kích Hoạt'}</span>
            </button>
            <button class="btn btn-secondary btn-sync-driver" data-id="${drv.id}" style="padding: 4px 10px; font-size: 0.78rem;">
              <i data-lucide="refresh-cw" style="width:12px;height:12px;"></i> Nạp lại
            </button>
          ` : `
            <span style="font-size: 0.75rem; color: var(--text-muted);"><i data-lucide="lock" style="width:11px;height:11px;vertical-align:-1px;"></i> Yêu cầu Admin để thao tác driver</span>
          `}
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();

  // Gắn sự kiện các nút trên từng card
  container.querySelectorAll('.btn-toggle-driver').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      await toggleDriver(id);
    });
  });

  container.querySelectorAll('.btn-sync-driver').forEach(btn => {
    btn.addEventListener('click', async () => {
      showToast('Đang nạp lại driver...', 'info');
      await handleReloadAllDrivers();
    });
  });
}

// Lưu tham số truyền thông
async function handleSaveCommParams(e) {
  e.preventDefault();
  if (window.getCurrentRole && window.getCurrentRole() !== 'admin') {
    showToast('Chỉ tài khoản ADMIN mới có quyền lưu cấu hình phần cứng!', 'warning');
    if (window.openLoginModal) window.openLoginModal();
    return;
  }

  const payload = {
    baudrate: Number(document.getElementById('commBaudrate')?.value) || 115200,
    databits: Number(document.getElementById('commDataBits')?.value) || 8,
    parity: document.getElementById('commParity')?.value || 'None',
    stopbits: Number(document.getElementById('commStopBits')?.value) || 1,
    gatewayIp: document.getElementById('commGatewayIp')?.value.trim() || '192.168.1.1',
    subnetMask: document.getElementById('commSubnetMask')?.value.trim() || '255.255.255.0',
    modbusAddress: Number(document.getElementById('commModbusAddr')?.value) || 1,
    pollingInterval: Number(document.getElementById('commPollingInterval')?.value) || 3,
    timeoutMs: Number(document.getElementById('commTimeoutMs')?.value) || 1500,
    retryLimit: Number(document.getElementById('commRetryLimit')?.value) || 3,
    transmissionMode: document.getElementById('commTransMode')?.value || 'RS485 Half-Duplex'
  };

  try {
    const res = await fetch('/api/config/comm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(window.getAuthHeaders ? window.getAuthHeaders() : {})
      },
      body: JSON.stringify(payload)
    });

    if (res.status === 403) {
      showToast('Từ chối: Cần đăng nhập quyền Admin!', 'warning');
      if (window.openLoginModal) window.openLoginModal();
      return;
    }

    const data = await res.json();
    if (res.ok) {
      showToast('Đã lưu và áp dụng tham số truyền thông phần cứng thành công!', 'success');
      loadConfig();
    } else {
      showToast(data.error || 'Lỗi khi lưu cấu hình', 'danger');
    }
  } catch (err) {
    console.error('Lỗi khi lưu tham số truyền thông:', err);
    showToast('Lỗi kết nối máy chủ khi lưu cấu hình!', 'danger');
  }
}

// Khôi phục giá trị mặc định
function handleResetCommParams() {
  const defaults = {
    baudrate: 115200,
    databits: 8,
    parity: 'None',
    stopbits: 1,
    gatewayIp: '192.168.1.1',
    subnetMask: '255.255.255.0',
    modbusAddress: 1,
    pollingInterval: 3,
    timeoutMs: 1500,
    retryLimit: 3,
    transmissionMode: 'RS485 Half-Duplex'
  };
  renderCommParams(defaults);
  showToast('Đã khôi phục các tham số về giá trị khuyến nghị', 'info');
}

// Bật/tắt trạng thái driver
async function toggleDriver(id) {
  try {
    const res = await fetch(`/api/config/drivers/${id}/toggle`, {
      method: 'POST',
      headers: window.getAuthHeaders ? window.getAuthHeaders() : {}
    });
    if (res.status === 403) {
      showToast('Cần quyền Admin để bật/tắt Driver!', 'warning');
      return;
    }
    const data = await res.json();
    if (res.ok) {
      showToast(`Đã chuyển trạng thái driver ${id} sang: ${data.driver.status}`, 'success');
      loadConfig();
    }
  } catch (err) {
    console.error(err);
  }
}

// Nạp lại toàn bộ drivers
async function handleReloadAllDrivers() {
  if (window.getCurrentRole && window.getCurrentRole() !== 'admin') {
    showToast('Chỉ Admin mới có quyền nạp lại Driver!', 'warning');
    return;
  }
  try {
    const res = await fetch('/api/config/drivers/reload', {
      method: 'POST',
      headers: window.getAuthHeaders ? window.getAuthHeaders() : {}
    });
    if (res.ok) {
      showToast('Đã đồng bộ và nạp lại toàn bộ 5 drivers phần cứng!', 'success');
      loadConfig();
    }
  } catch (err) {
    console.error(err);
  }
}

// Tải file mô tả JSON cấu hình
function handleExportConfigJson() {
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(cachedConfig, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute('href', dataStr);
  downloadAnchor.setAttribute('download', `iot_hardware_config_${Date.now()}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  showToast('Đã xuất file cấu hình phần cứng (.json)!', 'success');
}

// Xuất các hàm ra phạm vi toàn cục
window.initConfigEvents = initConfigEvents;
window.loadConfig = loadConfig;
window.renderDriversList = renderDriversList;
