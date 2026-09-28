@echo off
chcp 65001 > nul
title BÀI TẬP LỚN: INTERNET VÀ CÁC GIAO THỨC - IOT HUB
color 0b

echo =====================================================================
echo    BÀI TẬP LỚN MÔN: INTERNET VÀ CÁC GIAO THỨC
echo    HỆ THỐNG GIÁM SÁT VIỄN TRẮC IOT - WEB ĐỘNG REALTIME
echo    TÍCH HỢP FTP SERVER (2121) & MAIL SERVER ĐA MIỀN (2525)
echo =====================================================================
echo.
echo Đang kiểm tra môi trường Node.js...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [LỖI] Chưa tìm thấy Node.js! Vui lòng cài đặt Node.js trước khi chạy.
    pause
    exit /b
)

echo [OK] Đang khởi động toàn bộ dịch vụ mạng:
echo  1. HTTP Web Server & Dashboard: http://localhost:3000
echo  2. FTP Server (RFC 959):        ftp://127.0.0.1:2121
echo  3. SMTP Mail Server (RFC 5321): smtp://127.0.0.1:2525
echo.
echo Nhấn Ctrl+C để dừng hệ thống bất kỳ lúc nào.
echo =====================================================================
echo.

node server.js
pause
