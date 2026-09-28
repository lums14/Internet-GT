const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
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
    const targetFolder = req.query.folder === 'admin_only' ? 'admin_only' : 'public';
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

// Middleware bảo vệ: Chặn tài khoản GUEST thực hiện các thao tác ghi / xóa / điều khiển
function requireAdminRole(req, res, next) {
  const role = req.headers['x-user-role'] || req.query.role || req.body?.role || 'admin';
  if (role === 'guest') {
    return res.status(403).json({
      error: 'Quyền truy cập bị từ chối: Tài khoản GUEST chỉ có quyền xem dữ liệu, không được phép thực hiện thao tác này!'
    });
  }
  next();
}

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
  const { name, location, minThreshold, maxThreshold, status } = req.body;
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

// Tác động nghiệp vụ: Gửi lệnh điều khiển khẩn cấp tới thiết bị (Yêu cầu quyền Admin)
app.post('/api/devices/:id/command', requireAdminRole, (req, res) => {
  const { id } = req.params;
  const { command } = req.body; // 'reboot', 'cool_down', 'override_normal'
  const devices = readJson(DEVICES_FILE);
  const device = devices.find(d => d.id === id);

  if (!device) return res.status(404).json({ error: 'Không tìm thấy thiết bị' });

  if (command === 'cool_down') {
    device.value = Number((device.minThreshold + (device.maxThreshold - device.minThreshold) * 0.4).toFixed(1));
    device.status = 'Normal';
  } else if (command === 'reboot') {
    device.value = Number((device.minThreshold + 5).toFixed(1));
    device.status = 'Normal';
  } else if (command === 'trigger_warning') {
    device.value = Number((device.maxThreshold + 5.5).toFixed(1));
    device.status = 'Warning';
    // Gửi cảnh báo email tự động
    sendAlertEmail(device);
  }

  device.lastUpdated = new Date().toISOString();
  writeJson(DEVICES_FILE, devices);
  broadcastSSE('device_updated', device);
  broadcastSSE('system_refresh', { reason: 'Command Executed' });

  res.json({ message: `Lệnh '${command}' đã được thực thi thành công`, device });
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
  const role = req.query.role || 'guest';
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

  // Thư mục công cộng ai cũng xem được
  scanFolder('public', path.join(FTP_ROOT, 'public'), 'Read Only (Guest) / Read-Write (Admin)');

  // Thư mục admin_only chỉ tài khoản Admin mới được xem
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
  const role = req.query.role || 'guest';

  if (!relPath) return res.status(400).json({ error: 'Thiếu đường dẫn file' });
  if (relPath.startsWith('admin_only') && role !== 'admin') {
    return res.status(403).json({ error: 'Bạn không có quyền truy cập thư mục admin_only' });
  }

  const targetPath = path.join(FTP_ROOT, relPath);
  if (!fs.existsSync(targetPath)) return res.status(404).json({ error: 'File không tồn tại' });

  res.download(targetPath);
});

// Upload file lên FTP qua Web (Chỉ Admin)
app.post('/api/ftp/upload', requireAdminRole, upload.single('file'), (req, res) => {
  const role = req.body.role || req.query.role || 'guest';
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
  const { path: relPath, role } = req.body;
  if (role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ Admin mới có quyền xóa file trên FTP Server' });
  }

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

        // Phân tích header đơn giản
        const subjectMatch = rawData.match(/Subject:\s*(.*)/i);
        const subject = subjectMatch ? subjectMatch[1].trim() : 'Không có tiêu đề';
        
        // Tách phần thân (body)
        const parts = rawData.split(/\r?\n\r?\n/);
        const body = parts.slice(1).join('\n\n') || rawData;

        const emails = readJson(EMAILS_FILE);
        const newMail = {
          id: `mail-${Date.now()}`,
          from: fromAddress,
          to: toAddress,
          subject,
          body,
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

// Hàm tự động bắn email cảnh báo khi cảm biến vượt ngưỡng
async function sendAlertEmail(device) {
  const now = Date.now();
  // Giới hạn 30s giữa các lần gửi tự động để không spam
  if (now - lastEmailAlertTime < 30000) return;
  lastEmailAlertTime = now;

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
  target.status = 'Warning';
  await sendAlertEmail(target);
  res.json({ message: 'Đã kích hoạt cảnh báo & gửi email SMTP thành công!' });
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
