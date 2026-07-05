# Homey Irrigation System

Sistema de riego doméstico para seis sectores, con un ESP32 ejecutando
ESPHome como controlador físico y Homey como motor, programador, histórico y
supervisor.

## Componentes

- `esp32/src/Riego_Homey.yaml`: configuración principal de ESPHome.
- `esp32/src/riego/linea.yaml`: paquete reutilizable para cada sector.
- `homey/src/Irrigation.js`: único propietario del motor, los relés y la cola.
- `homey/src/IrrigationStatus.js`: proyección de sensores y estado.
- `homey/src/IrrigationHistory.js`: proyección idempotente del histórico.
- `homey/src/IrrigationHealth.js`: supervisión y diagnóstico.
- `homey/src/IrrigationRecovery.js`: recuperación provisional de la integración
  ESPHome Controller.
- `homey/app`: aplicación Homey del programador automático.

## Arquitectura

La separación de responsabilidades y los contratos de datos están descritos
en:

- [Arquitectura](homey/doc/Architecture.md)
- [Guía de desarrollo](homey/doc/DeveloperGuide.md)
- [Modelo de datos](homey/doc/DataModel.md)
- [Pruebas](homey/doc/Testing.md)
- [Normas para agentes](AGENTS.md)

Antes de modificar el proyecto deben leerse esos documentos.

## Configuración local

1. Copiar `esp32/src/secrets.example.yaml` como
   `esp32/src/secrets.yaml`.
2. Completar las credenciales y parámetros de red locales.
3. Validar ESPHome:

   ```bash
   esphome config esp32/src/Riego_Homey.yaml
   ```

4. Validar y probar la aplicación Homey:

   ```bash
   cd homey/app
   npm install
   npm run validate
   npm test
   ```

## Seguridad

Las credenciales reales se guardan exclusivamente en `secrets.yaml`, que está
excluido de Git. No deben incluirse tokens, contraseñas ni informes privados en
commits o incidencias públicas.

## Versionado

El proyecto utiliza etiquetas semánticas (`v0.1.0`, `v0.2.0`, etc.). La rama
`main` representa la versión estable y los cambios se desarrollan en ramas
específicas antes de integrarse.
