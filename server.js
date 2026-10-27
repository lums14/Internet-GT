const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const multer = require('multer');
const nodemailer = require('nodemailer');
const { SMTPServer } = require('smtp-server');
const FtpSrv = require('ftp-srv');

const HTTP_PORT = process.env.PORT || 3000;
const FTP_PORT = 2121;
const SMTP_PORT = 2525;

const DATA_DIR = path.join(__dirname, 'data');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');
const TELEMETRY_FILE = path.join(DATA_DIR, 'telemetry.json');
const EMAILS_FILE = path.join(DATA_DIR, 'emails.json');
const FTP_ROOT = path.join(DATA_DIR, 'ftp_storage');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const TRIGGER_RULES_FILE = path.join(DATA_DIR, 'trigger_rules.json');
const INCIDENTS_FILE = path.join(DATA_DIR, 'incidents.json');

// Khởi tạo các thư mục lưu trữ FTP nếu chưa tồn tại
['public', 'admin_only', 'firmware', 'backups', 'logs'].forEach(dir => {
  const p = path.join(FTP_ROOT, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

// Helper đọc/ghi JSON an toàn
function readJson(filePath, defaultValue = []) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf-8');
      return defaultValue;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content || '[]');
  } catch (err) {
    console.error(`Lỗi đọc file ${filePath}:`, err.message);
    return defaultValue;
  }
}

function writeJson(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error(`Lỗi ghi file ${filePath}:`, err.message);
    return false;
  }
}

// Khởi tạo Express App
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Thiết lập lưu trữ upload file qua Web FTP Explorer
const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const allowed = ['admin_only', 'firmware', 'backups', 'logs'];
    const targetFolder = allowed.includes(req.query.folder) ? req.query.folder : 'public';
    const dest = path.join(FTP_ROOT, targetFolder);
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    // Giữ nguyên tên file an toàn
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, safeName);
  }
});
const upload = multer({ storage: uploadStorage });

// Danh sách client đang kết nối Server-Sent Events (SSE) để cập nhật Web Động Realtime
let sseClients = [];
function broadcastSSE(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => client.res.write(payload));
}

// -----------------------------------------------------------------------------
// 1. CÁC API WEBSERVER & WEB ĐỘNG (HTTP RESTful & SSE)
// -----------------------------------------------------------------------------

// SSE Endpoint cho Web nhận dữ liệu động tức thì (Real-time Push)
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  res.write(`data: ${JSON.stringify({ message: 'Connected to IoT Telemetry Stream' })}\n\n`);

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

// Thống kê Dashboard KPI
app.get('/api/stats', (req, res) => {
  const devices = readJson(DEVICES_FILE);
  const total = devices.length;
  const warningCount = devices.filter(d => d.status === 'Warning' || d.status === 'Critical').length;
  const normalCount = total - warningCount;
  
  // Tính trung bình các thông số
  const tempDevices = devices.filter(d => d.type === 'Temperature');
  const avgTemp = tempDevices.length > 0 
    ? (tempDevices.reduce((sum, d) => sum + d.value, 0) / tempDevices.length).toFixed(1)
    : 38.5;

  const netDevices = devices.filter(d => d.type === 'Network Bandwidth');
  const totalNet = netDevices.reduce((sum, d) => sum + d.value, 0).toFixed(1);

  res.json({
    totalDevices: total,
    normalCount,
    warningCount,
    avgTemperature: Number(avgTemp),
    totalNetworkLoad: Number(totalNet),
    protocolsRunning: [
      { name: 'HTTP / Web UI', port: HTTP_PORT, status: 'Online' },
      { name: 'FTP Server (RFC 959)', port: FTP_PORT, status: 'Online' },
      { name: 'SMTP Mail Server (RFC 5321)', port: SMTP_PORT, status: 'Online' }
    ]
  });
});

// -----------------------------------------------------------------------------
// QUẢN LÝ PHIÊN ĐĂNG NHẬP & PHÂN QUYỀN (ADMIN / GUEST)
// -----------------------------------------------------------------------------
// Bộ lưu trữ token quản trị viên đang hoạt động (In-memory Admin Session Store)
const activeAdminTokens = new Set();

// Trích xuất vai trò của request dựa trên Authorization Token hợp lệ
function getRequestRole(req) {
  const authHeader = req.headers['authorization'];
  const authToken = authHeader 
    ? authHeader.replace(/^Bearer\s+/i, '').trim() 
    : (req.headers['x-auth-token'] || req.query.token);

  if (authToken && activeAdminTokens.has(authToken)) {
    return 'admin';
  }
  return 'guest';
}

// Middleware bảo vệ: Chỉ cho phép tài khoản Admin đã đăng nhập
function requireAdminRole(req, res, next) {
  const role = getRequestRole(req);
  if (role !== 'admin') {
    return res.status(403).json({
      error: 'Quyền truy cập bị từ chối: Thao tác này yêu cầu quyền ADMIN. Vui lòng đăng nhập để tiếp tục!'
    });
  }
  next();
}

// API Xác thực: Đăng nhập Quản trị viên
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === 'admin' && password === 'admin123') {
    const token = 'adm_' + crypto.randomBytes(24).toString('hex');
    activeAdminTokens.add(token);
    console.log(`[Auth Server] Admin đăng nhập thành công. Token: ${token.substring(0, 12)}...`);
    return res.json({
      success: true,
      token,
      role: 'admin',
      user: {
        username: 'admin',
        role: 'admin',
        displayName: 'Quản trị viên Hệ thống (Admin)'
      }
    });
  }

  console.warn(`[Auth Server] Đăng nhập thất bại: user="${username}"`);
  return res.status(401).json({
    success: false,
    error: 'Tên đăng nhập hoặc mật khẩu không chính xác! (Gợi ý: admin / admin123)'
  });
});

// API Xác thực: Đăng xuất
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers['authorization'];
  const authToken = authHeader 
    ? authHeader.replace(/^Bearer\s+/i, '').trim() 
    : (req.headers['x-auth-token'] || req.query.token);

  if (authToken) {
    activeAdminTokens.delete(authToken);
  }
  res.json({ success: true, message: 'Đăng xuất tài khoản Admin thành công' });
});

// API Xác thực: Kiểm tra trạng thái phiên làm việc hiện tại
app.get('/api/auth/me', (req, res) => {
  const role = getRequestRole(req);
  if (role === 'admin') {
    return res.json({
      authenticated: true,
      role: 'admin',
      user: {
        username: 'admin',
        role: 'admin',
        displayName: 'Quản trị viên Hệ thống (Admin)'
      }
    });
  }
  return res.json({
    authenticated: false,
    role: 'guest',
    user: {
      username: 'guest',
      role: 'guest',
      displayName: 'Khách vãng lai (Guest - Chỉ Xem)'
    }
  });
});

// Lấy danh sách thiết bị
app.get('/api/devices', (req, res) => {
  const devices = readJson(DEVICES_FILE);
  res.json(devices);
});

// E-Form: Thêm thiết bị mới (Yêu cầu quyền Admin)
app.post('/api/devices', requireAdminRole, (req, res) => {
  const { name, type, location, minThreshold, maxThreshold, unit, ipAddress, macAddress } = req.body;
  if (!name || !type) {
    return res.status(400).json({ error: 'Tên thiết bị và loại cảm biến không được để trống' });
  }

  const devices = readJson(DEVICES_FILE);
  const newId = `DEV-${Date.now().toString().slice(-4)}`;
  
  // Giá trị khởi tạo mặc định theo loại
  let initialValue = 25.0;
  let finalUnit = unit;
  if (type === 'Temperature') { initialValue = 35.0; finalUnit = finalUnit || '°C'; }
  else if (type === 'Humidity') { initialValue = 55.0; finalUnit = finalUnit || '%'; }
  else if (type === 'Network Bandwidth') { initialValue = 50.0; finalUnit = finalUnit || 'Mbps'; }
  else if (type === 'CPU Load') { initialValue = 40.0; finalUnit = finalUnit || '%'; }
  else if (type === 'Pressure') { initialValue = 1013.0; finalUnit = finalUnit || 'hPa'; }

  const min = Number(minThreshold) || 10;
  const max = Number(maxThreshold) || 80;
  const status = (initialValue > max) ? 'Warning' : 'Normal';

  const newDevice = {
    id: newId,
    name: name.trim(),
    type,
    location: (location || 'Phòng Kỹ thuật').trim(),
    value: Number(initialValue.toFixed(1)),
    unit: finalUnit || 'units',
    minThreshold: min,
    maxThreshold: max,
    status,
    ipAddress: ipAddress || `192.168.1.${Math.floor(Math.random() * 200) + 10}`,
    macAddress: macAddress || `00:${Math.floor(Math.random()*89+10)}:${Math.floor(Math.random()*89+10)}:${Math.floor(Math.random()*89+10)}:AA:BB`,
    lastUpdated: new Date().toISOString()
  };

  devices.unshift(newDevice);
  writeJson(DEVICES_FILE, devices);

  // Phát tín hiệu Web Động cập nhật giao diện
  broadcastSSE('device_added', newDevice);
  broadcastSSE('system_refresh', { reason: 'Device Added' });

  res.status(201).json(newDevice);
});

// E-Form: Chỉnh sửa thiết bị (Yêu cầu quyền Admin)
app.put('/api/devices/:id', requireAdminRole, (req, res) => {
  const { id } = req.params;
  const { name, location, minThreshold, maxThreshold, status, relayStatus } = req.body;
  const devices = readJson(DEVICES_FILE);
  const index = devices.findIndex(d => d.id === id);

  if (index === -1) {
    return res.status(404).json({ error: 'Không tìm thấy thiết bị' });
  }

  if (name) devices[index].name = name.trim();
  if (location) devices[index].location = location.trim();
  if (minThreshold !== undefined) devices[index].minThreshold = Number(minThreshold);
  if (maxThreshold !== undefined) devices[index].maxThreshold = Number(maxThreshold);
  if (status) devices[index].status = status;
  if (relayStatus) devices[index].relayStatus = relayStatus;
  
  // Tự động đánh giá lại trạng thái ngưỡng
  if (devices[index].value > devices[index].maxThreshold) {
    devices[index].status = 'Warning';
  } else {
    devices[index].status = 'Normal';
  }
  devices[index].lastUpdated = new Date().toISOString();

  writeJson(DEVICES_FILE, devices);
  broadcastSSE('device_updated', devices[index]);
  broadcastSSE('system_refresh', { reason: 'Device Updated' });

  res.json(devices[index]);
});

// Xóa thiết bị (Yêu cầu quyền Admin)
app.delete('/api/devices/:id', requireAdminRole, (req, res) => {
  const { id } = req.params;
  let devices = readJson(DEVICES_FILE);
  const initialLen = devices.length;
  devices = devices.filter(d => d.id !== id);

  if (devices.length === initialLen) {
    return res.status(404).json({ error: 'Không tìm thấy thiết bị để xóa' });
  }

  writeJson(DEVICES_FILE, devices);
  broadcastSSE('device_deleted', { id });
  broadcastSSE('system_refresh', { reason: 'Device Deleted' });

  res.json({ message: 'Xóa thiết bị thành công', id });
});

// API Kiểm tra kết nối nhanh: Gửi gói tin ICMP Ping tới thiết bị và đo độ trễ Latency/RTT
app.post('/api/devices/:id/ping', (req, res) => {
  const { id } = req.params;
  const devices = readJson(DEVICES_FILE);
  const device = devices.find(d => d.id === id);

  if (!device) return res.status(404).json({ error: 'Không tìm thấy thiết bị' });

  // Sinh độ trễ thực tế dao động theo đặc tính mạng
  const t1 = (0.6 + Math.random() * 0.9).toFixed(2);
  const t2 = (0.7 + Math.random() * 0.8).toFixed(2);
  const t3 = (0.5 + Math.random() * 0.7).toFixed(2);
  const t4 = (0.8 + Math.random() * 1.0).toFixed(2);
  const avg = Number(((parseFloat(t1) + parseFloat(t2) + parseFloat(t3) + parseFloat(t4)) / 4).toFixed(2));

  device.latency = avg;
  device.lastPingTime = new Date().toISOString();
  writeJson(DEVICES_FILE, devices);
  broadcastSSE('device_updated', device);

  const terminalLines = [
    `PING ${device.ipAddress} (${device.ipAddress}): 56 data bytes`,
    `64 bytes from ${device.ipAddress}: icmp_seq=1 ttl=64 time=${t1} ms`,
    `64 bytes from ${device.ipAddress}: icmp_seq=2 ttl=64 time=${t2} ms`,
    `64 bytes from ${device.ipAddress}: icmp_seq=3 ttl=64 time=${t3} ms`,
    `64 bytes from ${device.ipAddress}: icmp_seq=4 ttl=64 time=${t4} ms`,
    `--- ${device.ipAddress} ping statistics ---`,
    `4 packets transmitted, 4 packets received, 0.0% packet loss, rtt avg = ${avg} ms`,
    `[SUCCESS] Thiết bị ${device.name} [IP: ${device.ipAddress}] đang trực tuyến, RTT phản hồi: ${avg} ms.`
  ];

  res.json({
    success: true,
    deviceId: device.id,
    ipAddress: device.ipAddress,
    latency: avg,
    rtt: `${avg} ms`,
    packetLoss: 0,
    terminalLines,
    message: `Ping thành công tới ${device.ipAddress} (RTT = ${avg} ms)`,
    device
  });
});

// Tác động nghiệp vụ: Gửi lệnh điều khiển khẩn cấp tới thiết bị (Ping, Reboot, Relay, Hạ Nhiệt...)
app.post('/api/devices/:id/command', (req, res) => {
  const { id } = req.params;
  const { command } = req.body;
  const devices = readJson(DEVICES_FILE);
  const device = devices.find(d => d.id === id);

  if (!device) return res.status(404).json({ error: 'Không tìm thấy thiết bị' });

  // Kiểm tra quyền Admin đối với các lệnh can thiệp phần cứng / đổi cấu hình (Ngoại trừ Ping Test chỉ đọc)
  if (command !== 'ping') {
    if (getRequestRole(req) !== 'admin') {
      return res.status(403).json({ error: 'Quyền truy cập bị từ chối: Thao tác này yêu cầu quyền ADMIN. Vui lòng đăng nhập để tiếp tục!' });
    }
  }

  let logMessage = '';
  let terminalLines = [];

  if (command === 'ping') {
    const t1 = (1.2 + Math.random() * 0.8).toFixed(2);
    const t2 = (1.3 + Math.random() * 0.9).toFixed(2);
    const t3 = (1.1 + Math.random() * 0.6).toFixed(2);
    const t4 = (1.4 + Math.random() * 0.7).toFixed(2);
    const avg = Number(((parseFloat(t1) + parseFloat(t2) + parseFloat(t3) + parseFloat(t4)) / 4).toFixed(2));

    device.latency = avg;
    device.lastPingTime = new Date().toISOString();
    writeJson(DEVICES_FILE, devices);
    broadcastSSE('device_updated', device);

    terminalLines = [
      `PING ${device.ipAddress} (${device.ipAddress}): 56 data bytes`,
      `64 bytes from ${device.ipAddress}: icmp_seq=1 ttl=64 time=${t1} ms`,
      `64 bytes from ${device.ipAddress}: icmp_seq=2 ttl=64 time=${t2} ms`,
      `64 bytes from ${device.ipAddress}: icmp_seq=3 ttl=64 time=${t3} ms`,
      `64 bytes from ${device.ipAddress}: icmp_seq=4 ttl=64 time=${t4} ms`,
      `--- ${device.ipAddress} ping statistics ---`,
      `4 packets transmitted, 4 packets received, 0.0% packet loss, rtt avg = ${avg} ms`,
      `[SUCCESS] Thiết bị ${device.name} [IP: ${device.ipAddress} | MAC: ${device.macAddress}] đang trực tuyến và phản hồi tốt.`
    ];
    logMessage = `Ping test thành công tới ${device.ipAddress} (RTT trung bình ${avg} ms)`;
  } else if (command === 'reboot' || command === 'restart') {
    device.value = Number((device.minThreshold + (device.maxThreshold - device.minThreshold) * 0.35).toFixed(1));
    device.status = 'Normal';
    device.relayStatus = 'OFF';
    device.lastUpdated = new Date().toISOString();
    writeJson(DEVICES_FILE, devices);
    broadcastSSE('device_updated', device);
    broadcastSSE('system_refresh', { reason: 'Device Rebooted' });

    terminalLines = [
      `[CMD] Gửi tín hiệu REBOOT tới cổng điều khiển ${device.ipAddress}:23...`,
      `[DEVICE] Đang đóng các tiến trình viễn trắc và chuẩn bị khởi động lại...`,
      `[KERNEL] Nạp lại firmware v3.1.2 và tải thông số bộ nhớ flash...`,
      `[INIT] Cảm biến đo được cân chỉnh lại, giá trị đo an toàn: ${device.value} ${device.unit}`,
      `[SUCCESS] Thiết bị ${device.name} (${device.id}) đã khởi động lại hoàn tất và đồng bộ về trạng thái An Toàn (Normal).`
    ];
    logMessage = `Thiết bị ${device.id} đã khởi động lại (Reboot) thành công!`;
  } else if (command === 'toggle_relay' || command === 'relay') {
    device.relayStatus = (device.relayStatus === 'ON' ? 'OFF' : 'ON');
    device.lastUpdated = new Date().toISOString();
    writeJson(DEVICES_FILE, devices);
    broadcastSSE('device_updated', device);
    broadcastSSE('system_refresh', { reason: 'Relay Toggled' });

    terminalLines = [
      `[CMD] Gửi lệnh đổi trạng thái rơ-le phần cứng tới bo mạch ${device.macAddress}...`,
      `[RELAY] Trạng thái rơ-le bảo vệ thiết bị: ${device.relayStatus === 'ON' ? 'BẬT (ACTIVE / ON)' : 'TẮT (STANDBY / OFF)'}`,
      `[FEEDBACK] ${device.relayStatus === 'ON' ? 'Còi/Đèn cảnh báo tại vị trí ' + device.location + ' đã được BẬT.' : 'Đã TẮT còi/đèn cảnh báo tại ' + device.location + '.'}`
    ];
    logMessage = `Rơ-le bảo vệ đã chuyển sang: ${device.relayStatus === 'ON' ? 'BẬT (ON)' : 'TẮT (OFF)'}`;
  } else if (command === 'cool_down') {
    device.value = Number((device.minThreshold + (device.maxThreshold - device.minThreshold) * 0.4).toFixed(1));
    device.status = 'Normal';
    device.lastUpdated = new Date().toISOString();
    writeJson(DEVICES_FILE, devices);
    broadcastSSE('device_updated', device);
    broadcastSSE('system_refresh', { reason: 'Cool Down Executed' });

    terminalLines = [
      `[CMD] Kích hoạt hệ thống làm mát / hạ tải viễn trắc tới ${device.ipAddress}...`,
      `[FEEDBACK] Giá trị đo hạ về mức an toàn: ${device.value} ${device.unit}`,
      `[STATUS] Trạng thái thiết bị chuyển về An Toàn (Normal).`
    ];
    logMessage = `Đã kích hoạt chế độ làm mát / hạ tải an toàn cho ${device.id}`;
  } else if (command === 'trigger_warning') {
    device.value = Number((device.maxThreshold + 5.5).toFixed(1));
    device.status = 'Warning';
    device.relayStatus = 'ON';
    device.lastUpdated = new Date().toISOString();
    writeJson(DEVICES_FILE, devices);
    broadcastSSE('device_updated', device);
    broadcastSSE('system_refresh', { reason: 'Warning Triggered' });
    sendAlertEmail(device);

    terminalLines = [
      `[SIMULATE] Kích hoạt giả lập dữ liệu đo vượt ngưỡng an toàn...`,
      `[OVERLOAD] Giá trị đo nhảy lên: ${device.value} ${device.unit} (Ngưỡng tối đa: ${device.maxThreshold} ${device.unit})`,
      `[ALERT] Trạng thái chuyển sang: WARNING (CẢNH BÁO). Tự động kích hoạt Relay cảnh báo sự cố.`,
      `[SMTP] Đã tự động kích hoạt tiến trình gửi email cảnh báo SMTP đa miền tới manager@monitoring-lab.vn.`
    ];
    logMessage = `Đã kích hoạt cảnh báo sự cố & tự động gửi mail SMTP cho ${device.id}`;
  } else {
    return res.status(400).json({ error: `Lệnh '${command}' không hợp lệ` });
  }

  res.json({
    message: logMessage,
    command,
    terminalLines,
    device
  });
});

// API IoT: Nhận telemetry từ cảm biến bên ngoài (Tác động làm thay đổi dữ liệu qua API)
app.post('/api/telemetry/push', (req, res) => {
  const { deviceId, value, unit } = req.body;
  if (!deviceId || value === undefined) {
    return res.status(400).json({ error: 'deviceId và value là bắt buộc' });
  }

  const devices = readJson(DEVICES_FILE);
  const device = devices.find(d => d.id === deviceId);

  if (!device) {
    return res.status(404).json({ error: `Không tìm thấy thiết bị ${deviceId}` });
  }

  device.value = Number(Number(value).toFixed(1));
  if (unit) device.unit = unit;
  device.lastUpdated = new Date().toISOString();

  // Đánh giá ngưỡng cảnh báo tại Back-end
  if (device.value > device.maxThreshold) {
    if (device.status !== 'Warning') {
      device.status = 'Warning';
      sendAlertEmail(device);
    }
  } else {
    device.status = 'Normal';
  }

  writeJson(DEVICES_FILE, devices);
  broadcastSSE('telemetry_update', { device, time: new Date().toLocaleTimeString() });

  res.json({ success: true, device });
});

// Lấy dữ liệu đồ thị telemetry
app.get('/api/telemetry', (req, res) => {
  const telemetry = readJson(TELEMETRY_FILE);
  res.json(telemetry);
});

// -----------------------------------------------------------------------------
// 2. HỆ THỐNG XỬ LÝ BACK-END & BỘ MÔ PHỎNG IoT TỰ ĐỘNG (Dynamic Engine)
// -----------------------------------------------------------------------------
let simulationActive = true;
let lastEmailAlertTime = 0;

function runBackendProcessing() {
  if (!simulationActive) return;

  const devices = readJson(DEVICES_FILE);
  if (!devices || devices.length === 0) return;

  // Lựa chọn ngẫu nhiên 2-3 thiết bị để cập nhật biến động dữ liệu viễn trắc
  let hasChanges = false;
  devices.forEach(device => {
    // 60% cơ hội cập nhật mỗi chu kỳ
    if (Math.random() > 0.4) {
      hasChanges = true;
      const delta = (Math.random() * 3.0 - 1.4); // Biến thiên nhỏ +/-
      let newVal = device.value + delta;
      
      // Giữ trong khoảng hợp lý
      if (device.type === 'Temperature') newVal = Math.max(18, Math.min(92, newVal));
      else if (device.type === 'Humidity') newVal = Math.max(20, Math.min(95, newVal));
      else if (device.type === 'Network Bandwidth') newVal = Math.max(5, Math.min(98, newVal));
      else if (device.type === 'CPU Load') newVal = Math.max(10, Math.min(99, newVal));
      else if (device.type === 'Pressure') newVal = Math.max(980, Math.min(1040, newVal));

      device.value = Number(newVal.toFixed(1));
      device.lastUpdated = new Date().toISOString();

      // Kiểm tra ngưỡng cảnh báo (Back-end Logic)
      if (device.value > device.maxThreshold) {
        if (device.status !== 'Warning') {
          device.status = 'Warning';
          sendAlertEmail(device);
        }
      } else {
        device.status = 'Normal';
      }
    }
  });

  if (hasChanges) {
    writeJson(DEVICES_FILE, devices);

    // Cập nhật telemetry history cho đồ thị
    const history = readJson(TELEMETRY_FILE);
    const tempDevs = devices.filter(d => d.type === 'Temperature');
    const humDevs = devices.filter(d => d.type === 'Humidity');
    const netDevs = devices.filter(d => d.type === 'Network Bandwidth');
    const cpuDevs = devices.filter(d => d.type === 'CPU Load');

    const avgTemp = tempDevs.length ? (tempDevs.reduce((s, d) => s + d.value, 0) / tempDevs.length).toFixed(1) : 38;
    const avgHum = humDevs.length ? (humDevs.reduce((s, d) => s + d.value, 0) / humDevs.length).toFixed(1) : 60;
    const netLoad = netDevs.length ? (netDevs.reduce((s, d) => s + d.value, 0) / netDevs.length).toFixed(1) : 55;
    const cpuLoad = cpuDevs.length ? (cpuDevs.reduce((s, d) => s + d.value, 0) / cpuDevs.length).toFixed(1) : 45;

    const newPoint = {
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      avgTemp: Number(avgTemp),
      avgHumidity: Number(avgHum),
      networkBandwidth: Number(netLoad),
      cpuLoad: Number(cpuLoad)
    };

    history.push(newPoint);
    if (history.length > 20) history.shift(); // Giữ 20 điểm gần nhất
    writeJson(TELEMETRY_FILE, history);

    // Gửi realtime qua SSE cho giao diện web
    broadcastSSE('telemetry_tick', {
      point: newPoint,
      devices
    });
  }
}

// Bật bộ sinh dữ liệu IoT tự động mỗi 3 giây
setInterval(runBackendProcessing, 3000);

// Bật/tắt bộ giả lập từ giao diện (Yêu cầu quyền Admin)
app.post('/api/simulation/toggle', requireAdminRole, (req, res) => {
  simulationActive = !simulationActive;
  res.json({ simulationActive });
});

// -----------------------------------------------------------------------------
// 3. HỆ THỐNG FTP SERVER (RFC 959) & WEB FTP EXPLORER
// -----------------------------------------------------------------------------

// Khởi chạy FTP Server bằng ftp-srv trên cổng 2121
let ftpServerInstance = null;
try {
  ftpServerInstance = new FtpSrv({
    url: `ftp://127.0.0.1:${FTP_PORT}`,
    anonymous: false,
    pasv_url: '127.0.0.1'
  });

  ftpServerInstance.on('login', ({ connection, username, password }, resolve, reject) => {
    // Tài khoản Admin: Quyền Full trên toàn bộ thư mục (bao gồm cả admin_only)
    if (username === 'admin' && password === 'admin123') {
      console.log(`[FTP Server] Admin đăng nhập thành công.`);
      return resolve({ root: FTP_ROOT, readOnly: false });
    }
    // Tài khoản Guest: Quyền Read-Only chỉ trên thư mục public
    if (username === 'guest' && password === 'guest123') {
      console.log(`[FTP Server] Guest đăng nhập thành công (Read-Only).`);
      return resolve({ root: path.join(FTP_ROOT, 'public'), readOnly: true });
    }

    console.warn(`[FTP Server] Đăng nhập thất bại: user=${username}`);
    return reject(new Error('Sai tên đăng nhập hoặc mật khẩu FTP'));
  });

  ftpServerInstance.listen().then(() => {
    console.log(`[FTP Server] Khởi chạy thành công tại ftp://127.0.0.1:${FTP_PORT}`);
  }).catch(err => {
    console.error(`[FTP Server Error]:`, err.message);
  });
} catch (e) {
  console.error(`Không thể khởi tạo FTP Server:`, e.message);
}

// Web FTP Explorer API: Liệt kê danh sách file có phân quyền (Admin vs Guest)
app.get('/api/ftp/files', (req, res) => {
  const role = getRequestRole(req);
  const fileList = [];

  function scanFolder(folderName, folderPath, permission) {
    if (!fs.existsSync(folderPath)) return;
    const items = fs.readdirSync(folderPath);
    items.forEach(item => {
      const fullPath = path.join(folderPath, item);
      const stat = fs.statSync(fullPath);
      fileList.push({
        name: item,
        folder: folderName,
        relativePath: `${folderName}/${item}`,
        size: stat.size,
        sizeFormatted: (stat.size / 1024).toFixed(1) + ' KB',
        updatedAt: stat.mtime.toLocaleString('vi-VN'),
        permission,
        isDirectory: stat.isDirectory()
      });
    });
  }

  // Thư mục công cộng và tài nguyên hệ thống
  scanFolder('public', path.join(FTP_ROOT, 'public'), 'Read Only (Guest) / Read-Write (Admin)');
  scanFolder('firmware', path.join(FTP_ROOT, 'firmware'), 'Firmware OTA Binaries (.bin / .hex)');
  scanFolder('backups', path.join(FTP_ROOT, 'backups'), 'Cấu Hình Bản Sao Lưu (.cfg / .json)');
  scanFolder('logs', path.join(FTP_ROOT, 'logs'), 'Nhật Ký Hệ Thống (.log)');

  // Thư mục admin_only chỉ tài khoản Admin đã đăng nhập mới được xem
  if (role === 'admin') {
    scanFolder('admin_only', path.join(FTP_ROOT, 'admin_only'), 'Confidential (Admin Full Access)');
  }

  res.json({
    role,
    files: fileList,
    ftpHost: '127.0.0.1',
    ftpPort: FTP_PORT,
    accounts: [
      { user: 'admin', pass: 'admin123', role: 'Full Access (Read/Write/Delete)', scope: '/ (Toàn bộ kho)' },
      { user: 'guest', pass: 'guest123', role: 'Read-Only (Chỉ tải về)', scope: '/public' }
    ]
  });
});

// Tải file về qua Web
app.get('/api/ftp/download', (req, res) => {
  const relPath = req.query.path;
  const role = getRequestRole(req);

  if (!relPath) return res.status(400).json({ error: 'Thiếu đường dẫn file' });
  if (relPath.startsWith('admin_only') && role !== 'admin') {
    return res.status(403).json({ error: 'Bạn không có quyền truy cập thư mục admin_only. Vui lòng đăng nhập quyền Quản trị viên!' });
  }

  const targetPath = path.join(FTP_ROOT, relPath);
  if (!fs.existsSync(targetPath)) return res.status(404).json({ error: 'File không tồn tại' });

  res.download(targetPath);
});

// Upload file lên FTP qua Web (Chỉ Admin)
app.post('/api/ftp/upload', requireAdminRole, upload.single('file'), (req, res) => {
  const role = getRequestRole(req);
  const targetFolder = req.query.folder || 'public';

  if (targetFolder === 'admin_only' && role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ Admin mới có quyền tải file vào admin_only' });
  }

  if (!req.file) return res.status(400).json({ error: 'Chưa chọn file để tải lên' });

  broadcastSSE('ftp_change', { action: 'upload', file: req.file.filename });
  res.json({
    message: 'Tải file lên FTP thành công',
    file: req.file.filename,
    folder: targetFolder
  });
});

// Xóa file FTP qua Web (Chỉ Admin)
app.delete('/api/ftp/files', requireAdminRole, (req, res) => {
  const { path: relPath } = req.body;
  const targetPath = path.join(FTP_ROOT, relPath);
  if (!fs.existsSync(targetPath)) {
    return res.status(404).json({ error: 'File không tồn tại' });
  }

  try {
    fs.unlinkSync(targetPath);
    broadcastSSE('ftp_change', { action: 'delete', file: relPath });
    res.json({ message: 'Xóa file FTP thành công' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 4. HỆ THỐNG MAIL SERVER (SMTP) ĐA MIỀN (Multi-Domain)
// -----------------------------------------------------------------------------

// Helper giải mã MIME Encoded-Word (RFC 2047: =?charset?encoding?text?=)
function decodeMimeWord(word) {
  const match = word.match(/=\?([^?]+)\?([QBqb])\?([^?]*)\?=/);
  if (!match) return word;
  const charset = match[1].toLowerCase();
  const encoding = match[2].toUpperCase();
  const text = match[3];

  if (encoding === 'B') {
    try {
      return Buffer.from(text, 'base64').toString(charset === 'utf-8' ? 'utf8' : 'latin1');
    } catch {
      return word;
    }
  } else if (encoding === 'Q') {
    try {
      const unescaped = text.replace(/_/g, ' ');
      const bytes = [];
      for (let i = 0; i < unescaped.length; i++) {
        if (unescaped[i] === '=' && i + 2 < unescaped.length && /[0-9A-Fa-f]{2}/.test(unescaped.substr(i + 1, 2))) {
          bytes.push(parseInt(unescaped.substr(i + 1, 2), 16));
          i += 2;
        } else {
          bytes.push(unescaped.charCodeAt(i));
        }
      }
      return Buffer.from(bytes).toString(charset === 'utf-8' ? 'utf8' : 'latin1');
    } catch {
      return word;
    }
  }
  return word;
}

// Helper giải mã chuỗi Header MIME gập dòng (RFC 2047 & RFC 5322 Unfolding)
function decodeMimeHeader(headerStr) {
  if (!headerStr) return '';
  // Nối các dòng gập lại (Header Unfolding)
  let unfolded = headerStr.replace(/\r?\n[\t ]+/g, ' ').trim();
  // Xóa khoảng trắng giữa các encoded-word liền kề theo chuẩn RFC 2047
  while (/(=\?[^?]+\?[QBqb]\?[^?]*\?=)\s+(=\?[^?]+\?[QBqb]\?[^?]*\?=)/.test(unfolded)) {
    unfolded = unfolded.replace(/(=\?[^?]+\?[QBqb]\?[^?]*\?=)\s+(=\?[^?]+\?[QBqb]\?[^?]*\?=)/g, (m, p1, p2) => p1 + p2);
  }
  return unfolded.replace(/=\?[^?]+\?[QBqb]\?[^?]*\?=/g, m => decodeMimeWord(m));
}

// Helper giải mã Quoted-Printable cho thân email (RFC 2045)
function decodeQuotedPrintable(text) {
  if (!text) return '';
  const noSoftBreaks = text.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < noSoftBreaks.length; i++) {
    if (noSoftBreaks[i] === '=' && i + 2 < noSoftBreaks.length && /[0-9A-Fa-f]{2}/.test(noSoftBreaks.substr(i + 1, 2))) {
      bytes.push(parseInt(noSoftBreaks.substr(i + 1, 2), 16));
      i += 2;
    } else {
      bytes.push(noSoftBreaks.charCodeAt(i));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

// Phân tích cú pháp đầy đủ bức thư điện tử chuẩn MIME
function parseRawEmail(rawData) {
  const splitIndex = rawData.search(/\r?\n\r?\n/);
  let headerText = '';
  let bodyText = '';
  if (splitIndex !== -1) {
    headerText = rawData.substring(0, splitIndex);
    bodyText = rawData.substring(splitIndex).replace(/^\r?\n\r?\n/, '');
  } else {
    headerText = rawData;
  }

  // Unfold headers
  const headerLines = [];
  const rawLines = headerText.split(/\r?\n/);
  for (const line of rawLines) {
    if (/^[\t ]+/.test(line) && headerLines.length > 0) {
      headerLines[headerLines.length - 1] += ' ' + line.trim();
    } else {
      headerLines.push(line);
    }
  }

  const headers = {};
  for (const line of headerLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim().toLowerCase();
      const val = line.substring(colonIdx + 1).trim();
      headers[key] = val;
    }
  }

  const subject = headers['subject'] ? decodeMimeHeader(headers['subject']) : 'Không có tiêu đề';
  const from = headers['from'] ? decodeMimeHeader(headers['from']) : '';
  const to = headers['to'] ? decodeMimeHeader(headers['to']) : '';

  let body = bodyText;
  const transferEncoding = (headers['content-transfer-encoding'] || '').toLowerCase().trim();
  if (transferEncoding === 'quoted-printable') {
    body = decodeQuotedPrintable(body);
  } else if (transferEncoding === 'base64') {
    try {
      body = Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    } catch {}
  }

  return { headers, subject, from, to, body };
}

// Khởi chạy SMTP Server tiếp nhận mail đa miền trên cổng 2525
const smtpServer = new SMTPServer({
  secure: false,
  disabledCommands: ['STARTTLS', 'AUTH'],
  onData(stream, session, callback) {
    let rawData = '';
    stream.on('data', chunk => { rawData += chunk.toString(); });
    stream.on('end', () => {
      try {
        console.log(`[SMTP Server] Nhận email mới từ ${session.envelope.mailFrom.address} tới ${session.envelope.rcptTo.map(r => r.address).join(', ')}`);
        
        const toAddress = session.envelope.rcptTo[0]?.address || 'unknown@domain';
        const fromAddress = session.envelope.mailFrom?.address || 'unknown@domain';
        const domain = toAddress.split('@')[1] || 'general';

        // Phân tích cú pháp đầy đủ MIME & giải mã tiếng Việt UTF-8
        const parsed = parseRawEmail(rawData);

        const emails = readJson(EMAILS_FILE);
        const newMail = {
          id: `mail-${Date.now()}`,
          from: parsed.from || fromAddress,
          to: parsed.to || toAddress,
          subject: parsed.subject || 'Không có tiêu đề',
          body: parsed.body || '',
          date: new Date().toISOString(),
          read: false,
          domain
        };

        emails.unshift(newMail);
        writeJson(EMAILS_FILE, emails);

        broadcastSSE('new_email', newMail);
        callback();
      } catch (err) {
        console.error('Lỗi phân tích email:', err);
        callback(err);
      }
    });
  }
});

smtpServer.listen(SMTP_PORT, '127.0.0.1', () => {
  console.log(`[SMTP Server] Khởi chạy thành công tại 127.0.0.1:${SMTP_PORT}`);
});

// Cấu hình Nodemailer gửi mail qua SMTP Server nội bộ
const mailTransporter = nodemailer.createTransport({
  host: '127.0.0.1',
  port: SMTP_PORT,
  secure: false,
  tls: { rejectUnauthorized: false }
});

// Ghi nhật ký sự cố hệ thống
function recordIncident({ deviceId, deviceName, severity, value, threshold, actionTaken, notes }) {
  const incidents = readJson(INCIDENTS_FILE, []);
  const newInc = {
    id: `INC-${Date.now().toString().slice(-6)}`,
    timestamp: new Date().toISOString(),
    deviceId: deviceId || 'DEV-UNK',
    deviceName: deviceName || 'Thiết bị viễn trắc',
    severity: severity || 'WARNING',
    value: value || '--',
    threshold: threshold || '--',
    actionTaken: actionTaken || 'Đã ghi nhận sự cố hệ thống',
    status: 'Active',
    resolvedBy: null,
    notes: notes || 'Hệ thống tự động phát hiện'
  };
  incidents.unshift(newInc);
  if (incidents.length > 50) incidents.pop();
  writeJson(INCIDENTS_FILE, incidents);
  broadcastSSE('new_incident', newInc);
  return newInc;
}

// Hàm tự động bắn email cảnh báo khi cảm biến vượt ngưỡng
async function sendAlertEmail(device) {
  const now = Date.now();
  // Giới hạn 30s giữa các lần gửi tự động để không spam
  if (now - lastEmailAlertTime < 30000) return;
  lastEmailAlertTime = now;

  // Ghi nhận sự cố vào Incident Log
  recordIncident({
    deviceId: device.id,
    deviceName: device.name,
    severity: 'CRITICAL',
    value: `${device.value} ${device.unit}`,
    threshold: `${device.maxThreshold} ${device.unit}`,
    actionTaken: `Tự động bật Relay còi cảnh báo & gửi email SMTP tới manager@monitoring-lab.vn`,
    notes: `Vượt ngưỡng tối đa tại ${device.location}`
  });

  const mailOptions = {
    from: '"IoT Auto Sentinel" <sensor-alert@iot-network.local>',
    to: 'manager@monitoring-lab.vn', // Gửi chéo liên miền sang @monitoring-lab.vn
    subject: `[BÁO ĐỘNG TỰ ĐỘNG] Cảm biến ${device.name} vượt ngưỡng (${device.value} ${device.unit})`,
    text: `CẢNH BÁO TỰ ĐỘNG TỪ HỆ THỐNG GIÁM SÁT MẠNG:\n\n` +
          `Thiết bị: ${device.name} (${device.id})\n` +
          `Vị trí: ${device.location}\n` +
          `Giá trị đo được: ${device.value} ${device.unit}\n` +
          `Ngưỡng cảnh báo: ${device.maxThreshold} ${device.unit}\n` +
          `Địa chỉ IP: ${device.ipAddress}\n` +
          `Thời gian phát hiện: ${new Date().toLocaleString('vi-VN')}\n\n` +
          `Vui lòng truy cập Web Dashboard để kiểm tra và xử lý sự cố.`
  };

  try {
    await mailTransporter.sendMail(mailOptions);
    console.log(`[SMTP Alert] Đã tự động gửi email cảnh báo từ @iot-network.local sang @monitoring-lab.vn`);
  } catch (err) {
    console.error(`[SMTP Alert Error]:`, err.message);
  }
}

// API Webmail: Lấy danh sách email (hỗ trợ lọc theo miền)
app.get('/api/emails', (req, res) => {
  const { domain, search } = req.query;
  let emails = readJson(EMAILS_FILE);

  if (domain && domain !== 'all') {
    emails = emails.filter(m => m.domain === domain || m.to.includes(domain));
  }

  if (search) {
    const s = search.toLowerCase();
    emails = emails.filter(m => 
      m.subject.toLowerCase().includes(s) || 
      m.from.toLowerCase().includes(s) || 
      m.body.toLowerCase().includes(s)
    );
  }

  res.json({
    supportedDomains: ['iot-network.local', 'monitoring-lab.vn'],
    emails
  });
});

// API Webmail: Soạn và gửi mail qua giao thức SMTP (Yêu cầu quyền Admin)
app.post('/api/emails/send', requireAdminRole, async (req, res) => {
  const { from, to, subject, body } = req.body;
  if (!from || !to || !subject) {
    return res.status(400).json({ error: 'Người gửi, người nhận và tiêu đề không được để trống' });
  }

  try {
    const info = await mailTransporter.sendMail({
      from,
      to,
      subject,
      text: body || ''
    });

    res.json({
      message: 'Email đã được gửi thành công qua giao thức SMTP (cổng 2525)',
      info
    });
  } catch (err) {
    res.status(500).json({ error: 'Lỗi gửi mail qua SMTP: ' + err.message });
  }
});

// Đánh dấu đã đọc email
app.put('/api/emails/:id/read', (req, res) => {
  const { id } = req.params;
  const emails = readJson(EMAILS_FILE);
  const mail = emails.find(m => m.id === id);
  if (mail) {
    mail.read = true;
    writeJson(EMAILS_FILE, emails);
  }
  res.json({ success: true });
});

// Trigger test cảnh báo thủ công (Yêu cầu quyền Admin)
app.post('/api/alerts/trigger-test', requireAdminRole, async (req, res) => {
  const devices = readJson(DEVICES_FILE);
  const target = devices[0] || { name: 'Demo Sensor', id: 'DEMO-01', value: 99.9, unit: '°C', maxThreshold: 80, location: 'Lab' };
  await sendAlertEmail(target);
  res.json({ message: 'Đã kích hoạt cảnh báo & gửi email SMTP thành công!' });
});

// =============================================================================
// 5. PACKET SNIFFER & PROTOCOL INSPECTOR BUFFER
// =============================================================================
let packetSeq = 1000;
const capturedPackets = [];

const mockPacketBlueprints = [
  {
    proto: 'HTTP/SSE',
    src: '192.168.1.100:54210',
    dst: '192.168.1.1:3000',
    len: 218,
    info: 'GET /api/stream HTTP/1.1 (EventStream SSE Keep-Alive)',
    layerEth: { src: '00:1A:2B:3C:4D:5E', dst: '00:0C:29:8F:A1:33', type: '0x0800 (IPv4)' },
    layerIp: { src: '192.168.1.100', dst: '192.168.1.1', proto: 'TCP (6)', ttl: 64 },
    layerTrans: { srcPort: 54210, dstPort: 3000, seq: 1048201, ack: 893120, flags: 'PSH, ACK' },
    layerApp: { proto: 'Hypertext Transfer Protocol (HTTP/1.1)', desc: 'GET /api/stream HTTP/1.1\r\nHost: 127.0.0.1:3000\r\nAccept: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive' },
    hex: '00 0c 29 8f a1 33 00 1a 2b 3c 4d 5e 08 00 45 00\n00 da 1a 2b 40 00 40 06 7c 4a c0 a8 01 64 c0 a8\n01 01 d3 c2 0b b8 00 10 00 29 00 00 00 00 80 18\n01 f5 7e 8a 00 00 47 45 54 20 2f 61 70 69 2f 73'
  },
  {
    proto: 'Modbus/TCP',
    src: '192.168.1.10:502',
    dst: '192.168.1.1:51234',
    len: 76,
    info: 'Resp: Func 03 Read Holding Regs (Slave 1, Regs 40001..40004: Temp=38.4C, Hum=62.1%)',
    layerEth: { src: '00:E0:4C:68:01:10', dst: '00:0C:29:8F:A1:33', type: '0x0800 (IPv4)' },
    layerIp: { src: '192.168.1.10', dst: '192.168.1.1', proto: 'TCP (6)', ttl: 128 },
    layerTrans: { srcPort: 502, dstPort: 51234, seq: 42918, ack: 11029, flags: 'PSH, ACK' },
    layerApp: { proto: 'Modbus Application Protocol (MBAP)', desc: 'Transaction ID: 0x0001, Unit ID: 1, Function: 0x03, Byte Count: 8, Data: [01 80 02 6D 00 01 32 00]' },
    hex: '00 0c 29 8f a1 33 00 e0 4c 68 01 10 08 00 45 00\n00 4c 2a 10 40 00 80 06 6b 91 c0 a8 01 0a c0 a8\n01 01 01 f6 c8 22 00 00 a7 9e 00 00 2b 15 50 18\n00 01 00 00 00 07 01 03 08 01 80 02 6d 00 01 32'
  },
  {
    proto: 'FTP',
    src: '127.0.0.1:49812',
    dst: '127.0.0.1:2121',
    len: 94,
    info: 'Cmd: RETR /firmware/esp32_gateway_firmware_v2.4.1.bin (RFC 959 File Transfer)',
    layerEth: { src: '00:00:00:00:00:00', dst: '00:00:00:00:00:00', type: '0x0800 (IPv4)' },
    layerIp: { src: '127.0.0.1', dst: '127.0.0.1', proto: 'TCP (6)', ttl: 64 },
    layerTrans: { srcPort: 49812, dstPort: 2121, seq: 849102, ack: 42109, flags: 'PSH, ACK' },
    layerApp: { proto: 'File Transfer Protocol (FTP RFC 959)', desc: 'RETR /firmware/esp32_gateway_firmware_v2.4.1.bin\r\nUser: admin\r\nChannel: Control (Port 2121)' },
    hex: '00 00 00 00 00 00 00 00 00 00 00 00 08 00 45 00\n00 5e 00 00 40 00 40 06 7f 76 7f 00 00 01 7f 00\n00 01 c2 94 08 49 00 0c f4 ce 00 00 a4 7d 80 18\n52 45 54 52 20 2f 66 69 72 6d 77 61 72 65 2f 65'
  },
  {
    proto: 'SMTP',
    src: '127.0.0.1:2525',
    dst: '127.0.0.1:54911',
    len: 68,
    info: 'Resp: 250 2.0.0 Ok: queued as 7F19AB24 (Relay @iot-network.local -> @monitoring-lab.vn)',
    layerEth: { src: '00:00:00:00:00:00', dst: '00:00:00:00:00:00', type: '0x0800 (IPv4)' },
    layerIp: { src: '127.0.0.1', dst: '127.0.0.1', proto: 'TCP (6)', ttl: 64 },
    layerTrans: { srcPort: 2525, dstPort: 54911, seq: 112093, ack: 89401, flags: 'PSH, ACK' },
    layerApp: { proto: 'Simple Mail Transfer Protocol (SMTP RFC 5321)', desc: '250 2.0.0 Ok: queued as 7F19AB24\r\nFrom: sensor-alert@iot-network.local\r\nTo: manager@monitoring-lab.vn' },
    hex: '00 00 00 00 00 00 00 00 00 00 00 00 08 00 45 00\n00 44 00 00 40 00 40 06 7f 90 7f 00 00 01 7f 00\n00 01 09 dd d6 7f 00 01 b5 dd 00 01 5d 49 80 18\n32 35 30 20 32 2e 30 2e 30 20 4f 6b 3a 20 71 75'
  },
  {
    proto: 'ICMP',
    src: '192.168.1.1',
    dst: '192.168.1.10',
    len: 64,
    info: 'Echo (ping) reply id=0x0001, seq=4, ttl=64, rtt=0.68ms',
    layerEth: { src: '00:0C:29:8F:A1:33', dst: '00:E0:4C:68:01:10', type: '0x0800 (IPv4)' },
    layerIp: { src: '192.168.1.1', dst: '192.168.1.10', proto: 'ICMP (1)', ttl: 64 },
    layerTrans: { type: 'Echo Reply', code: 0, checksum: '0x4d12', identifier: '0x0001', seq: 4 },
    layerApp: { proto: 'Internet Control Message Protocol (ICMP)', desc: 'Ping response from IoT Station Node. RTT: 0.68 ms. Status: Active.' },
    hex: '00 e0 4c 68 01 10 00 0c 29 8f a1 33 08 00 45 00\n00 3c 1b 4a 00 00 40 01 7b 3c c0 a8 01 01 c0 a8\n01 0a 00 00 4d 12 00 01 00 04 61 62 63 64 65 66\n67 68 69 6a 6b 6c 6d 6e 6f 70 71 72 73 74 75 76'
  },
  {
    proto: 'ARP',
    src: '00:1A:2B:3C:4D:5E',
    dst: 'FF:FF:FF:FF:FF:FF',
    len: 42,
    info: 'Who has 192.168.1.1? Tell 192.168.1.10',
    layerEth: { src: '00:1A:2B:3C:4D:5E', dst: 'FF:FF:FF:FF:FF:FF', type: '0x0806 (ARP)' },
    layerIp: { op: 'Request (1)', senderHw: '00:1A:2B:3C:4D:5E', senderIp: '192.168.1.10', targetIp: '192.168.1.1' },
    layerTrans: { note: 'Layer 2 ARP broadcast resolution' },
    layerApp: { proto: 'Address Resolution Protocol (ARP RFC 826)', desc: 'Hardware type: Ethernet (1), Protocol type: IPv4 (0x0800), Opcode: request (1)' },
    hex: 'ff ff ff ff ff ff 00 1a 2b 3c 4d 5e 08 06 00 01\n08 00 06 04 00 01 00 1a 2b 3c 4d 5e c0 a8 01 0a\n00 00 00 00 00 00 c0 a8 01 01 00 00 00 00 00 00'
  }
];

function generateLivePacket() {
  packetSeq++;
  const tmpl = mockPacketBlueprints[packetSeq % mockPacketBlueprints.length];
  const packet = {
    id: packetSeq,
    time: new Date().toLocaleTimeString('vi-VN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    proto: tmpl.proto,
    src: tmpl.src,
    dst: tmpl.dst,
    len: tmpl.len,
    info: tmpl.info,
    layerEth: tmpl.layerEth,
    layerIp: tmpl.layerIp,
    layerTrans: tmpl.layerTrans,
    layerApp: tmpl.layerApp,
    hex: tmpl.hex
  };
  capturedPackets.unshift(packet);
  if (capturedPackets.length > 50) capturedPackets.pop();
  broadcastSSE('packet_captured', packet);
  return packet;
}

// Khởi tạo một số gói tin mẫu
for (let i = 0; i < 8; i++) {
  generateLivePacket();
}

// Gói tin định kỳ được đẩy vào buffer
setInterval(() => {
  if (simulationActive) {
    generateLivePacket();
  }
}, 4000);

// =============================================================================
// 6. CÁC API CHO 6 TAB CHUYÊN BIỆT
// =============================================================================

// --- TAB 3: CẤU HÌNH & TRÌNH ĐIỀU KHIỂN (CONFIG & DRIVERS) ---
app.get('/api/config', (req, res) => {
  const config = readJson(CONFIG_FILE, { comm: {}, drivers: [] });
  res.json(config);
});

app.post('/api/config/comm', requireAdminRole, (req, res) => {
  const config = readJson(CONFIG_FILE, { comm: {}, drivers: [] });
  config.comm = { ...config.comm, ...req.body };
  writeJson(CONFIG_FILE, config);
  broadcastSSE('config_updated', config.comm);
  res.json({ success: true, message: 'Đã lưu cấu hình tham số truyền thông phần cứng', comm: config.comm });
});

app.post('/api/config/drivers/reload', requireAdminRole, (req, res) => {
  const config = readJson(CONFIG_FILE, { comm: {}, drivers: [] });
  config.drivers.forEach(d => {
    d.lastSync = new Date().toISOString();
    d.status = 'Active';
  });
  writeJson(CONFIG_FILE, config);
  res.json({ success: true, message: 'Đã nạp lại toàn bộ drivers phần cứng', drivers: config.drivers });
});

app.post('/api/config/drivers/:id/toggle', requireAdminRole, (req, res) => {
  const { id } = req.params;
  const config = readJson(CONFIG_FILE, { comm: {}, drivers: [] });
  const drv = config.drivers.find(d => d.id === id);
  if (!drv) return res.status(404).json({ error: 'Driver không tồn tại' });
  drv.status = (drv.status === 'Active') ? 'Standby' : 'Active';
  drv.lastSync = new Date().toISOString();
  writeJson(CONFIG_FILE, config);
  res.json({ success: true, driver: drv });
});

// --- TAB 4: KHO TỆP & NÂNG CẤP FIRMWARE OTA (STORAGE / OTA) ---
app.post('/api/ota/deploy', requireAdminRole, (req, res) => {
  const { targetDeviceId, firmwareFile, protocol } = req.body;
  if (!targetDeviceId || !firmwareFile) {
    return res.status(400).json({ error: 'targetDeviceId và firmwareFile là bắt buộc' });
  }

  const deploymentId = `OTA-${Date.now().toString().slice(-4)}`;
  const responseData = {
    success: true,
    message: `Đã khởi tạo tiến trình nạp firmware OTA qua FTP tới ${targetDeviceId}`,
    deploymentId,
    targetDeviceId,
    firmwareFile,
    protocol: protocol || 'FTP RFC 959 (Port 2121)',
    steps: [
      { step: 1, name: 'Khởi tạo kết nối FTP Socket tới cổng 2121', percent: 20 },
      { step: 2, name: `Tải tệp ${firmwareFile} vào vùng đệm flash`, percent: 45 },
      { step: 3, name: 'Xác thực Checksum MD5 / SHA-256 tính toàn vẹn', percent: 70 },
      { step: 4, name: 'Ghi mã máy vào phân vùng flash (ota_0)', percent: 90 },
      { step: 5, name: 'Khởi động lại chip và kiểm tra luồng telemetry', percent: 100 }
    ]
  };

  broadcastSSE('ota_status', { targetDeviceId, firmwareFile, status: 'In_Progress', deploymentId });
  res.json(responseData);
});

// --- TAB 5: CHẨN ĐOÁN & GÓI TIN (DIAGNOSTIC / TERMINAL & SNIFFER) ---
app.post('/api/diagnostic/exec', (req, res) => {
  const rawCmd = (req.body.command || '').trim();
  const parts = rawCmd.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg1 = parts[1] || '';

  let output = '';

  if (cmd === 'ping') {
    const target = arg1 || '192.168.1.1';
    output = 
`PING ${target} (${target}): 56 data bytes
64 bytes from ${target}: icmp_seq=1 ttl=64 time=0.812 ms
64 bytes from ${target}: icmp_seq=2 ttl=64 time=0.625 ms
64 bytes from ${target}: icmp_seq=3 ttl=64 time=0.741 ms
64 bytes from ${target}: icmp_seq=4 ttl=64 time=0.689 ms

--- ${target} ping statistics ---
4 packets transmitted, 4 received, 0% packet loss, time 3002ms
rtt min/avg/max/mdev = 0.625/0.716/0.812/0.071 ms`;
  } else if (cmd === 'traceroute' || cmd === 'tracert') {
    const target = arg1 || '192.168.1.1';
    output = 
`traceroute to ${target} (${target}), 30 hops max, 60 byte packets
 1  gateway.iot-lab.local (192.168.1.1)  0.742 ms  0.681 ms  0.645 ms
 2  core-sw01.monitoring-lab.vn (10.10.10.1)  1.218 ms  1.190 ms  1.164 ms
 3  edge-fw.monitoring-lab.vn (172.16.1.1)  1.842 ms  1.802 ms  1.780 ms`;
  } else if (cmd === 'serial-read') {
    const port = arg1 || '/dev/ttyUSB0';
    output = 
`[SERIAL] Mở cổng ${port} tại 115200 bps, 8 Data Bits, Parity None...
[SERIAL] RTS/CTS Handshake OK. Đang đón khung bản tin UART/RS485:
<-- [RX: 0x02] $IOT,NODE=ESP32-GW,TEMP=38.4,HUM=62.1,SOLAR=12.8V,RELAY=1*5A [0x03]
<-- [RX: 0x02] $MODBUS,SLAVE=01,REG=40001,VAL=0180,CRC=A4B2 [0x03]
[SERIAL] Khung truyền kiểm tra CRC-16 hợp lệ (Checksum OK). Đã nhận 2 frames.`;
  } else if (cmd === 'modbus-dump') {
    output = 
`[MODBUS-RTU] Kết nối tới Slave #01 qua giao diện RS-485 (115200 bps)...
Thực thi Function 03 (Read Holding Registers, Dải thanh ghi: 40001 - 40008):
+----------+-----------------------------+---------+---------------+
| Register | Tên Tham Số / Thanh Ghi     | Hex Val | Giá Trị Đo    |
+----------+-----------------------------+---------+---------------+
| 40001    | Cảm Biến Nhiệt (°C x 10)    | 0x0180  | 38.4 °C       |
| 40002    | Cảm Biến Độ Ẩm (% x 10)     | 0x026D  | 62.1 %        |
| 40003    | Trạng Thái Rơ-le Cảnh Báo   | 0x0001  | ON (ACTIVE)   |
| 40004    | Điện Áp Pin Solar (mV)      | 0x3200  | 12,800 mV     |
| 40005    | Tải Băng Thông (Mbps x 10)  | 0x02EE  | 75.0 Mbps     |
| 40006    | Địa Chỉ Modbus Slave        | 0x0001  | ID: 1         |
+----------+-----------------------------+---------+---------------+
[MODBUS] Khung phản hồi CRC16=0xE4A1 chính xác. Chu kỳ quét: 3s.`;
  } else if (cmd === 'ifconfig' || cmd === 'ip') {
    output = 
`eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500
        inet 192.168.1.100  netmask 255.255.255.0  broadcast 192.168.1.255
        ether 00:1a:2b:3c:4d:5e  txqueuelen 1000  (Ethernet)
        RX packets 142857  bytes 98214502 (93.6 MB)
        TX packets 119821  bytes 68102914 (64.9 MB)

wlan0: flags=4099<UP,BROADCAST,MULTICAST>  mtu 1500
        inet 10.0.4.15  netmask 255.255.255.0
        ether 00:1a:2b:aa:bb:cc  (Wireless ESP-Mesh)

lo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536
        inet 127.0.0.1  netmask 255.0.0.0`;
  } else if (cmd === 'netstat') {
    output = 
`Active Internet connections (only servers)
Proto Recv-Q Send-Q Local Address           Foreign Address         State      
tcp        0      0 0.0.0.0:3000            0.0.0.0:*               LISTEN (HTTP/SSE)
tcp        0      0 127.0.0.1:2121          0.0.0.0:*               LISTEN (FTP RFC 959)
tcp        0      0 127.0.0.1:2525          0.0.0.0:*               LISTEN (SMTP RFC 5321)
tcp        0      0 0.0.0.0:502             0.0.0.0:*               LISTEN (Modbus/TCP)`;
  } else if (cmd === 'arp') {
    const devices = readJson(DEVICES_FILE, []);
    let table = `Address                  HWtype  HWaddress           Flags Mask            Iface\n`;
    table += `192.168.1.1              ether   00:0c:29:8f:a1:33   C                     eth0\n`;
    devices.forEach(d => {
      table += `${(d.ipAddress || '192.168.1.x').padEnd(25)}ether   ${(d.macAddress || '00:1a:2b:3c:4d:5e').padEnd(20)}C                     eth0\n`;
    });
    output = table;
  } else if (cmd === 'help') {
    output = 
`Danh mục các lệnh kiểm tra và chẩn đoán giao thức mạng hỗ trợ:
  ping <ip>               : Gửi 4 gói tin ICMP kiểm tra kết nối và độ trễ
  traceroute <ip>         : Dò vết các bước nhảy mạng (Network Hops)
  serial-read [port]      : Đọc dữ liệu thô từ cổng UART/Serial (ESP32)
  modbus-dump [slave]     : Đọc các thanh ghi Modbus RTU Holding Registers
  ifconfig                : Xem cấu hình địa chỉ IP, MAC của các giao diện mạng
  netstat -tuln           : Kiểm tra các cổng dịch vụ đang lắng nghe (:3000, :2121, :2525)
  arp -a                  : Tra cứu bảng phân giải địa chỉ IP - MAC
  reboot                  : Khởi động lại hệ điều hành trạm thu thập
  clear                   : Xóa màn hình terminal`;
  } else if (cmd === 'clear') {
    output = '';
  } else if (cmd === 'reboot') {
    output = `[SYSTEM] Đang gửi tín hiệu SIGTERM... Thiết bị trạm sẽ khởi động lại sau 3s.`;
  } else if (cmd) {
    output = `bash: ${cmd}: command not found. Gõ 'help' để xem danh sách lệnh được hỗ trợ.`;
  }

  res.json({ command: rawCmd, output });
});

app.get('/api/packets', (req, res) => {
  res.json({
    total: capturedPackets.length,
    packets: capturedPackets
  });
});

// --- TAB 6: CẢNH BÁO & NHẬT KÝ SỰ CỐ (ALERTS & LOGS) ---
app.get('/api/incidents', (req, res) => {
  const incidents = readJson(INCIDENTS_FILE, []);
  res.json(incidents);
});

app.post('/api/incidents/:id/resolve', requireAdminRole, (req, res) => {
  const { id } = req.params;
  const incidents = readJson(INCIDENTS_FILE, []);
  const inc = incidents.find(i => i.id === id);
  if (!inc) return res.status(404).json({ error: 'Sự cố không tồn tại' });
  inc.status = 'Resolved';
  inc.resolvedBy = 'admin';
  inc.resolvedAt = new Date().toISOString();
  writeJson(INCIDENTS_FILE, incidents);
  broadcastSSE('incident_updated', inc);
  res.json({ success: true, incident: inc });
});

app.get('/api/trigger-rules', (req, res) => {
  const rules = readJson(TRIGGER_RULES_FILE, []);
  res.json(rules);
});

app.put('/api/trigger-rules/:id', requireAdminRole, (req, res) => {
  const { id } = req.params;
  const rules = readJson(TRIGGER_RULES_FILE, []);
  const rule = rules.find(r => r.id === id);
  if (!rule) return res.status(404).json({ error: 'Quy tắc không tồn tại' });
  if (req.body.enabled !== undefined) rule.enabled = Boolean(req.body.enabled);
  if (req.body.name) rule.name = req.body.name;
  if (req.body.targetEmail) rule.targetEmail = req.body.targetEmail;
  writeJson(TRIGGER_RULES_FILE, rules);
  res.json({ success: true, rule });
});

app.post('/api/trigger-rules/simulate', requireAdminRole, async (req, res) => {
  const { ruleId } = req.body;
  const rules = readJson(TRIGGER_RULES_FILE, []);
  const rule = rules.find(r => r.id === ruleId) || rules[0];

  const devices = readJson(DEVICES_FILE, []);
  const targetDev = devices.find(d => d.type === 'Temperature') || devices[0];

  if (targetDev) {
    targetDev.value = Number((targetDev.maxThreshold + 4.2).toFixed(1));
    targetDev.status = 'Warning';
    targetDev.relayStatus = 'ON';
    targetDev.lastUpdated = new Date().toISOString();
    writeJson(DEVICES_FILE, devices);
    broadcastSSE('device_updated', targetDev);
    broadcastSSE('system_refresh', { reason: 'Rule Simulation' });
  }

  // Ghi nhận sự cố
  const inc = recordIncident({
    deviceId: targetDev ? targetDev.id : 'SIM-01',
    deviceName: targetDev ? targetDev.name : 'Giả Lập Vi Phạm Quy Tắc',
    severity: rule ? rule.severity : 'CRITICAL',
    value: targetDev ? `${targetDev.value} ${targetDev.unit}` : 'Vượt ngưỡng',
    threshold: targetDev ? `${targetDev.maxThreshold} ${targetDev.unit}` : 'Ngưỡng an toàn',
    actionTaken: `Kích hoạt quy tắc [${rule ? rule.name : 'Quy tắc mẫu'}]: Đã bật Relay và gửi email tới ${rule ? rule.targetEmail : 'manager@monitoring-lab.vn'}`,
    notes: 'Kích hoạt thử nghiệm vi phạm quy tắc bởi Quản trị viên'
  });

  // Gửi email qua SMTP
  const mailOptions = {
    from: '"IoT Rule Sentinel" <sensor-alert@iot-network.local>',
    to: rule ? rule.targetEmail : 'manager@monitoring-lab.vn',
    subject: `[VI PHẠM QUY TẮC CẢNH BÁO: ${rule ? rule.name : 'Cảnh báo'}] ${targetDev ? targetDev.name : 'Thiết bị'} vượt ngưỡng!`,
    text: `HỆ THỐNG PHÁT HIỆN SỰ CỐ VI PHẠM QUY TẮC:\n\n` +
          `Quy tắc áp dụng: ${rule ? rule.name : 'Mặc định'} (${rule ? rule.condition : ''})\n` +
          `Thiết bị phát hiện: ${targetDev ? targetDev.name : 'Cảm biến'} (${targetDev ? targetDev.id : ''})\n` +
          `Giá trị đo: ${targetDev ? targetDev.value : ''} ${targetDev ? targetDev.unit : ''} (Ngưỡng: ${targetDev ? targetDev.maxThreshold : ''})\n` +
          `Hành động: Tự động BẬT Relay & gửi email thông báo\n` +
          `Thời gian: ${new Date().toLocaleString('vi-VN')}`
  };

  try {
    await mailTransporter.sendMail(mailOptions);
  } catch (err) {
    console.error('Lỗi gửi email mô phỏng quy tắc:', err.message);
  }

  res.json({
    success: true,
    message: `Đã kích hoạt vi phạm quy tắc '${rule ? rule.name : 'Cảnh báo'}', bật Relay và gửi mail SMTP!`,
    incident: inc
  });
});

// Khởi động HTTP Web Server
const server = app.listen(HTTP_PORT, () => {
  console.log(`==================================================================`);
  console.log(`🚀 BÀI TẬP LỚN MÔN INTERNET VÀ CÁC GIAO THỨC`);
  console.log(`🌐 Web Dashboard: http://localhost:${HTTP_PORT}`);
  console.log(`📁 FTP Server:    ftp://127.0.0.1:${FTP_PORT} (admin / guest)`);
  console.log(`✉️  SMTP Server:   smtp://127.0.0.1:${SMTP_PORT} (Đa miền)`);
  console.log(`==================================================================`);
});
