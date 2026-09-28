// =============================================================================
// FTP SERVER & WEB EXPLORER MODULE (GIAO THỨC FTP RFC 959)
// =============================================================================

let cachedFtpFiles = [];

// Tải danh sách file từ FTP Server thông qua API
async function loadFtpFiles() {
  const currentRole = window.getCurrentRole ? window.getCurrentRole() : 'admin';

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
    const res = await fetch(`/api/ftp/files?role=${currentRole}`);
    const data = await res.json();
    cachedFtpFiles = data.files || [];
    renderFtpTable();
  } catch (err) {
    console.error('Lỗi tải file FTP:', err);
  }
}

// Hiển thị danh sách file FTP
function renderFtpTable() {
  const tbody = document.getElementById('ftpTableBody');
  if (!tbody) return;

  const folderFilter = document.getElementById('ftpFolderSelector')?.value || 'all';
  const currentRole = window.getCurrentRole ? window.getCurrentRole() : 'admin';

  const filtered = cachedFtpFiles.filter(f => {
    if (folderFilter === 'all') return true;
    return f.folder === folderFilter;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px; color: var(--text-muted);">Không có tập tin nào trong thư mục này</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(file => {
    const isConfidential = file.folder === 'admin_only';
    const folderBadge = isConfidential
      ? `<span class="badge" style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid #ef4444;"><i data-lucide="lock" style="width:11px;height:11px;"></i> /admin_only</span>`
      : `<span class="badge" style="background:rgba(0,240,255,0.1); color:var(--accent-color); border:1px solid var(--accent-color);"><i data-lucide="globe" style="width:11px;height:11px;"></i> /public</span>`;

    const canDelete = currentRole === 'admin';

    return `
      <tr>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <i data-lucide="file-text" style="color:var(--text-muted); width:16px; height:16px;"></i>
            <span style="font-weight:600; color:var(--text-main);">${file.name}</span>
          </div>
        </td>
        <td>${folderBadge}</td>
        <td>${file.sizeFormatted}</td>
        <td><span style="font-size:0.8rem; color:var(--text-muted);">${file.updatedAt}</span></td>
        <td><span style="font-size:0.8rem; color:var(--text-sub);">${file.permission}</span></td>
        <td style="text-align: right;">
          <div style="display:flex; gap:6px; justify-content:flex-end;">
            <a href="/api/ftp/download?path=${encodeURIComponent(file.relativePath)}&role=${currentRole}" 
               class="btn btn-secondary" style="padding:4px 10px; font-size:0.8rem;" download title="Tải về qua FTP">
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

function initFtpEvents() {
  document.getElementById('ftpFolderSelector')?.addEventListener('change', renderFtpTable);
  document.getElementById('btnRefreshFtp')?.addEventListener('click', loadFtpFiles);

  // Upload file lên FTP
  document.getElementById('btnUploadFtp')?.addEventListener('click', async () => {
    const fileInput = document.getElementById('ftpFileInput');
    const folder = document.getElementById('uploadTargetFolder')?.value || 'public';
    const currentRole = window.getCurrentRole ? window.getCurrentRole() : 'admin';

    if (!fileInput.files || fileInput.files.length === 0) {
      window.showToast('Vui lòng chọn một tập tin để tải lên FTP!', 'warning');
      return;
    }

    if (folder === 'admin_only' && currentRole !== 'admin') {
      window.showToast('Chỉ tài khoản Admin mới có quyền tải file vào thư mục /admin_only!', 'warning');
      return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);
    formData.append('role', currentRole);

    try {
      const res = await fetch(`/api/ftp/upload?folder=${folder}&role=${currentRole}`, {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        window.showToast('Tải tập tin lên FTP Server thành công!', 'success');
        fileInput.value = '';
        loadFtpFiles();
      } else {
        const err = await res.json();
        alert('Lỗi: ' + (err.error || 'Upload thất bại'));
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
    const currentRole = window.getCurrentRole ? window.getCurrentRole() : 'admin';

    if (confirm(`Bạn có chắc muốn xóa file '${relPath}' trên FTP Server?`)) {
      try {
        const res = await fetch('/api/ftp/files', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: relPath, role: currentRole })
        });
        if (res.ok) {
          window.showToast(`Đã xóa tập tin FTP thành công!`, 'info');
          loadFtpFiles();
        } else {
          const err = await res.json();
          alert('Lỗi: ' + (err.error || 'Không thể xóa'));
        }
      } catch (err) {
        console.error(err);
      }
    }
  });
}

window.loadFtpFiles = loadFtpFiles;
window.renderFtpTable = renderFtpTable;
window.initFtpEvents = initFtpEvents;
