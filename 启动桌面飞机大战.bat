@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动《桌面飞机大战》双屏互动本地服务...
start "" "http://localhost:8780"
node server.mjs
pause
