#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "============================================"
echo "  Lyric Video Studio"
echo "============================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[X] Node.js belum terpasang. Butuh versi 22 atau lebih baru."
  exit 1
fi

node_major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$node_major" -lt 22 ]; then
  echo "[X] Node $(node --version) terlalu lama. Butuh >= 22."
  exit 1
fi

command -v ffmpeg >/dev/null 2>&1 || echo "[!] ffmpeg tidak ditemukan — impor & ekspor akan gagal."
command -v yt-dlp >/dev/null 2>&1 || echo "[!] yt-dlp tidak ditemukan — impor YouTube tidak akan jalan."

if [ ! -f .env ] && [ -f .env.example ]; then
  cp .env.example .env
  echo "[i] .env dibuat dari .env.example — isi INFERHUB_API_KEY untuk fitur AI."
  echo
fi

if [ ! -d node_modules ]; then
  echo "[1/2] Memasang dependensi…"
  npm install
fi

if [ ! -d dist ]; then
  echo "[2/2] Membangun aplikasi…"
  npm run build
fi

port="${PORT:-5178}"
url="http://localhost:${port}"
echo
echo "Membuka ${url}"
echo "Tekan Ctrl+C untuk menghentikan server."
echo

( sleep 2; command -v xdg-open >/dev/null 2>&1 && xdg-open "$url" >/dev/null 2>&1 || \
  command -v open >/dev/null 2>&1 && open "$url" >/dev/null 2>&1 || true ) &

exec npm start
