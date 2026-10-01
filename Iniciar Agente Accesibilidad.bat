@echo off
chcp 65001 >nul
title Agente de Accesibilidad - CFOTech
rem Levanta la demo del Agente de Accesibilidad (panel en pantalla completa).
rem Se puede ejecutar con doble clic desde cualquier lugar.

cd /d "%~dp0"

echo.
echo  ==========================================
echo    Agente de Accesibilidad - CFOTech
echo  ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encontro Node.js. Instalalo desde https://nodejs.org ^(version 20 o superior^) y volve a ejecutar este archivo.
  goto :fin
)

if not exist ".env" (
  echo [ERROR] Falta el archivo .env con la ANTHROPIC_API_KEY.
  echo         Copia .env.example como .env y completa la clave.
  goto :fin
)

findstr /r /c:"^ANTHROPIC_API_KEY=..*" ".env" >nul
if errorlevel 1 (
  echo [ERROR] La ANTHROPIC_API_KEY del archivo .env esta vacia.
  goto :fin
)

if not exist "node_modules" (
  echo Instalando dependencias ^(solo la primera vez^)...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Fallo la instalacion de dependencias.
    goto :fin
  )
)

if not exist "%LOCALAPPDATA%\ms-playwright\chromium-*" (
  echo Instalando el navegador del agente ^(solo la primera vez^)...
  call npx playwright install chromium
)

echo Iniciando el agente... ^(para cerrarlo, cerra esta ventana o presiona Ctrl+C^)
echo.
call npm run demo

:fin
echo.
pause
