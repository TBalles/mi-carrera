@echo off
rem Lanzador de la pagina "Mi Carrera" - Plan de Estudios
rem Inicia el servidor local y abre el navegador.
cd /d "%~dp0"
start "Servidor Mi Carrera" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servidor.ps1"
timeout /t 2 >nul
start "" http://localhost:5500/
exit
