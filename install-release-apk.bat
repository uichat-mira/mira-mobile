@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "PACKAGE_NAME=io.tomz.mira.mobile"
set "ADB="
set "APK="

for %%I in (adb.exe) do if not "%%~$PATH:I"=="" set "ADB=%%~$PATH:I"
if not defined ADB if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
if not defined ADB if exist "D:\Android\Sdk\platform-tools\adb.exe" set "ADB=D:\Android\Sdk\platform-tools\adb.exe"

if not defined ADB (
  echo Android SDK platform-tools was not found.
  echo Install platform-tools or add adb.exe to PATH, then try again.
  pause
  exit /b 1
)

if not "%~1"=="" (
  set "APK=%~f1"
) else (
  echo Drag an APK onto this BAT file, or paste its full path below.
  set /p "APK=APK path: "
  set "APK=!APK:"=!"
  for %%I in ("!APK!") do set "APK=%%~fI"
)

if not defined APK (
  echo No APK path was provided.
  pause
  exit /b 1
)

if not exist "!APK!" (
  echo APK not found:
  echo !APK!
  pause
  exit /b 1
)

if /I not "!APK:~-4!"==".apk" (
  echo The selected file is not an APK:
  echo !APK!
  pause
  exit /b 1
)

set /a DEVICE_COUNT=0
set "DEVICE_ID="
for /f "skip=1 tokens=1,2" %%A in ('"!ADB!" devices') do (
  if "%%B"=="device" (
    set /a DEVICE_COUNT+=1
    set "DEVICE_ID=%%A"
  )
)

if !DEVICE_COUNT! EQU 0 (
  echo No authorized Android device was found.
  echo Connect the phone, enable USB debugging, and accept the authorization prompt.
  "!ADB!" devices
  pause
  exit /b 1
)

if !DEVICE_COUNT! GTR 1 (
  echo More than one authorized Android device is connected:
  "!ADB!" devices -l
  set /p "DEVICE_ID=Device serial: "
)

set "INSTALL_LOG=%TEMP%\uichat-mira-mobile-adb-install.log"

echo Installing on !DEVICE_ID!:
echo !APK!
"!ADB!" -s "!DEVICE_ID!" install -r "!APK!" > "!INSTALL_LOG!" 2>&1
set "INSTALL_EXIT_CODE=!ERRORLEVEL!"
type "!INSTALL_LOG!"

if not "!INSTALL_EXIT_CODE!"=="0" (
  findstr /C:"INSTALL_FAILED_UPDATE_INCOMPATIBLE" "!INSTALL_LOG!" >nul
  if errorlevel 1 (
    findstr /C:"INSTALL_FAILED_USER_RESTRICTED" "!INSTALL_LOG!" >nul
    if not errorlevel 1 (
      echo.
      echo The phone blocked USB installation.
      echo Unlock the phone, enable Install via USB in Developer options,
      echo and accept the installation confirmation on the phone before retrying.
      pause
      exit /b 1
    )

    echo.
    echo Installation failed. The existing app was not removed.
    pause
    exit /b 1
  )

  echo.
  echo The installed app uses a different signing key.
  choice /C YN /N /M "Uninstall !PACKAGE_NAME! and retry? This removes its local app data. [Y/N] "
  if errorlevel 2 (
    echo Installation canceled. The existing app was not removed.
    pause
    exit /b 1
  )

  "!ADB!" -s "!DEVICE_ID!" uninstall "!PACKAGE_NAME!"
  if errorlevel 1 (
    echo Could not uninstall the existing app.
    pause
    exit /b 1
  )

  "!ADB!" -s "!DEVICE_ID!" install "!APK!"
  if errorlevel 1 (
    echo Installation failed after uninstalling the existing app.
    pause
    exit /b 1
  )
)

"!ADB!" -s "!DEVICE_ID!" shell monkey -p "!PACKAGE_NAME!" 1 >nul 2>&1

echo.
echo Installation complete. UIChat Mira was opened on !DEVICE_ID!.
timeout /t 3 /nobreak >nul
exit /b 0
