@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo   Lyric Video Studio
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js belum terpasang.
  echo     Jalankan:  winget install OpenJS.NodeJS.LTS
  echo     lalu buka ulang skrip ini.
  pause
  exit /b 1
)

where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo [!] ffmpeg tidak ditemukan di PATH.
  echo     Impor dan ekspor akan gagal. Pasang: winget install Gyan.FFmpeg
  echo.
)

where yt-dlp >nul 2>nul
if errorlevel 1 (
  echo [!] yt-dlp tidak ditemukan di PATH.
  echo     Impor YouTube tidak akan jalan. Pasang: winget install yt-dlp.yt-dlp
  echo.
)

if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo [i] Berkas .env dibuat dari .env.example.
    echo     Isi INFERHUB_API_KEY bila ingin memakai transkripsi AI.
    echo.
  )
)

if not exist "node_modules" (
  echo [1/2] Memasang dependensi... (sekali saja, butuh internet)
  call npm install
  if errorlevel 1 (
    echo [X] npm install gagal.
    pause
    exit /b 1
  )
)

if not exist "dist" (
  echo [2/2] Membangun aplikasi... (sekali saja)
  call npm run build
  if errorlevel 1 (
    echo [X] Build gagal.
    pause
    exit /b 1
  )
)

echo.
echo Membuka http://localhost:5178
echo Tutup jendela ini atau tekan Ctrl+C untuk menghentikan server.
echo.
start "" http://localhost:5178
call npm start
pause
