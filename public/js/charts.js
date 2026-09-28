// =============================================================================
// CHARTS MODULE (CHART.JS REALTIME & KPI VISUALIZATION)
// =============================================================================

let realtimeChart = null;
let statusDoughnutChart = null;

function initCharts() {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';
  const textColor = isDark ? '#94a3b8' : '#475569';

  // 1. Biểu đồ đường Realtime Telemetry (Line Chart)
  const ctxRealtime = document.getElementById('realtimeChart')?.getContext('2d');
  if (ctxRealtime) {
    realtimeChart = new Chart(ctxRealtime, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Nhiệt Độ TB (°C)',
            data: [],
            borderColor: '#00f0ff',
            backgroundColor: 'rgba(0, 240, 255, 0.1)',
            borderWidth: 2.5,
            fill: true,
            tension: 0.35,
            pointRadius: 3,
            pointHoverRadius: 6
          },
          {
            label: 'Độ Ẩm TB (%)',
            data: [],
            borderColor: '#10b981',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [5, 5],
            fill: false,
            tension: 0.35,
            pointRadius: 2,
            pointHoverRadius: 5
          },
          {
            label: 'Tải Băng Thông (Mbps)',
            data: [],
            borderColor: '#f59e0b',
            backgroundColor: 'transparent',
            borderWidth: 2,
            fill: false,
            tension: 0.35,
            pointRadius: 2,
            pointHoverRadius: 5
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { size: 11 } }
          },
          y: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { size: 11 } },
            suggestedMin: 20,
            suggestedMax: 100
          }
        },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: textColor, boxWidth: 12, font: { size: 12 } }
          },
          tooltip: {
            mode: 'index',
            intersect: false
          }
        }
      }
    });
  }

  // 2. Biểu đồ tròn Trạng thái Hệ Thống (Doughnut Chart)
  const ctxDoughnut = document.getElementById('statusDoughnutChart')?.getContext('2d');
  if (ctxDoughnut) {
    statusDoughnutChart = new Chart(ctxDoughnut, {
      type: 'doughnut',
      data: {
        labels: ['Bình Thường (Normal)', 'Cảnh Báo (Warning)'],
        datasets: [{
          data: [1, 0],
          backgroundColor: ['#10b981', '#f59e0b'],
          borderColor: isDark ? '#111827' : '#ffffff',
          borderWidth: 3,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: textColor, font: { size: 12 } }
          }
        }
      }
    });
  }

  // Nạp dữ liệu ban đầu
  fetchInitialTelemetry();
}

async function fetchInitialTelemetry() {
  try {
    const res = await fetch('/api/telemetry');
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0 && realtimeChart) {
      realtimeChart.data.labels = data.map(d => d.timestamp);
      realtimeChart.data.datasets[0].data = data.map(d => d.avgTemp);
      realtimeChart.data.datasets[1].data = data.map(d => d.avgHumidity);
      realtimeChart.data.datasets[2].data = data.map(d => d.networkBandwidth);
      realtimeChart.update('none');
    }
  } catch (err) {
    console.error('Lỗi nạp telemetry ban đầu:', err);
  }
}

// Cập nhật biểu đồ theo thời gian thực khi có dữ liệu mới từ SSE
function pushTelemetryToChart(point) {
  if (!realtimeChart) return;

  const labels = realtimeChart.data.labels;
  labels.push(point.timestamp);
  realtimeChart.data.datasets[0].data.push(point.avgTemp);
  realtimeChart.data.datasets[1].data.push(point.avgHumidity);
  realtimeChart.data.datasets[2].data.push(point.networkBandwidth);

  if (labels.length > 20) {
    labels.shift();
    realtimeChart.data.datasets[0].data.shift();
    realtimeChart.data.datasets[1].data.shift();
    realtimeChart.data.datasets[2].data.shift();
  }

  realtimeChart.update('none');
}

// Cập nhật biểu đồ Doughnut
function updateDoughnutChart(normalCount, warningCount) {
  if (!statusDoughnutChart) return;
  statusDoughnutChart.data.datasets[0].data = [normalCount, warningCount];
  statusDoughnutChart.update();
}

// Cập nhật màu sắc biểu đồ khi đổi Dark/Light mode
function refreshChartTheme() {
  if (!realtimeChart || !statusDoughnutChart) return;
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';
  const textColor = isDark ? '#94a3b8' : '#475569';

  realtimeChart.options.scales.x.grid.color = gridColor;
  realtimeChart.options.scales.y.grid.color = gridColor;
  realtimeChart.options.scales.x.ticks.color = textColor;
  realtimeChart.options.scales.y.ticks.color = textColor;
  realtimeChart.options.plugins.legend.labels.color = textColor;
  realtimeChart.update('none');

  statusDoughnutChart.options.plugins.legend.labels.color = textColor;
  statusDoughnutChart.data.datasets[0].borderColor = isDark ? '#111827' : '#ffffff';
  statusDoughnutChart.update('none');
}

window.initCharts = initCharts;
window.pushTelemetryToChart = pushTelemetryToChart;
window.updateDoughnutChart = updateDoughnutChart;
window.refreshChartTheme = refreshChartTheme;
