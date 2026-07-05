#!/bin/bash
set -e

PORT=6052

echo "==> Buscando procesos escuchando en el puerto ${PORT}..."

PIDS=$(lsof -ti :"${PORT}" || true)

if [ -z "$PIDS" ]; then
  echo "✅ No hay ningún proceso escuchando en el puerto ${PORT}. Nada que detener."
  exit 0
fi

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

PIDS_FINAL=$(lsof -ti :"${PORT}" || true)

if [ -z "$PIDS_FINAL" ]; then
  echo "✅ ESPHome Dashboard detenido correctamente."
else
  echo "❌ No se ha podido detener completamente. PIDs aún activos: $PIDS_FINAL"
  exit 1
fi
