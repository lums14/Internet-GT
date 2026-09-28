# BÀI TẬP LỚN: INTERNET VÀ CÁC GIAO THỨC

> **Hệ Thống Trung Tâm Giám Sát Viễn Trắc IoT, Web Động Thời Gian Thực, Tích Hợp FTP Server Phân Quyền & Mail Server Đa Miền**  
> Môn học: **Internet và các giao thức** (Internet & Protocols)

---

## 📑 BẢNG ĐỐI CHIẾU YÊU CẦU ĐỀ BÀI & CÁCH THỰC HIỆN

| Yêu cầu trong đề bài | Thành phần thực hiện trong Đồ án | Trạng thái |
| :--- | :--- | :---: |
| **1. Xây dựng trang web:** | | |
| • Text | Tiêu đề hệ thống, KPI metrics, thông số mạng, giải trình giao thức |  Đạt |
| • Ảnh | Sơ đồ Topology mạng (`topology.svg`), Trạm quan trắc (`iot_station.svg`) |  Đạt |
| • Clip | Camera an ninh hiện trường Canvas & HTML5 live feed, đổi góc cam, chụp ảnh |  Đạt |
| • Bảng | Bảng dữ liệu cảm biến thời gian thực, có tìm kiếm, lọc theo loại, lọc trạng thái |  Đạt |
| • Đồ thị | Biểu đồ đường Realtime Telemetry Trend, Biểu đồ tròn Doughnut tỷ lệ an toàn |  Đạt |
| • Đáp ứng Customize | Đổi Theme (Sáng/Tối), Đổi màu chủ đạo (Cyan, Emerald, Violet, Orange), Ẩn/Hiện Widgets |  Đạt |
| **2. Xây dựng "Web Động" (Dữ liệu thay đổi):** | | |
| • Thay đổi qua API (IoT) | Endpoint `POST /api/telemetry/push` nhận telemetry; Modal mô phỏng bắn gói tin IoT |  Đạt |
| • Thay đổi qua E-Form | Form thêm thiết bị mới (CRUD), Form cấu hình tham số, cập nhật vị trí |  Đạt |
| • Xử lý tại Back-end | Back-end tính Min/Max/Avg, thuật toán phát hiện ngưỡng cảnh báo tự động |  Đạt |
| • Hiển thị bảng & biểu đồ | Server-Sent Events (SSE) đẩy dữ liệu live từng nhịp lên Table & Chart không cần F5 |  Đạt |
| • Nghiệp vụ nâng cao (Bonus) | Phân quyền Admin vs Guest, Lệnh điều khiển từ xa, Xuất CSV, In báo cáo PDF |  Đạt |
| **3. Hệ thống FTP Server:** | | |
| • Tiêu chuẩn: Chia sẻ file | FTP Server chuẩn RFC 959 chạy trên cổng `2121`, lưu trữ thư mục `data/ftp_storage` |  Đạt |
| • Nâng cao: Phân quyền user | User `admin` (pass: `admin123`) có toàn quyền Đọc/Ghi/Xóa; User `guest` (pass: `guest123`) chỉ Đọc |  Đạt |
| • Tích hợp Web & Client | Web FTP Explorer trực quan + Kết nối được bằng FileZilla Client thật |  Đạt |
| **4. Hệ thống Mail Server:** | | |
| • Tiêu chuẩn: Đơn miền | Mail Server SMTP chuẩn RFC 5321 chạy trên cổng `2525` |  Đạt |
| • Nâng cao: Đa miền | Hỗ trợ 2 tên miền độc lập: `@iot-network.local` và `@monitoring-lab.vn` |  Đạt |
| • Tích hợp tự động | Cảm biến vượt ngưỡng tự động kích hoạt Back-end gửi email cảnh báo qua SMTP |  Đạt |

---

## 🚀 HƯỚNG DẪN KHỞI CHẠY HỆ THỐNG

### Cách 1: Chạy bằng file `start.bat` (Khuyên dùng trên Windows)
1. Mở thư mục dự án `C:\Users\BIN\Desktop\Web`.
2. Nhấp đúp chuột vào file **`start.bat`**.
3. Hệ thống sẽ tự động khởi chạy cả 3 máy chủ (HTTP Web, FTP, SMTP).
4. Mở trình duyệt truy cập: **`http://localhost:3000`**.

### Cách 2: Chạy bằng dòng lệnh Terminal
```bash
npm start
```
Hoặc trong chế độ phát triển:
```bash
npm run dev
```

---

## 🌐 CÁC CỔNG DỊCH VỤ & THÔNG TIN KẾT NỐI

### 1. Web Dashboard & RESTful API
- **Địa chỉ:** `http://localhost:3000`
- **Kênh Web Động:** `http://localhost:3000/api/stream` (Server-Sent Events)

### 2. FTP Server (RFC 959)
- **Host:** `127.0.0.1` | **Port:** `2121`
- **Tài khoản Quản trị (Admin):**
  - Username: `admin` | Password: `admin123`
  - Quyền: **Toàn quyền (Đọc, Ghi, Xóa, Tạo thư mục)** trên toàn bộ kho lưu trữ (bao gồm `/admin_only`).
- **Tài khoản Khách (Guest):**
  - Username: `guest` | Password: `guest123`
  - Quyền: **Chỉ đọc (Read-only)** trong thư mục `/public`.
- **Kiểm thử ngoài bằng FileZilla Client:**
  - Mở FileZilla ➡️ Host: `127.0.0.1`, Port: `2121`, User: `admin`, Pass: `admin123` ➡️ Kết nối thành công!

### 3. SMTP Mail Server Đa Miền (RFC 5321)
- **Host:** `127.0.0.1` | **Port:** `2525`
- **Đa miền hỗ trợ:**
  - Miền 1: `@iot-network.local` (Ví dụ: `admin@iot-network.local`, `sensor-alert@iot-network.local`)
  - Miền 2: `@monitoring-lab.vn` (Ví dụ: `manager@monitoring-lab.vn`, `technician@monitoring-lab.vn`)
- **Tự động hóa:** Bấm nút **"Kích Hoạt Cảnh Báo Mail Tự Động"** hoặc đẩy nhiệt độ thiết bị lên > 80°C, hệ thống sẽ tự động dùng SMTP gửi email cảnh báo từ trạm IoT sang email người quản trị!

---

## 🎯 KỊCH BẢN THUYẾT TRÌNH BẢO VỆ ĐỒ ÁN (DEMO CHO GIẢNG VIÊN)

Khi trình bày trước thầy/cô, bạn có thể thực hiện theo kịch bản 5 bước sau để gây ấn tượng mạnh nhất:

### Bước 1: Demo Giao diện & Customize (Mục 1)
1. Giới thiệu tổng quan hệ thống: Có đầy đủ **Text**, **Ảnh** (`topology.svg`), **Clip camera CCTV trực tiếp**, **Bảng**, **Đồ thị Chart.js**.
2. Bấm nút **Sáng / Tối (Moon/Sun)** trên Header để demo chuyển Theme Dark/Light mượt mà.
3. Bấm nút **Sliders (Customize)**: Chọn bảng màu chủ đạo (Emerald, Violet, Orange) và thử ẩn/hiện các khối Widget để chứng minh khả năng cá nhân hóa giao diện người dùng.

### Bước 2: Demo Tính Chất "Web Động" (Mục 2)
1. Chỉ vào biểu đồ viễn trắc và bảng số liệu: Các giá trị đang tự động nhảy số theo thời gian thực nhờ tiến trình Back-end xử lý và đẩy qua **Server-Sent Events (SSE)**.
2. **Demo E-Form**: Bấm nút *"Thêm Thiết Bị (E-Form)"*, nhập một thiết bị mới với ngưỡng cảnh báo. Bấm Lưu ➡️ Dữ liệu lập tức xuất hiện ngay trên Bảng và cập nhật thẻ KPI không cần tải lại trang.
3. **Demo API IoT**: Bấm nút *"Bắn Gói Tin IoT (API)"*, chọn một thiết bị và gõ giá trị `95°C` (vượt ngưỡng) ➡️ Bảng dữ liệu lập tức chuyển sang trạng thái nhấp nháy **Cảnh Báo (Warning)**, còi báo động âm thanh kêu bíp.
4. **Demo Nghiệp vụ Nâng cao**: Bấm nút *"Xuất CSV"* để tải về file báo cáo Excel; bấm nút *"Role: Admin"* trên Header để chuyển sang *"Guest"* chứng minh tính năng phân quyền bảo mật (nút xóa/thêm bị ẩn khi là Guest).

### Bước 3: Demo Hệ Thống FTP Server (Mục 3)
1. Chuyển sang tab **"Hệ Thống FTP Server (:2121)"**.
2. Giải thích: FTP Server tuân thủ chuẩn RFC 959 chạy trên cổng 2121.
3. Khi ở quyền `Guest`: Chỉ thấy thư mục `/public` và chỉ có nút Tải về, không có quyền xóa.
4. Chuyển sang quyền `Admin`: Xuất hiện thêm thư mục bảo mật `/admin_only` và nút Xóa file.
5. Thử chọn một file từ máy tính và bấm *"Xác Nhận Upload File"* ➡️ File được lưu thẳng vào FTP Storage của server.
6. (Tùy chọn) Bật phần mềm FileZilla kết nối vào `127.0.0.1:2121` bằng user `admin` để cho thầy cô xem nhật ký lệnh FTP (USER, PASS, TYPE I, PASV, RETR).

### Bước 4: Demo Hệ Thống Mail Server Đa Miền (Mục 4)
1. Chuyển sang tab **"Hệ Thống Mail Đa Miền (:2525)"**.
2. Giải thích kiến trúc: SMTP Server chạy trên cổng 2525 tiếp nhận và định tuyến thư cho 2 miền độc lập `@iot-network.local` và `@monitoring-lab.vn`.
3. Bấm vào các nút lọc theo domain ở cột trái để thấy bộ định tuyến phân loại hộp thư của từng miền.
4. Bấm *"Soạn Thư Mới"*: Soạn thư từ `admin@iot-network.local` gửi đến `manager@monitoring-lab.vn` ➡️ Bấm Gửi. Thư lập tức xuất hiện trong hộp thư đến qua giao thức SMTP thật.
5. Bấm nút *"Kích Hoạt Cảnh Báo Mail Tự Động"*: Chứng minh sự liên kết giữa Module viễn trắc IoT với Mail Server.

### Bước 5: Kết luận & Kiến trúc Mạng (Mục 5)
1. Mở tab **"Kiến Trúc Mạng & Báo Cáo BTL"** chiếu sơ đồ Topology SVG tương tác.
2. Tóm tắt các giao thức mạng đã làm chủ: HTTP/SSE, FTP (RFC 959), SMTP (RFC 5321).

---

## 📂 CẤU TRÚC THƯ MỤC MÃ NGUỒN

```
c:\Users\BIN\Desktop\Web\
├── package.json               # Cấu hình dự án & thư viện (express, ftp-srv, smtp-server, nodemailer)
├── server.js                  # Back-end tích hợp: Web Server + FTP Server + SMTP Mail Server
├── start.bat                  # Script khởi động 1 chạm trên Windows
├── README.md                  # Tài liệu hướng dẫn kỹ thuật & kịch bản bảo vệ
├── data/
│   ├── devices.json           # Cơ sở dữ liệu thiết bị & cảm biến viễn trắc
│   ├── telemetry.json         # Lịch sử đo đạc phục vụ vẽ đồ thị
│   ├── emails.json            # Cơ sở dữ liệu thư điện tử 2 miền
│   └── ftp_storage/           # Thư mục lưu trữ FTP chuẩn RFC 959
│       ├── public/            # Thư mục công cộng (Read-only cho Guest)
│       └── admin_only/        # Thư mục bảo mật (Toàn quyền cho Admin)
└── public/
    ├── index.html             # Giao diện chính (SPA Dashboard, Tabs, Modals)
    ├── css/
    │   └── style.css          # Hệ thống Design Tokens, Dark/Light mode, Glassmorphism
    ├── js/
    │   ├── app.js             # Điều phối chính, SSE stream, Theme/Accent, Canvas CCTV, Audio
    │   ├── charts.js          # Khởi tạo & cập nhật biểu đồ Chart.js Realtime
    │   ├── devices.js         # Xử lý E-Form CRUD, API viễn trắc, xuất file CSV
    │   ├── ftp.js             # Quản lý file FTP, phân quyền tải lên/tải về
    │   └── mail.js            # Giao diện Webmail, soạn thư SMTP đa miền
    └── assets/
        └── images/
            ├── topology.svg   # Sơ đồ kiến trúc mạng đồ họa vector
            └── iot_station.svg# Hình ảnh trạm quan trắc viễn trắc IoT
```

---
*Chúc bạn bảo vệ Bài tập lớn thành công và đạt điểm 10/10 tuyệt đối!*
