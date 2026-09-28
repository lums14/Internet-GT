// =============================================================================
// DEVICES & TELEMETRY MODULE (DATA TABLE, E-FORMS CRUD & BUSINESS LOGIC)
// =============================================================================

let cachedDevices = [];

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
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 24px; color: var(--text-muted);">Không tìm thấy thiết bị nào phù hợp</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(dev => {
    const isWarning = dev.status === 'Warning';
    const statusBadge = isWarning 
      ? `<span class="badge badge-warning"><i data-lucide="alert-triangle" style="width:12px;height:12px;"></i> Cảnh Báo</span>` 
      : `<span class="badge badge-normal"><i data-lucide="check" style="width:12px;height:12px;"></i> An Toàn</span>`;

    const updatedFormatted = new Date(dev.lastUpdated).toLocaleTimeString('vi-VN', {
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    // Khi là Guest: Chỉ hiển thị nhãn "Chỉ xem", không cho phép can thiệp hoặc gửi lệnh
    const actionButtons = (currentRole === 'admin') ? `
      <div style="display: flex; gap: 6px; justify-content: flex-end;">
        <button class="btn btn-secondary btn-control-dev" data-id="${dev.id}" style="padding: 4px 10px; font-size: 0.8rem;" title="Điều khiển & Cấu hình (Admin)">
          <i data-lucide="sliders" style="width:14px;height:14px;"></i> Lệnh
        </button>
        <button class="btn btn-danger btn-delete-dev" data-id="${dev.id}" style="padding: 4px 10px; font-size: 0.8rem;" title="Xóa thiết bị (Admin)">
          <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
        </button>
      </div>
    ` : `
      <div style="display: flex; justify-content: flex-end;">
        <span class="badge" style="background:var(--bg-primary); color:var(--text-sub); border:1px solid var(--border-color); font-size:0.75rem;">
          <i data-lucide="lock" style="width:11px;height:11px;"></i> Chỉ xem
        </span>
      </div>
    `;

    return `
      <tr id="row-${dev.id}">
        <td><strong>${dev.id}</strong></td>
        <td>
          <div style="font-weight: 600; color: var(--text-main);">${dev.name}</div>
          <div style="font-size: 0.75rem; color: var(--text-sub);">${dev.ipAddress} (${dev.macAddress})</div>
        </td>
        <td>${dev.location}</td>
        <td><span class="badge" style="background:var(--bg-primary);">${dev.type}</span></td>
        <td>
          <span style="font-size: 1.05rem; font-weight: 700; color: ${isWarning ? 'var(--status-warning)' : 'var(--accent-color)'};">
            ${dev.value} ${dev.unit}
          </span>
        </td>
        <td>
          <span style="font-size: 0.8rem; color: var(--text-muted);">${dev.minThreshold} - ${dev.maxThreshold} ${dev.unit}</span>
        </td>
        <td>${statusBadge}</td>
        <td><span style="font-size: 0.8rem; color: var(--text-muted);">${updatedFormatted}</span></td>
        <td style="text-align: right;">${actionButtons}</td>
      </tr>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

// Cập nhật danh sách thiết bị trong modal gửi API IoT
function updatePushDeviceDropdown() {
  const select = document.getElementById('selectPushDevice');
  if (!select) return;
  select.innerHTML = cachedDevices.map(d => `<option value="${d.id}">${d.name} (${d.id}) - Hiện tại: ${d.value} ${d.unit}</option>`).join('');
}

// -----------------------------------------------------------------------------
// EVENT HANDLERS: E-FORMS CRUD & BUSINESS LOGIC
// -----------------------------------------------------------------------------

function initDeviceEvents() {
  // Tìm kiếm và lọc
  document.getElementById('searchInput')?.addEventListener('input', renderDevicesTable);
  document.getElementById('filterStatus')?.addEventListener('change', renderDevicesTable);
  document.getElementById('filterType')?.addEventListener('change', renderDevicesTable);

  // Mở modal Thêm thiết bị
  document.getElementById('btnOpenAddModal')?.addEventListener('click', () => {
    if (window.getCurrentRole && window.getCurrentRole() !== 'admin') {
      window.showToast('Chỉ tài khoản ADMIN mới có quyền thêm thiết bị!', 'warning');
      return;
    }
    document.getElementById('modalAddDevice').classList.add('active');
  });

  // Mở modal Bắn gói tin API
  document.getElementById('btnOpenPushApiModal')?.addEventListener('click', () => {
    if (window.getCurrentRole && window.getCurrentRole() !== 'admin') {
      window.showToast('Chỉ tài khoản ADMIN mới có quyền gửi gói tin API!', 'warning');
      return;
    }
    updatePushDeviceDropdown();
    document.getElementById('modalPushApi').classList.add('active');
  });

  // Submit E-Form: Thêm thiết bị mới
  document.getElementById('formAddDevice')?.addEventListener('submit', async (e) => {
    e.preventDefault();
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
      const res = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        document.getElementById('modalAddDevice').classList.remove('active');
        document.getElementById('formAddDevice').reset();
        window.showToast('Thêm thiết bị mới thành công qua E-Form!', 'success');
        loadDevices();
      } else {
        const err = await res.json();
        alert('Lỗi: ' + (err.error || 'Không thể tạo thiết bị'));
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
      const res = await fetch('/api/telemetry/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  // Xử lý các nút trong bảng (Điều khiển / Xóa)
  document.getElementById('devicesTableBody')?.addEventListener('click', async (e) => {
    const btnControl = e.target.closest('.btn-control-dev');
    const btnDelete = e.target.closest('.btn-delete-dev');

    if (btnControl) {
      const devId = btnControl.getAttribute('data-id');
      const dev = cachedDevices.find(d => d.id === devId);
      if (dev) openControlModal(dev);
    }

    if (btnDelete) {
      const devId = btnDelete.getAttribute('data-id');
      if (confirm(`Bạn có chắc chắn muốn xóa thiết bị ${devId}?`)) {
        try {
          const res = await fetch(`/api/devices/${devId}`, { method: 'DELETE' });
          if (res.ok) {
            window.showToast(`Đã xóa thiết bị ${devId}`, 'info');
            loadDevices();
          }
        } catch (err) {
          console.error(err);
        }
      }
    }
  });

  // Modal Điều khiển thiết bị: Các lệnh nghiệp vụ
  document.getElementById('btnCmdCoolDown')?.addEventListener('click', () => executeDeviceCommand('cool_down'));
  document.getElementById('btnCmdReboot')?.addEventListener('click', () => executeDeviceCommand('reboot'));
  document.getElementById('btnCmdTriggerWarning')?.addEventListener('click', () => executeDeviceCommand('trigger_warning'));

  // Cập nhật tham số ngưỡng
  document.getElementById('btnSaveDeviceParams')?.addEventListener('click', async () => {
    const devId = document.getElementById('ctrlDevId').value;
    const maxThreshold = document.getElementById('ctrlMaxThreshold').value;
    const location = document.getElementById('ctrlLocation').value;

    try {
      const res = await fetch(`/api/devices/${devId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxThreshold, location })
      });
      if (res.ok) {
        document.getElementById('modalDeviceControl').classList.remove('active');
        window.showToast('Cập nhật thông số thiết bị thành công!', 'success');
        loadDevices();
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
  document.getElementById('ctrlDevCurrentValue').textContent = `${dev.value} ${dev.unit}`;
  document.getElementById('ctrlMaxThreshold').value = dev.maxThreshold;
  document.getElementById('ctrlLocation').value = dev.location;

  const badge = document.getElementById('ctrlDevStatusBadge');
  badge.className = `badge ${dev.status === 'Warning' ? 'badge-warning' : 'badge-normal'}`;
  badge.textContent = dev.status;

  document.getElementById('modalDeviceControl').classList.add('active');
}

async function executeDeviceCommand(command) {
  const devId = document.getElementById('ctrlDevId').value;
  try {
    const res = await fetch(`/api/devices/${devId}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command })
    });
    if (res.ok) {
      const data = await res.json();
      window.showToast(data.message, 'success');
      document.getElementById('modalDeviceControl').classList.remove('active');
      loadDevices();
    }
  } catch (err) {
    console.error(err);
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
  cachedDevices = devices;
  renderDevicesTable();
  loadStats();
}

window.loadDevices = loadDevices;
window.renderDevicesTable = renderDevicesTable;
window.initDeviceEvents = initDeviceEvents;
window.updateFromSSETick = updateFromSSETick;
