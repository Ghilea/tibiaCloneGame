@echo off
setlocal
set SCRIPT_DIR=%~dp0
node "%SCRIPT_DIR%content-packs\aldoria-item-restyle-v3\install.mjs" --repo "%CD%" --package-root "%SCRIPT_DIR%content-packs\aldoria-item-restyle-v3" %*
