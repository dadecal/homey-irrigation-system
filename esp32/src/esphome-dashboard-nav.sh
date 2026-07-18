#!/bin/bash
set -e

ESPHOME_BIN="$HOME/.local/bin/esphome"
PORT=6052
WAIT_SECONDS=8   # tiempo máximo para esperar que arranque el dashboard

# Candidatos típicos donde puedes tener los YAML
CANDIDATES=(
#  "$HOME/ESPHomeProjects"
#  "$HOME/esphome"
#  "$HOME/ESPHOME"
#  "$HOME/Documents/ESPHomeProjects"
#  "$HOME/Documents/esphome"
   "$HOME/Documents/Codex/Homey Irrigation System/esp32/src"
  "$(pwd)"
)

# Busca un directorio que tenga al menos un .yaml
ESPHOME_DIR=""
for d in "${CANDIDATES[@]}"; do
  if [ -d "$d" ] && ls "$d"/*.yaml >/dev/null 2>&1; then
    ESPHOME_DIR="$d"
    break
  fi
done

if [ -z "$ESPHOME_DIR" ]; then
  echo "❌ No encuentro tu directorio de ESPHome con YAMLs."
  echo "Candidatos revisados:"
  printf " - %s\n" "${CANDIDATES[@]}"
  echo ""
  echo "Edita el script y fija ESPHOME_DIR manualmente."
  exit 1
fi

if [ ! -x "$ESPHOME_BIN" ]; then
  echo "❌ No encuentro ESPHome en $ESPHOME_BIN"
  echo "Instala/actualiza ESPHome con pipx o ajusta ESPHOME_BIN en este script."
  exit 1
fi

URL="http://localhost:$PORT"

# Comprueba si ya está escuchando el puerto
if lsof -i TCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✅ ESPHome dashboard ya está corriendo en $URL"
else
  echo "🚀 Lanzando ESPHome dashboard en background..."
  echo "🔧 ESPHome: $("$ESPHOME_BIN" version)"
  nohup "$ESPHOME_BIN" dashboard "$ESPHOME_DIR" --port "$PORT" >/tmp/esphome_dashboard.log 2>&1 &
  echo "📄 Log: /tmp/esphome_dashboard.log"

  echo "⏳ Esperando a que arranque (hasta ${WAIT_SECONDS}s)..."
  for i in $(seq 1 $WAIT_SECONDS); do
    if lsof -i TCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
      echo "✅ Dashboard activo."
      break
    fi
    sleep 1
  done
fi

echo "🌐 Abriendo: $URL"
open "$URL"
