#!/bin/bash
set -e

PORT=6052
ESPHOME_DIR="$HOME/Documents/Codex/Homey Irrigation System/esp32/src"
CONFIG_FILE="$ESPHOME_DIR/Riego_Homey.yaml"

echo "==> Buscando procesos escuchando en el puerto ${PORT}..."

PIDS=$(lsof -ti :"${PORT}" || true)

if [ -z "$PIDS" ]; then
  echo "✅ No hay ningún proceso escuchando en el puerto ${PORT}."
else
  echo "==> Encontrados PID(s): $PIDS"
  echo "==> Intentando detenerlos limpiamente (SIGTERM)..."

  kill $PIDS || true

  sleep 2

  PIDS_REMAIN=$(lsof -ti :"${PORT}" || true)

  if [ -n "$PIDS_REMAIN" ]; then
    echo "⚠️  Siguen vivos: $PIDS_REMAIN"
    echo "==> Forzando detención (SIGKILL)..."
    kill -9 $PIDS_REMAIN || true
    sleep 1
  fi
fi

echo "==> Buscando procesos hijo de ESPHome dashboard asociados a Riego..."

RUN_PIDS=$(pgrep -f "esphome --dashboard run .*${CONFIG_FILE}" || true)

if [ -z "$RUN_PIDS" ]; then
  echo "✅ No hay procesos '--dashboard run' asociados a Riego."
else
  echo "==> Encontrados PID(s) hijo: $RUN_PIDS"
  echo "==> Intentando detenerlos limpiamente (SIGTERM)..."
  kill $RUN_PIDS || true
  sleep 2

  RUN_PIDS_REMAIN=$(pgrep -f "esphome --dashboard run .*${CONFIG_FILE}" || true)

  if [ -n "$RUN_PIDS_REMAIN" ]; then
    echo "⚠️  Siguen vivos: $RUN_PIDS_REMAIN"
    echo "==> Forzando detención (SIGKILL)..."
    kill -9 $RUN_PIDS_REMAIN || true
    sleep 1
  fi
fi

PIDS_FINAL=$(lsof -ti :"${PORT}" || true)
RUN_PIDS_FINAL=$(pgrep -f "esphome --dashboard run .*${CONFIG_FILE}" || true)

if [ -z "$PIDS_FINAL" ] && [ -z "$RUN_PIDS_FINAL" ]; then
  echo "✅ ESPHome Dashboard y procesos de logs detenidos correctamente."
else
  if [ -n "$PIDS_FINAL" ]; then
    echo "❌ PIDs aún escuchando en ${PORT}: $PIDS_FINAL"
  fi
  if [ -n "$RUN_PIDS_FINAL" ]; then
    echo "❌ PIDs '--dashboard run' aún activos: $RUN_PIDS_FINAL"
  fi
  sleep 1
  exit 1
fi
