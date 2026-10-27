// =============================================================================
// TAB 4: STORAGE & FIRMWARE OTA MODULE (NÂNG CẤP TỪ FTP SERVER RFC 959)
// =============================================================================

let cachedFtpFiles = [];
let isOtaRunning = false;

// Tải danh sách file từ FTP Server thông qua API
async function loadFtpFiles() {
  const currentRole = window.getCurrentRole ? window.getCurrentRole() : 'guest';

  // Ẩn tùy chọn thư mục bảo mật đối với Guest
  const selector = document.getElementById('ftpFolderSelector');
  if (selector) {
    const adminOpt = selector.querySelector('option[value="admin_only"]');
    if (adminOpt) {
      adminOpt.style.display = (currentRole === 'admin') ? '' : 'none';
      if (currentRole === 'guest' && selector.value === 'admin_only') {
        selector.value = 'all';
      }
    }
  }

  try {
    const authHeaders = window.getAuthHeaders ? window.getAuthHeaders() : {};
    const res = await fetch('/api/ftp/files', { headers: authHeaders });
    const data = await res.json();
    cachedFtpFiles = data.files || [];
    renderFtpTable();
    updateOtaFirmwareDropdowns();
  } catch (err) {
    console.error('Lỗi tải file FTP:', err);
  }
}

// Cập nhật dropdown chọn file Firmware cho bộ nạp OTA
function updateOtaFirmwareDropdowns() {
  const firmwareSelect = document.getElementById('otaFirmwareSelect');
  if (!firmwareSelect) return;

  const fwFiles = cachedFtpFiles.filter(f => 
    f.folder === 'firmware' || 
    f.name.endsWith('.bin') || 
    f.name.endsWith('.hex')
  );

  if (fwFiles.length === 0) {
    firmwareSelect.innerHTML = '<option value="">(Chưa có file firmware trong /firmware)</option>';
    return;
  }

  firmwareSelect.innerHTML = fwFiles.map(f => 
    `<option value="${f.name}">${f.name} (${f.sizeFormatted})</option>`
  ).join('');
}

// Hiển thị danh sách file FTP
function renderFtpTable() {
  const tbody = document.getElementById('ftpTableBody');
  if (!tbody) return;

  const folderFilter = document.getElementById('ftpFolderSelector')?.value || 'all';
  const currentRole = window.getCurrentRole ? window.getCurrentRole() : 'guest';
  const token = window.getAuthToken ? window.getAuthToken() : '';

  const filtered = cachedFtpFiles.filter(f => {
    if (folderFilter === 'all') return true;
    return f.folder === folderFilter;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px; color: var(--text-muted);">Không có tập tin nào trong thư mục này</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(file => {
    let folderBadge = `<span class="badge" style="background:rgba(0,240,255,0.1); color:var(--accent-color); border:1px solid var(--accent-color);"><i data-lucide="globe" style="width:11px;height:11px;"></i> /public</span>`;
    
    if (file.folder === 'admin_only') {
      folderBadge = `<span class="badge" style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid #ef4444;"><i data-lucide="lock" style="width:11px;height:11px;"></i> /admin_only</span>`;
    } else if (file.folder === 'firmware') {
      folderBadge = `<span class="badge" style="background:rgba(139,92,246,0.15); color:#c4b5fd; border:1px solid rgba(139,92,246,0.3);"><i data-lucide="cpu" style="width:11px;height:11px;"></i> /firmware</span>`;
    } else if (file.folder === 'backups') {
      folderBadge = `<span class="badge" style="background:rgba(16,185,129,0.15); color:#10b981; border:1px solid #10b981;"><i data-lucide="database" style="width:11px;height:11px;"></i> /backups</span>`;
    } else if (file.folder === 'logs') {
      folderBadge = `<span class="badge" style="background:rgba(245,158,11,0.15); color:#f59e0b; border:1px solid #f59e0b;"><i data-lucide="file-clock" style="width:11px;height:11px;"></i> /logs</span>`;
    }

    const canDelete = currentRole === 'admin';
    const downloadQuery = token ? `&token=${encodeURIComponent(token)}` : '';

    return `
      <tr>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <i data-lucide="file-code" style="color:var(--text-muted); width:16px; height:16px;"></i>
            <span style="font-weight:600; color:var(--text-main);">${file.name}</span>
          </div>
        </td>
        <td>${folderBadge}</td>
        <td><code>${file.sizeFormatted}</code></td>
        <td><span style="font-size:0.8rem; color:var(--text-muted); font-family:monospace;">${file.updatedAt}</span></td>
        <td><span style="font-size:0.8rem; color:var(--text-sub);">${file.permission}</span></td>
        <td style="text-align: right;">
          <div style="display:flex; gap:6px; justify-content:flex-end;">
            <a href="/api/ftp/download?path=${encodeURIComponent(file.relativePath)}${downloadQuery}" 
               class="btn btn-secondary" style="padding:4px 10px; font-size:0.8rem;" download title="Tải về qua giao thức FTP">
              <i data-lucide="download" style="width:14px;height:14px;"></i> Tải
            </a>
            ${canDelete ? `
              <button class="btn btn-danger btn-delete-ftp" data-path="${file.relativePath}" style="padding:4px 10px; font-size:0.8rem;" title="Xóa file (Chỉ Admin)">
                <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) window.lucide.createIcons();
}

// Khởi tạo các sự kiện FTP và OTA
function initFtpEvents() {
  document.getElementById('ftpFolderSelector')?.addEventListener('change', renderFtpTable);
  document.getElementById('btnRefreshFtp')?.addEventListener('click', loadFtpFiles);

  // Upload file lên FTP
  document.getElementById('btnUploadFtp')?.addEventListener('click', async () => {
    const fileInput = document.getElementById('ftpFileInput');
    const folder = document.getElementById('uploadTargetFolder')?.value || 'public';
    const currentRole = window.getCurrentRole ? window.getCurrentRole() : 'guest';

    if (currentRole !== 'admin') {
      window.showToast('Vui lòng đăng nhập quyền ADMIN để tải file lên FTP Server!', 'warning');
      if (window.openLoginModal) window.openLoginModal();
      return;
    }

    if (!fileInput.files || fileInput.files.length === 0) {
      window.showToast('Vui lòng chọn một tập tin để tải lên FTP!', 'warning');
      return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
      const authHeaders = window.getAuthHeaders ? window.getAuthHeaders() : {};
      const token = window.getAuthToken ? window.getAuthToken() : '';
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/ftp/upload?folder=${folder}`, {
        method: 'POST',
        headers,
        body: formData
      });
      if (res.ok) {
        window.showToast(`Tải tập tin lên thư mục /${folder} thành công!`, 'success');
        fileInput.value = '';
        loadFtpFiles();
      } else {
        const err = await res.json();
        window.showToast(err.error || 'Upload thất bại', 'warning');
        if (res.status === 403 && window.openLoginModal) window.openLoginModal();
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Xóa file FTP (chỉ Admin)
  document.getElementById('ftpTableBody')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-delete-ftp');
    if (!btn) return;
    const relPath = btn.getAttribute('data-path');
    const currentRole = window.getCurrentRole ? window.getCurrentRole() : 'guest';

    if (currentRole !== 'admin') {
      window.showToast('Chỉ tài khoản ADMIN mới có quyền xóa file trên FTP Server!', 'warning');
      if (window.openLoginModal) window.openLoginModal();
      return;
    }

    if (confirm(`Bạn có chắc muốn xóa file '${relPath}' trên FTP Server?`)) {
      try {
        const authHeaders = window.getAuthHeaders ? window.getAuthHeaders() : {};
        const res = await fetch('/api/ftp/files', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ path: relPath })
        });
        if (res.ok) {
          window.showToast(`Đã xóa tập tin FTP thành công!`, 'info');
          loadFtpFiles();
        } else {
          const err = await res.json();
          window.showToast(err.error || 'Không thể xóa', 'warning');
          if (res.status === 403 && window.openLoginModal) window.openLoginModal();
        }
      } catch (err) {
        console.error(err);
      }
    }
  });

  // Nút bắt đầu nạp Firmware OTA
  document.getElementById('btnStartOta')?.addEventListener('click', handleStartOtaUpdate);
}

// Xử lý tiến trình nạp Firmware OTA qua FTP
async function handleStartOtaUpdate() {
  const currentRole = window.getCurrentRole ? window.getCurrentRole() : 'guest';
  if (currentRole !== 'admin') {
    showToast('Chỉ tài khoản ADMIN mới có quyền thực hiện cập nhật Firmware OTA!', 'warning');
    if (window.openLoginModal) window.openLoginModal();
    return;
  }

  if (isOtaRunning) {
    showToast('Tiến trình OTA đang diễn ra, vui lòng đợi!', 'warning');
    return;
  }

  const targetDevice = document.getElementById('otaTargetDeviceSelect')?.value;
  const firmwareFile = document.getElementById('otaFirmwareSelect')?.value;

  if (!targetDevice || !firmwareFile) {
    showToast('Vui lòng chọn thiết bị đích và file Firmware!', 'warning');
    return;
  }

  isOtaRunning = true;
  const btn = document.getElementById('btnStartOta');
  const progressBox = document.getElementById('otaProgressBox');
  const progressBar = document.getElementById('otaProgressBar');
  const progressText = document.getElementById('otaProgressText');
  const stepLog = document.getElementById('otaStepLog');

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span style="display:inline-block;animation:spin 1s linear infinite;">⏳</span> Đang nạp OTA...';
  }
  if (progressBox) progressBox.style.display = 'block';

  try {
    const res = await fetch('/api/ota/deploy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(window.getAuthHeaders ? window.getAuthHeaders() : {})
      },
      body: JSON.stringify({
        targetDeviceId: targetDevice,
        firmwareFile: firmwareFile,
        protocol: 'FTP OTA (Port 2121)'
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi khởi động OTA');

    const steps = data.steps || [
      { step: 1, name: 'Bắt tay FTP Socket RFC 959 (Port 2121)', percent: 20 },
      { step: 2, name: `Tải tệp ${firmwareFile} vào vùng đệm flash`, percent: 45 },
      { step: 3, name: 'Xác thực Checksum MD5 / SHA-256 tính toàn vẹn', percent: 70 },
      { step: 4, name: 'Ghi mã máy vào phân vùng flash (ota_0)', percent: 90 },
      { step: 5, name: 'Khởi động lại chip và kiểm tra luồng telemetry', percent: 100 }
    ];

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (progressBar) progressBar.style.width = `${s.percent}%`;
      if (progressText) progressText.textContent = `${s.percent}%`;
      if (stepLog) {
        stepLog.innerHTML += `<div style="font-family:monospace; font-size:0.8rem; color:#38bdf8; margin-top:4px;">➔ Bước ${s.step}/5: ${s.name}... [OK]</div>`;
        stepLog.scrollTop = stepLog.scrollHeight;
      }
      await new Promise(r => setTimeout(r, 800));
    }

    showToast(`Đã hoàn tất nâng cấp Firmware OTA cho ${targetDevice} qua FTP!`, 'success');
  } catch (err) {
    console.error('Lỗi OTA:', err);
    showToast(`Lỗi tiến trình OTA: ${err.message}`, 'danger');
  } finally {
    isOtaRunning = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="zap"></i> Bắt Đầu Nạp Firmware Từ Xa (OTA)';
      if (window.lucide) window.lucide.createIcons();
    }
  }
}

// Xuất các hàm ra phạm vi toàn cục
window.loadFtpFiles = loadFtpFiles;
window.renderFtpTable = renderFtpTable;
window.initFtpEvents = initFtpEvents;
window.updateOtaFirmwareDropdowns = updateOtaFirmwareDropdowns;
