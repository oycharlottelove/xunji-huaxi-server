@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动【循迹·化析】服务器...
start "" "http://localhost:3000"
node server.js
pause
