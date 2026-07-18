#!/bin/bash
set -e

# Binario ESPHome fijado para evitar usar instalaciones antiguas del PATH.
ESPHOME_BIN="$HOME/.local/bin/esphome"

# Ruta del directorio donde están tus YAML de ESPHome
ESPHOME_DIR="$HOME/Documents/Codex/Homey Irrigation System/esp32/src"

# Puerto del dashboard
PORT=6052

if [ ! -x "$ESPHOME_BIN" ]; then
  echo "❌ No encuentro ESPHome en $ESPHOME_BIN"
  echo "Instala/actualiza ESPHome con pipx o ajusta ESPHOME_BIN en este script."
  exit 1
fi

echo "Launching ESPHome dashboard..."
echo "Config dir: $ESPHOME_DIR"
echo "URL: http://localhost:$PORT"
echo "ESPHome: $("$ESPHOME_BIN" version)"

"$ESPHOME_BIN" dashboard "$ESPHOME_DIR" --port "$PORT"
