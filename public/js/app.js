// =============================================================================
// MAIN APPLICATION CONTROLLER (TABS, SSE REALTIME, CUSTOMIZE & CAMERA SIMULATION)
// =============================================================================

let currentRole = 'guest'; // Mặc định khi chưa đăng nhập là 'guest' (Chỉ Xem)
let audioEnabled = true;
let sseSource = null;
let cctvPlaying = true;
let cctvCamIndex = 1;
let cctvAnimationFrame = null;

// -----------------------------------------------------------------------------
// 1. KHỞI TẠO ỨNG DỤNG KHI DOM READY
// -----------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) window.lucide.createIcons();

  // Khởi tạo các module con
  initNavigation();
  initThemeAndCustomization();
  initAuthHandlers();
  initAudioBeeper();
  initCctvSimulation();
  initModals();

  // Kiểm tra phiên đăng nhập hiện tại từ server
  checkInitialAuth();

  if (window.initCharts) window.initCharts();
  if (window.initDeviceEvents) window.initDeviceEvents();
  if (window.initConfigEvents) window.initConfigEvents();
  if (window.initFtpEvents) window.initFtpEvents();
  if (window.initDiagnosticEvents) window.initDiagnosticEvents();
  if (window.initAlertsEvents) window.initAlertsEvents();
  if (window.initMailEvents) window.initMailEvents();

  // Nạp dữ liệu ban đầu cho toàn bộ 6 Tab
  if (window.loadDevices) window.loadDevices();
  if (window.loadConfig) window.loadConfig();
  if (window.loadFtpFiles) window.loadFtpFiles();
  if (window.loadPackets) window.loadPackets();
  if (window.loadIncidents) window.loadIncidents();
  if (window.loadTriggerRules) window.loadTriggerRules();
  if (window.loadEmails) window.loadEmails();

  // Kết nối Server-Sent Events (SSE) để biến trang web thành Web Động Thực Sự
  initSSE();
});

// -----------------------------------------------------------------------------
// 2. SERVER-SENT EVENTS (SSE) - TRÁI TIM CỦA "WEB ĐỘNG"
// -----------------------------------------------------------------------------
function initSSE() {
  if (sseSource) sseSource.close();

  sseSource = new EventSource('/api/stream');

  sseSource.onopen = () => {
    console.log('[SSE] Đã kết nối kênh truyền dữ liệu viễn trắc Web Động');
  };

  // Lắng nghe dữ liệu nhịp đo viễn trắc (Tick)
  sseSource.addEventListener('telemetry_tick', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.point && window.pushTelemetryToChart) {
        window.pushTelemetryToChart(data.point);
      }
      if (data.devices && window.updateFromSSETick) {
        window.updateFromSSETick(data.devices);
      }

      // Kiểm tra có thiết bị cảnh báo để kích hoạt còi bíp
      const hasWarning = data.devices?.some(d => d.status === 'Warning');
      if (hasWarning && audioEnabled) {
        playAlertBeep();
      }
    } catch (err) {
      console.error(err);
    }
  });

  // Sự kiện thêm/sửa/xóa thiết bị
  sseSource.addEventListener('system_refresh', () => {
    if (window.loadDevices) window.loadDevices();
  });

  // Sự kiện có email mới đến qua SMTP
  sseSource.addEventListener('new_email', (e) => {
    try {
      const mail = JSON.parse(e.data);
      showToast(`Có thư mới qua SMTP từ ${mail.from}!`, 'info');
      if (window.loadEmails) window.loadEmails();
    } catch (err) {
      console.error(err);
    }
  });

  // Sự kiện thay đổi file FTP
  sseSource.addEventListener('ftp_change', () => {
    if (window.loadFtpFiles) window.loadFtpFiles();
  });

  // Lắng nghe gói tin mới từ bộ thu Packet Sniffer
  sseSource.addEventListener('packet_captured', (e) => {
    try {
      const pkt = JSON.parse(e.data);
      if (window.handleNewPacketFromSSE) window.handleNewPacketFromSSE(pkt);
    } catch (err) {
      console.error(err);
    }
  });

  // Lắng nghe sự cố viễn trắc mới phát sinh
  sseSource.addEventListener('new_incident', (e) => {
    try {
      const inc = JSON.parse(e.data);
      if (window.handleNewIncidentFromSSE) window.handleNewIncidentFromSSE(inc);
      showToast(`[SỰ CỐ] ${inc.title} (${inc.deviceName})`, 'danger');
    } catch (err) {
      console.error(err);
    }
  });

  // Lắng nghe thay đổi cấu hình truyền thông hoặc driver
  sseSource.addEventListener('config_updated', () => {
    if (window.loadConfig) window.loadConfig();
  });

  sseSource.onerror = () => {
    console.warn('[SSE] Mất kết nối, tự động kết nối lại sau 4 giây...');
  };
}

// -----------------------------------------------------------------------------
// 3. ĐIỀU HƯỚNG TABS
// -----------------------------------------------------------------------------
function initNavigation() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');

      btn.classList.add('active');
      const targetTab = btn.getAttribute('data-tab');
      const targetContent = document.getElementById(`tab-${targetTab}`);
      if (targetContent) {
        targetContent.style.display = 'block';
      }

      // Làm mới icons
      if (window.lucide) window.lucide.createIcons();
    });
  });
}

// -----------------------------------------------------------------------------
// 4. TÙY BIẾN GIAO DIỆN (CUSTOMIZE: THEME, ACCENT, WIDGETS)
// -----------------------------------------------------------------------------
function initThemeAndCustomization() {
  // Theme Toggle: Light / Dark
  const savedTheme = localStorage.getItem('app_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeIcon(savedTheme);

  document.getElementById('btnThemeToggle')?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('app_theme', next);
    updateThemeIcon(next);
    if (window.refreshChartTheme) window.refreshChartTheme();
  });

  // Accent Colors
  const savedAccent = localStorage.getItem('app_accent') || 'cyan';
  document.documentElement.setAttribute('data-accent', savedAccent);

  document.querySelectorAll('.accent-picker-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const accent = btn.getAttribute('data-accent');
      document.documentElement.setAttribute('data-accent', accent);
      localStorage.setItem('app_accent', accent);
      showToast(`Đã đổi màu chủ đạo thành: ${accent.toUpperCase()}`, 'success');
    });
  });

  // Modal Customize: Bật/Tắt Widget
  document.getElementById('btnCustomize')?.addEventListener('click', () => {
    document.getElementById('modalCustomize').classList.add('active');
  });

  // Xử lý bật/tắt từng widget trên Dashboard
  const bindWidgetToggle = (chkId, widgetId) => {
    const chk = document.getElementById(chkId);
    const widget = document.getElementById(widgetId);
    if (chk && widget) {
      chk.addEventListener('change', () => {
        widget.style.display = chk.checked ? '' : 'none';
      });
    }
  };

  bindWidgetToggle('chkWidgetKpi', 'widget-kpi');
  bindWidgetToggle('chkWidgetCharts', 'widget-charts');
  bindWidgetToggle('chkWidgetMedia', 'widget-media');
  bindWidgetToggle('chkWidgetTable', 'widget-table');

  // Nút Dừng/Chạy bộ giả lập IoT (Yêu cầu quyền Admin)
  document.getElementById('btnPauseSim')?.addEventListener('click', async () => {
    if (currentRole !== 'admin') {
      showToast('Chỉ tài khoản ADMIN mới có quyền tạm dừng/tiếp tục bộ giả lập!', 'warning');
      openLoginModal();
      return;
    }
    try {
      const res = await fetch('/api/simulation/toggle', { 
        method: 'POST',
        headers: getAuthHeaders()
      });
      if (res.status === 403) {
        showToast('Quyền bị từ chối: Vui lòng đăng nhập quyền Admin!', 'warning');
        openLoginModal();
        return;
      }
      const data = await res.json();
      const btnText = document.getElementById('simBtnText');
      const icon = document.getElementById('simIcon');
      if (data.simulationActive) {
        btnText.textContent = 'Dừng Tự Động';
        icon.setAttribute('data-lucide', 'pause');
        showToast('Đã tiếp tục tiến trình sinh dữ liệu IoT tự động!', 'info');
      } else {
        btnText.textContent = 'Bật Tự Động';
        icon.setAttribute('data-lucide', 'play');
        showToast('Đã tạm dừng tiến trình sinh dữ liệu tự động', 'warning');
      }
      if (window.lucide) window.lucide.createIcons();
    } catch (err) {
      console.error(err);
    }
  });
}

function updateThemeIcon(theme) {
  const icon = document.getElementById('themeIcon');
  if (!icon) return;
  if (theme === 'light') {
    icon.setAttribute('data-lucide', 'sun');
  } else {
    icon.setAttribute('data-lucide', 'moon');
  }
  if (window.lucide) window.lucide.createIcons();
}

// -----------------------------------------------------------------------------
// 5. QUẢN LÝ XÁC THỰC, PHIÊN LÀM VIỆC & PHÂN QUYỀN (ADMIN / GUEST)
// -----------------------------------------------------------------------------

function getAuthToken() {
  return localStorage.getItem('iot_admin_token') || '';
}

function getAuthHeaders() {
  const token = getAuthToken();
  const headers = {
    'X-User-Role': currentRole
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['X-Auth-Token'] = token;
  }
  return headers;
}

window.getAuthToken = getAuthToken;
window.getAuthHeaders = getAuthHeaders;

function openLoginModal() {
  const modal = document.getElementById('modalLogin');
  if (modal) {
    const errAlert = document.getElementById('loginErrorAlert');
    if (errAlert) errAlert.style.display = 'none';
    modal.classList.add('active');
    setTimeout(() => {
      document.getElementById('loginUsername')?.focus();
    }, 100);
  }
}
window.openLoginModal = openLoginModal;

function applyRolePermissions(role, showNotification = false) {
  currentRole = role;
  const roleBadge = document.getElementById('roleSelector');
  const roleText = document.getElementById('roleText');
  const roleIcon = document.getElementById('roleIcon');
  const guestBanner = document.getElementById('guestNoticeBanner');
  const btnNavLogin = document.getElementById('btnNavLogin');
  const btnNavLogout = document.getElementById('btnNavLogout');

  if (role === 'guest') {
    document.body.classList.add('role-guest');
    if (guestBanner) guestBanner.style.display = 'flex';
    if (btnNavLogin) btnNavLogin.style.display = 'inline-flex';
    if (btnNavLogout) btnNavLogout.style.display = 'none';

    if (roleBadge) {
      roleBadge.style.borderColor = 'var(--status-warning)';
      roleBadge.style.color = 'var(--status-warning)';
      roleBadge.style.background = 'rgba(245, 158, 11, 0.12)';
      roleBadge.title = 'Chế độ Khách (Role: Guest). Bấm để Đăng nhập Quản trị viên';
    }
    if (roleText) roleText.textContent = 'Role: GUEST (Chỉ Xem)';
    if (roleIcon) roleIcon.setAttribute('data-lucide', 'shield-alert');

    // Tự động đóng tất cả các modal thao tác và tùy biến của admin nếu đang mở
    document.querySelectorAll('.modal-overlay').forEach(m => {
      if (m.id !== 'modalLogin' && m.id !== 'modalViewMail') {
        m.classList.remove('active');
      }
    });

    if (showNotification) {
      showToast('Chế độ GUEST: Bạn chỉ có quyền xem dữ liệu, mọi thao tác quản trị đã bị khóa!', 'warning');
    }
  } else {
    document.body.classList.remove('role-guest');
    if (guestBanner) guestBanner.style.display = 'none';
    if (btnNavLogin) btnNavLogin.style.display = 'none';
    if (btnNavLogout) btnNavLogout.style.display = 'inline-flex';

    if (roleBadge) {
      roleBadge.style.borderColor = 'var(--accent-color)';
      roleBadge.style.color = 'var(--accent-color)';
      roleBadge.style.background = 'var(--accent-light)';
      roleBadge.title = 'Tài khoản Quản trị viên (Role: Admin - Toàn Quyền)';
    }
    if (roleText) roleText.textContent = 'Role: ADMIN (Toàn Quyền)';
    if (roleIcon) roleIcon.setAttribute('data-lucide', 'shield-check');

    if (showNotification) {
      showToast('Đã đăng nhập ADMIN: Toàn quyền thao tác, cấu hình thiết bị và tùy biến hệ thống!', 'success');
    }
  }

  if (window.lucide) window.lucide.createIcons();

  // Yêu cầu các module cập nhật lại UI theo role
  if (window.renderDevicesTable) window.renderDevicesTable();
  if (window.loadConfig) window.loadConfig();
  if (window.loadFtpFiles) window.loadFtpFiles();
  if (window.loadPackets) window.loadPackets();
  if (window.loadIncidents) window.loadIncidents();
  if (window.loadTriggerRules) window.loadTriggerRules();
  if (window.loadEmails) window.loadEmails();
}

// Kiểm tra phiên đăng nhập từ localStorage khi khởi động
async function checkInitialAuth() {
  const token = getAuthToken();
  if (!token) {
    applyRolePermissions('guest', false);
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated && data.role === 'admin') {
        applyRolePermissions('admin', false);
        return;
      }
    }
  } catch (err) {
    console.warn('Lỗi kiểm tra phiên admin:', err);
  }

  // Token không hợp lệ hoặc đã bị server xóa
  localStorage.removeItem('iot_admin_token');
  applyRolePermissions('guest', false);
}

function initAuthHandlers() {
  // Nút mở modal đăng nhập ở header và banner
  document.getElementById('btnNavLogin')?.addEventListener('click', openLoginModal);
  document.getElementById('btnBannerLogin')?.addEventListener('click', openLoginModal);

  // Nhấp vào role badge
  document.getElementById('roleSelector')?.addEventListener('click', () => {
    if (currentRole === 'guest') {
      openLoginModal();
    } else {
      showToast('Bạn đang ở phiên đăng nhập ADMIN (Toàn quyền quản trị)', 'info');
    }
  });

  // Nút đăng xuất
  document.getElementById('btnNavLogout')?.addEventListener('click', handleLogout);

  // Nút điền nhanh tài khoản Admin demo
  document.getElementById('btnQuickFillAdmin')?.addEventListener('click', () => {
    const u = document.getElementById('loginUsername');
    const p = document.getElementById('loginPassword');
    if (u) u.value = 'admin';
    if (p) p.value = 'admin123';
  });

  // Nút ẩn/hiện mật khẩu
  document.getElementById('btnTogglePassword')?.addEventListener('click', () => {
    const p = document.getElementById('loginPassword');
    const icon = document.getElementById('togglePasswordIcon');
    if (!p) return;
    if (p.type === 'password') {
      p.type = 'text';
      if (icon) icon.setAttribute('data-lucide', 'eye-off');
    } else {
      p.type = 'password';
      if (icon) icon.setAttribute('data-lucide', 'eye');
    }
    if (window.lucide) window.lucide.createIcons();
  });

  // Submit form đăng nhập
  document.getElementById('formLogin')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const submitBtn = document.getElementById('btnLoginSubmit');
    const errAlert = document.getElementById('loginErrorAlert');
    const errText = document.getElementById('loginErrorText');

    if (!username || !password) return;

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span style="display:inline-block;animation:spin 1s linear infinite;">⏳</span> Đang xác thực...';
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        localStorage.setItem('iot_admin_token', data.token);
        document.getElementById('modalLogin')?.classList.remove('active');
        document.getElementById('formLogin')?.reset();
        if (errAlert) errAlert.style.display = 'none';

        applyRolePermissions('admin', true);
      } else {
        if (errAlert && errText) {
          errText.textContent = data.error || 'Tên đăng nhập hoặc mật khẩu không đúng!';
          errAlert.style.display = 'flex';
          if (window.lucide) window.lucide.createIcons();
        }
      }
    } catch (err) {
      console.error('Lỗi đăng nhập:', err);
      if (errAlert && errText) {
        errText.textContent = 'Lỗi kết nối tới máy chủ!';
        errAlert.style.display = 'flex';
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i data-lucide="log-in"></i> Đăng Nhập';
        if (window.lucide) window.lucide.createIcons();
      }
    }
  });
}

async function handleLogout() {
  const token = getAuthToken();
  try {
    if (token) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: getAuthHeaders()
      });
    }
  } catch (err) {
    console.error('Lỗi đăng xuất:', err);
  } finally {
    localStorage.removeItem('iot_admin_token');
    applyRolePermissions('guest', true);
  }
}

function getCurrentRole() {
  return currentRole;
}
window.getCurrentRole = getCurrentRole;
window.applyRolePermissions = applyRolePermissions;
window.applyRolePermissions = applyRolePermissions;

// -----------------------------------------------------------------------------
// 6. CÒI BÁO ĐỘNG ÂM THANH (WEB AUDIO API)
// -----------------------------------------------------------------------------
let audioCtx = null;
let lastBeepTime = 0;

function initAudioBeeper() {
  const btn = document.getElementById('btnAudioToggle');
  const icon = document.getElementById('audioIcon');

  btn?.addEventListener('click', () => {
    audioEnabled = !audioEnabled;
    if (audioEnabled) {
      icon.setAttribute('data-lucide', 'volume-2');
      showToast('Đã BẬT còi cảnh báo âm thanh', 'info');
    } else {
      icon.setAttribute('data-lucide', 'volume-x');
      showToast('Đã TẮT còi cảnh báo âm thanh', 'info');
    }
    if (window.lucide) window.lucide.createIcons();
  });
}

function playAlertBeep() {
  const now = Date.now();
  if (now - lastBeepTime < 10000) return; // Không kêu liên tục quá nhiều
  lastBeepTime = now;

  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime); // 880Hz
    osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.3);

    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } catch (err) {
    // Trình duyệt có thể chặn khi chưa click
  }
}

// -----------------------------------------------------------------------------
// 7. CAMERA GIÁM SÁT TRỰC TIẾP (CCTV CANVAS LIVE SIMULATION)
// -----------------------------------------------------------------------------
function initCctvSimulation() {
  const canvas = document.getElementById('cctvCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let tick = 0;

  function renderCamera() {
    if (!cctvPlaying) {
      cctvAnimationFrame = requestAnimationFrame(renderCamera);
      return;
    }

    tick++;
    const w = canvas.width;
    const h = canvas.height;

    // Background sàn phòng máy / trạm sensor
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    if (cctvCamIndex === 1) {
      // Data Center: Blue tint
      gradient.addColorStop(0, '#040d21');
      gradient.addColorStop(1, '#0b1e3b');
    } else if (cctvCamIndex === 2) {
      // Internet Lab: Green tint
      gradient.addColorStop(0, '#031a16');
      gradient.addColorStop(1, '#062b25');
    } else {
      // Rooftop ESP32: Sunset/Purple tint
      gradient.addColorStop(0, '#1a0624');
      gradient.addColorStop(1, '#2c0c3e');
    }
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // Vẽ phối cảnh lưới 3D phối cảnh (Perspective Floor Grid)
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.15)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 100);
      ctx.lineTo((x - w/2) * 2.5 + w/2, h);
      ctx.stroke();
    }
    for (let y = 100; y < h; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Mô phỏng server racks ở 2 bên
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(40, 60, 90, 180);
    ctx.fillRect(w - 130, 60, 90, 180);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.strokeRect(40, 60, 90, 180);
    ctx.strokeRect(w - 130, 60, 90, 180);

    // Server LEDs nhấp nháy ngẫu nhiên
    for (let i = 0; i < 6; i++) {
      const ledColor = (Math.sin(tick * 0.1 + i) > 0) ? '#10b981' : '#00f0ff';
      ctx.fillStyle = ledColor;
      ctx.beginPath();
      ctx.arc(60, 80 + i * 25, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(w - 110, 80 + i * 25, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Thermal Heatmap Aura ở giữa trạm
    const heatSize = 40 + Math.sin(tick * 0.05) * 8;
    const radialGrad = ctx.createRadialGradient(w/2, h/2 + 20, 5, w/2, h/2 + 20, heatSize);
    radialGrad.addColorStop(0, 'rgba(239, 68, 68, 0.4)');
    radialGrad.addColorStop(0.6, 'rgba(245, 158, 11, 0.2)');
    radialGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = radialGrad;
    ctx.beginPath();
    ctx.arc(w/2, h/2 + 20, heatSize, 0, Math.PI * 2);
    ctx.fill();

    // Camera Crosshairs (Tâm ngắm HUD)
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
    ctx.lineWidth = 1.5;
    const cx = w / 2;
    const cy = h / 2;
    ctx.beginPath();
    // Vòng tròn tâm
    ctx.arc(cx, cy, 28, 0, Math.PI * 2);
    // 4 góc ngắm
    ctx.moveTo(cx - 40, cy); ctx.lineTo(cx - 15, cy);
    ctx.moveTo(cx + 15, cy); ctx.lineTo(cx + 40, cy);
    ctx.moveTo(cx, cy - 40); ctx.lineTo(cx, cy - 15);
    ctx.moveTo(cx, cy + 15); ctx.lineTo(cx, cy + 40);
    ctx.stroke();

    // Scanline chạy dọc màn hình
    const scanlineY = (tick * 2) % h;
    ctx.fillStyle = 'rgba(0, 240, 255, 0.08)';
    ctx.fillRect(0, scanlineY, w, 4);

    // Nhiễu hạt sensor noise nhẹ
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    for (let n = 0; n < 200; n++) {
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }

    // Cập nhật đồng hồ camera HUD
    const clockEl = document.getElementById('cctvClock');
    if (clockEl) {
      clockEl.textContent = new Date().toLocaleTimeString('vi-VN');
    }

    cctvAnimationFrame = requestAnimationFrame(renderCamera);
  }

  renderCamera();

  // Nút Play/Pause CCTV
  document.getElementById('btnCctvPlay')?.addEventListener('click', () => {
    cctvPlaying = !cctvPlaying;
    const text = document.getElementById('cctvPlayText');
    const icon = document.getElementById('cctvPlayIcon');
    if (cctvPlaying) {
      text.textContent = 'Pause';
      icon.setAttribute('data-lucide', 'pause');
    } else {
      text.textContent = 'Play';
      icon.setAttribute('data-lucide', 'play');
    }
    if (window.lucide) window.lucide.createIcons();
  });

  // Chọn Camera
  document.getElementById('cctvCamSelect')?.addEventListener('change', (e) => {
    cctvCamIndex = Number(e.target.value);
    const camNameEl = document.getElementById('cctvCamName');
    if (cctvCamIndex === 1) camNameEl.textContent = 'CAM-01 [DATA CENTER RACK A]';
    else if (cctvCamIndex === 2) camNameEl.textContent = 'CAM-02 [INTERNET PROTOCOLS LAB]';
    else camNameEl.textContent = 'CAM-03 [ROOFTOP ESP32 STATION]';
  });

  // Chụp ảnh snapshot
  document.getElementById('btnCctvSnapshot')?.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `cctv_snapshot_${Date.now()}.png`;
    a.click();
    showToast('Đã chụp và lưu ảnh trích xuất từ camera giám sát!', 'success');
  });

  // Chuyển đổi giữa Live Stream Canvas và Video Clip MP4
  document.getElementById('btnToggleCctvMode')?.addEventListener('click', () => {
    const canvas = document.getElementById('cctvCanvas');
    const video = document.getElementById('cctvVideoClip');
    const hud = document.getElementById('cctvHud');
    const controlsBar = document.querySelector('.cctv-controls-bar');
    const label = document.getElementById('cctvModeLabel');
    const badge = document.getElementById('cctvLiveBadge');
    const title = document.getElementById('cctvCardTitle');
    if (!canvas || !video) return;

    if (video.style.display === 'none') {
      canvas.style.display = 'none';
      if (hud) hud.style.display = 'none';
      if (controlsBar) controlsBar.style.display = 'none';
      video.style.display = 'block';
      video.play().catch(() => {});
      if (label) label.textContent = 'Camera Live Feed';
      if (badge) {
        badge.innerHTML = '<i data-lucide="play-circle" style="width:12px; height:12px;"></i> VIDEO CLIP';
        badge.style.background = 'rgba(16, 185, 129, 0.2)';
        badge.style.color = '#10b981';
        badge.style.borderColor = '#10b981';
      }
      if (title) title.textContent = 'Video Clip Giám Sát Hiện Trường Trạm IoT';
      showToast('Đang phát Video Clip hiện trường ghi hình', 'info');
      if (window.lucide) lucide.createIcons();
    } else {
      video.pause();
      video.style.display = 'none';
      canvas.style.display = 'block';
      if (hud) hud.style.display = 'flex';
      if (controlsBar) controlsBar.style.display = 'flex';
      if (label) label.textContent = 'Xem Video Clip';
      if (badge) {
        badge.innerHTML = '<i data-lucide="rss" style="width:12px; height:12px;"></i> LIVE FEED';
        badge.style.background = 'rgba(239, 68, 68, 0.2)';
        badge.style.color = '#ef4444';
        badge.style.borderColor = '#ef4444';
      }
      if (title) title.textContent = 'Camera Giám Sát Hiện Trường Trực Tiếp (Live CCTV / Clip Stream)';
      showToast('Đã quay lại luồng Camera CCTV Live', 'success');
      if (window.lucide) lucide.createIcons();
    }
  });

  // Chuyển đổi giữa Ảnh Thực Tế và Sơ Đồ SVG của Trạm Thu Thập Viễn Trắc
  document.getElementById('btnToggleStationView')?.addEventListener('click', () => {
    const photo = document.getElementById('imgStationPhoto');
    const svg = document.getElementById('imgStationSvg');
    const label = document.getElementById('stationViewLabel');
    if (!photo || !svg) return;

    if (photo.style.display !== 'none') {
      photo.style.display = 'none';
      svg.style.display = 'block';
      if (label) label.textContent = 'Ảnh Thực Tế';
      showToast('Đang hiển thị Sơ Đồ Khối Kỹ Thuật (SVG)', 'info');
    } else {
      photo.style.display = 'block';
      svg.style.display = 'none';
      if (label) label.textContent = 'Sơ Đồ SVG';
      showToast('Đang hiển thị Hình Ảnh Trạm Viễn Trắc Thực Tế', 'success');
    }
  });
}

// -----------------------------------------------------------------------------
// 8. ĐIỀU KHIỂN CÁC MODAL & THÔNG BÁO TOAST
// -----------------------------------------------------------------------------
function initModals() {
  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
    });
  });

  // Đóng modal khi bấm ra ngoài vùng box
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('active');
    });
  });
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  
  if (type === 'success') toast.style.borderLeftColor = 'var(--status-normal)';
  else if (type === 'warning') toast.style.borderLeftColor = 'var(--status-warning)';
  else if (type === 'danger') toast.style.borderLeftColor = 'var(--status-danger)';
  else toast.style.borderLeftColor = 'var(--accent-color)';

  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
window.showToast = showToast;
