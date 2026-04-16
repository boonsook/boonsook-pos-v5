@echo off
chcp 65001 >nul
echo ============================================
echo   Boonsook POS — Deploy ทีเดียว ทั้ง 2 ที่
echo   (GitHub Pages + Cloudflare Pages)
echo ============================================
echo.

:: ตรวจสอบ git
git status >nul 2>&1
if errorlevel 1 (
    echo [ERROR] ไม่พบ git หรือไม่ได้อยู่ใน git repo
    pause
    exit /b 1
)

:: แสดงสถานะ
echo [1/4] ตรวจสอบไฟล์ที่เปลี่ยน...
git status --short
echo.

:: ถาม commit message
set /p MSG="กรอก commit message (Enter = auto): "
if "%MSG%"=="" set MSG=Update Boonsook POS %date% %time:~0,5%

:: Add + Commit + Push
echo.
echo [2/4] เพิ่มไฟล์ทั้งหมด...
git add -A

echo [3/4] Commit: %MSG%
git commit -m "%MSG%"

echo [4/4] Push ไป GitHub (auto deploy ทั้ง 2 ที่)...
git push origin main

echo.
echo ============================================
echo   DONE! GitHub Actions จะ deploy ให้อัตโนมัติ:
echo   - GitHub Pages (เดสก์ท็อป)
echo   - Cloudflare Pages (มือถือ)
echo   ตรวจสอบได้ที่: https://github.com/boonsook/boonsook-pos-v5/actions
echo ============================================
pause
