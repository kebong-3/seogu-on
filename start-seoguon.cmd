@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
if errorlevel 1 (
  echo ERROR: Cannot open the project folder.
  goto :failed
)

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js was not found. Install the latest Node.js 22.x and try again.
  goto :failed
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number); if(major!==22||minor<9){console.error('ERROR: Node.js 22.9 or newer within 22.x is required. Found '+process.version); process.exit(1);}"
if errorlevel 1 goto :failed

for %%F in ("package.json" "index.html" "scripts\dev.mjs" "scripts\ensure-runtime.mjs" "vendor\cesium-1.121.0.tar.gz" "vendor\cesium-manifest.json") do (
  if not exist "%%~F" (
    echo ERROR: Missing project file: %%~F
    echo Extract the complete project ZIP before running this file.
    goto :failed
  )
)
for %%D in ("src" "shared" "api" "server" "public\data") do (
  if not exist "%%~D\" (
    echo ERROR: Missing project folder: %%~D
    echo Extract the complete project ZIP before running this file.
    goto :failed
  )
)

echo Starting SEO:ON...
echo Default address: http://127.0.0.1:4173/
echo Use the address printed by the server below. PORT or .env.local may change it.
echo Keep this window open. Press Ctrl+C to stop the server.
node --env-file-if-exists=.env.local scripts/dev.mjs
set "SEOGUON_EXIT_CODE=%ERRORLEVEL%"
if not "%SEOGUON_EXIT_CODE%"=="0" (
  echo ERROR: The server stopped with exit code %SEOGUON_EXIT_CODE%.
  pause
)
exit /b %SEOGUON_EXIT_CODE%

:failed
pause
exit /b 1
