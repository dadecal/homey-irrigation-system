#!/bin/bash
set -e

# Ruta del directorio donde están tus YAML de ESPHome
ESPHOME_DIR="$HOME/Documents/Codex/Homey Irrigation System/esp32/src"

# Puerto del dashboard
PORT=6052

echo "Launching ESPHome dashboard..."
echo "Config dir: $ESPHOME_DIR"
echo "URL: http://localhost:$PORT"

esphome dashboard "$ESPHOME_DIR" --port $PORT
