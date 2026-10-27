// =============================================================================
// TAB 5: DIAGNOSTIC & TERMINAL / PACKET SNIFFER MODULE
// =============================================================================

let terminalHistory = [];
let terminalHistoryIndex = -1;
let snifferPackets = [];
let snifferActive = true;
let snifferFilter = 'all';
let selectedPacketId = null;

// Khởi tạo các sự kiện cho Tab Chẩn đoán & Gói tin
function initDiagnosticEvents() {
  initTerminalEvents();
  initSnifferEvents();
  loadPackets();
}

// -----------------------------------------------------------------------------
// 1. WEB TERMINAL (SERIAL / SSH / PING TEST CLI)
// -----------------------------------------------------------------------------
function initTerminalEvents() {
  const input = document.getElementById('terminalCliInput');
  const form = document.getElementById('terminalCliForm');

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const cmd = input.value.trim();
      if (!cmd) return;
      executeTerminalCommand(cmd);
      terminalHistory.push(cmd);
      terminalHistoryIndex = terminalHistory.length;
      input.value = '';
    });
  }

  // Hỗ trợ duyệt lịch sử lệnh bằng phím Mũi tên Lên / Xuống
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (terminalHistoryIndex > 0) {
          terminalHistoryIndex--;
          input.value = terminalHistory[terminalHistoryIndex] || '';
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (terminalHistoryIndex < terminalHistory.length - 1) {
          terminalHistoryIndex++;
          input.value = terminalHistory[terminalHistoryIndex] || '';
        } else {
          terminalHistoryIndex = terminalHistory.length;
          input.value = '';
        }
      }
    });
  }

  // Quick Action Buttons
  const bindQuickCmd = (btnId, cmd) => {
    document.getElementById(btnId)?.addEventListener('click', () => {
      executeTerminalCommand(cmd);
    });
  };

  bindQuickCmd('btnQuickPing', 'ping 192.168.1.1');
  bindQuickCmd('btnQuickTraceroute', 'traceroute 192.168.1.1');
  bindQuickCmd('btnQuickSerial', 'serial-read /dev/ttyUSB0');
  bindQuickCmd('btnQuickModbus', 'modbus-dump');
  bindQuickCmd('btnQuickIfconfig', 'ifconfig');
  bindQuickCmd('btnQuickNetstat', 'netstat');
  bindQuickCmd('btnQuickArp', 'arp -a');
  bindQuickCmd('btnQuickHelp', 'help');
  bindQuickCmd('btnQuickClear', 'clear');

  // Ghi log chào mừng ban đầu
  const output = document.getElementById('terminalCliOutput');
  if (output && output.children.length === 0) {
    appendTerminalLine('IoT Network & Protocols Hub v2.4 - Diagnostic Shell (CLI)', 'info');
    appendTerminalLine('Giao thức kiểm tra hỗ trợ: ICMP Ping, Traceroute, Web Serial UART, Modbus RTU/TCP, Netstat, ARP.', 'sub');
    appendTerminalLine("Gõ 'help' hoặc nhấn các nút lệnh nhanh phía trên để bắt đầu...\n", 'accent');
  }
}

async function executeTerminalCommand(cmd) {
  const output = document.getElementById('terminalCliOutput');
  if (!output) return;

  if (cmd.trim().toLowerCase() === 'clear') {
    output.innerHTML = '';
    return;
  }

  // In dòng lệnh người dùng nhập
  appendTerminalLine(`admin@iot-hub:~$ ${cmd}`, 'prompt');

  try {
    const res = await fetch('/api/diagnostic/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd })
    });
    const data = await res.json();

    if (data.output) {
      appendTerminalLine(data.output, 'response');
    }
  } catch (err) {
    appendTerminalLine(`Lỗi kết nối máy chủ khi thực thi lệnh: ${err.message}`, 'error');
  }

  // Tự động cuộn xuống cuối
  output.scrollTop = output.scrollHeight;
}

function appendTerminalLine(text, type = 'response') {
  const output = document.getElementById('terminalCliOutput');
  if (!output) return;

  const div = document.createElement('div');
  div.className = `term-line term-${type}`;
  div.textContent = text;
  output.appendChild(div);
  output.scrollTop = output.scrollHeight;
}

// -----------------------------------------------------------------------------
// 2. PACKET SNIFFER & PROTOCOL INSPECTOR
// -----------------------------------------------------------------------------
function initSnifferEvents() {
  // Nút Tạm Dừng / Tiếp Tục
  document.getElementById('btnToggleSniffer')?.addEventListener('click', () => {
    snifferActive = !snifferActive;
    const btn = document.getElementById('btnToggleSniffer');
    const badge = document.getElementById('snifferStatusBadge');
    if (snifferActive) {
      if (btn) btn.innerHTML = '<i data-lucide="pause" style="width:13px;height:13px;"></i> Tạm Dừng';
      if (badge) {
        badge.className = 'badge badge-normal';
        badge.innerHTML = '<span class="proto-dot"></span> Đang Thu Gói Tin (Live)';
      }
      showToast('Đã tiếp tục bắt gói tin mạng', 'info');
    } else {
      if (btn) btn.innerHTML = '<i data-lucide="play" style="width:13px;height:13px;"></i> Tiếp Tục';
      if (badge) {
        badge.className = 'badge';
        badge.style.background = 'rgba(245,158,11,0.2)';
        badge.style.color = '#f59e0b';
        badge.innerHTML = 'Đã Tạm Dừng';
      }
      showToast('Đã tạm dừng bộ thu gói tin', 'warning');
    }
    if (window.lucide) window.lucide.createIcons();
  });

  // Nút Xóa Bộ Đệm Gói Tin
  document.getElementById('btnClearSniffer')?.addEventListener('click', () => {
    snifferPackets = [];
    selectedPacketId = null;
    renderSnifferTable();
    renderPacketInspector(null);
    showToast('Đã xóa sạch bộ đệm gói tin', 'info');
  });

  // Bộ lọc giao thức
  document.querySelectorAll('.packet-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.packet-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      snifferFilter = btn.getAttribute('data-proto') || 'all';
      renderSnifferTable();
    });
  });
}

// Tải danh sách gói tin ban đầu
async function loadPackets() {
  try {
    const res = await fetch('/api/packets');
    if (!res.ok) return;
    const data = await res.json();
    snifferPackets = data.packets || [];
    renderSnifferTable();

    // Chọn gói tin đầu tiên nếu có
    if (snifferPackets.length > 0 && !selectedPacketId) {
      selectPacket(snifferPackets[0].id);
    }
  } catch (err) {
    console.error('Lỗi khi tải gói tin:', err);
  }
}

// Nhận gói tin mới từ SSE Stream
function handleNewPacketFromSSE(packet) {
  if (!snifferActive) return;
  snifferPackets.unshift(packet);
  if (snifferPackets.length > 60) snifferPackets.pop();

  renderSnifferTable();

  // Nếu chưa có gói tin nào được chọn, tự chọn gói tin mới nhất
  if (!selectedPacketId) {
    selectPacket(packet.id);
  }
}
window.handleNewPacketFromSSE = handleNewPacketFromSSE;

// Hiển thị bảng danh sách gói tin
function renderSnifferTable() {
  const tbody = document.getElementById('packetSnifferTableBody');
  const countBadge = document.getElementById('packetCountBadge');
  if (!tbody) return;

  const filtered = snifferPackets.filter(p => {
    if (snifferFilter === 'all') return true;
    return p.proto.toLowerCase().includes(snifferFilter.toLowerCase());
  });

  if (countBadge) {
    countBadge.textContent = `${filtered.length} Gói`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:24px; color:var(--text-muted);">Chưa thu được gói tin ${snifferFilter !== 'all' ? snifferFilter.toUpperCase() : ''} nào</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(pkt => {
    const isSelected = pkt.id === selectedPacketId;
    let badgeClass = 'proto-badge-http';
    if (pkt.proto.includes('FTP')) badgeClass = 'proto-badge-ftp';
    else if (pkt.proto.includes('SMTP')) badgeClass = 'proto-badge-smtp';
    else if (pkt.proto.includes('Modbus')) badgeClass = 'proto-badge-modbus';
    else if (pkt.proto.includes('ICMP')) badgeClass = 'proto-badge-icmp';
    else if (pkt.proto.includes('ARP')) badgeClass = 'proto-badge-arp';

    return `
      <tr class="packet-row ${isSelected ? 'selected' : ''}" data-id="${pkt.id}">
        <td><strong style="color:var(--text-muted); font-family:monospace;">#${pkt.id}</strong></td>
        <td style="font-family:monospace; font-size:0.8rem; color:var(--text-sub);">${pkt.time}</td>
        <td><code>${pkt.src}</code></td>
        <td><code>${pkt.dst}</code></td>
        <td><span class="proto-badge ${badgeClass}">${pkt.proto}</span></td>
        <td style="font-family:monospace; color:var(--text-muted);">${pkt.len} B</td>
        <td class="packet-info-col" title="${pkt.info}">${pkt.info}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.packet-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = Number(row.getAttribute('data-id'));
      selectPacket(id);
    });
  });
}

// Chọn và xem chi tiết gói tin
function selectPacket(id) {
  selectedPacketId = id;
  const pkt = snifferPackets.find(p => p.id === id);

  // Đánh dấu dòng được chọn
  document.querySelectorAll('.packet-row').forEach(r => {
    if (Number(r.getAttribute('data-id')) === id) {
      r.classList.add('selected');
    } else {
      r.classList.remove('selected');
    }
  });

  renderPacketInspector(pkt);
}

// Hiển thị khung Protocol Inspector
function renderPacketInspector(pkt) {
  const emptyEl = document.getElementById('inspectorEmptyState');
  const contentEl = document.getElementById('inspectorContentState');
  if (!emptyEl || !contentEl) return;

  if (!pkt) {
    emptyEl.style.display = 'flex';
    contentEl.style.display = 'none';
    return;
  }

  emptyEl.style.display = 'none';
  contentEl.style.display = 'block';

  // Header thông tin gói tin
  const titleEl = document.getElementById('inspPacketTitle');
  if (titleEl) {
    titleEl.textContent = `Gói tin #${pkt.id} [${pkt.proto}] - Độ dài: ${pkt.len} bytes`;
  }

  // Tầng 2: Data Link Layer (Ethernet II)
  const ethEl = document.getElementById('inspLayerEth');
  if (ethEl) {
    ethEl.innerHTML = `
      <div><strong>Ethernet II:</strong> Src: <code>${pkt.layerEth?.src || '--'}</code> ➔ Dst: <code>${pkt.layerEth?.dst || '--'}</code></div>
      <div style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;">Loại giao thức: ${pkt.layerEth?.type || '0x0800 (IPv4)'}</div>
    `;
  }

  // Tầng 3: Network Layer (IPv4 / ARP)
  const ipEl = document.getElementById('inspLayerIp');
  if (ipEl) {
    if (pkt.layerIp) {
      ipEl.innerHTML = `
        <div><strong>Internet Protocol Version 4:</strong> Src: <code>${pkt.layerIp.src || pkt.src}</code> ➔ Dst: <code>${pkt.layerIp.dst || pkt.dst}</code></div>
        <div style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;">Protocol: ${pkt.layerIp.proto || 'TCP'} • TTL: ${pkt.layerIp.ttl || 64} • Header Checksum: OK</div>
      `;
    } else {
      ipEl.innerHTML = `<div><strong>Network Layer:</strong> ${pkt.proto}</div>`;
    }
  }

  // Tầng 4: Transport Layer (TCP / UDP / ICMP)
  const transEl = document.getElementById('inspLayerTrans');
  if (transEl) {
    if (pkt.layerTrans) {
      transEl.innerHTML = `
        <div><strong>Transport Layer:</strong> Cổng: <code>${pkt.layerTrans.srcPort || '--'}</code> ➔ <code>${pkt.layerTrans.dstPort || '--'}</code></div>
        <div style="font-size:0.78rem; color:var(--text-muted); margin-top:2px;">Flags: <strong>${pkt.layerTrans.flags || 'None'}</strong> • Seq: ${pkt.layerTrans.seq || '--'} • Ack: ${pkt.layerTrans.ack || '--'}</div>
      `;
    } else {
      transEl.innerHTML = `<div><strong>Transport Layer:</strong> Stream Connection</div>`;
    }
  }

  // Tầng 7: Application Layer (HTTP / FTP / SMTP / Modbus)
  const appEl = document.getElementById('inspLayerApp');
  if (appEl) {
    appEl.innerHTML = `
      <div style="font-weight:700; color:var(--accent-color); margin-bottom:4px;">${pkt.layerApp?.proto || pkt.proto}</div>
      <pre style="background:var(--bg-primary); padding:8px 12px; border-radius:4px; font-size:0.8rem; color:var(--text-main); font-family:monospace; white-space:pre-wrap; border:1px solid var(--border-color);">${pkt.layerApp?.desc || pkt.info}</pre>
    `;
  }

  // Hex Dump View (Wireshark-like representation)
  const hexEl = document.getElementById('inspHexDump');
  if (hexEl) {
    hexEl.textContent = pkt.hex || '00 00 00 00 00 00 00 00 00 00 00 00 08 00 ...';
  }
}

// Xuất các hàm ra phạm vi toàn cục
window.initDiagnosticEvents = initDiagnosticEvents;
window.loadPackets = loadPackets;
window.executeTerminalCommand = executeTerminalCommand;
