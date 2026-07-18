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

## Versionado y releases

El sistema separa tres conceptos:

- versión de componente: cambia sólo cuando cambia ese módulo concreto;
- contrato: interfaz funcional que un componente publica o requiere;
- release de sistema: combinación validada de app Homey, firmware ESP32 y
  HomeyScripts.

No es obligatorio recompilar ni subir todos los módulos en cada release. Si una
release sólo cambia la app Homey, el manifest puede referenciar el mismo
firmware ESP32 y los mismos HomeyScripts anteriores con sus hashes originales.

La fuente de versiones y contratos está en `release/components.json`. Para
generar un manifest local:

```bash
node tools/release/prepare-release.mjs --system-release v1.0.0
```

Para generar el artefacto versionado de la app Homey:

```bash
node tools/release/build-homey-app.mjs
```

El script valida, ejecuta tests, genera `.homeybuild` con el CLI de Homey y
crea `dist/artifacts/homey-app/homey-irrigation-app-<version>.zip`.

Para generar el artefacto versionado de los HomeyScripts:

```bash
node tools/release/build-homey-scripts.mjs
```

El zip resultante contiene los scripts de `homey/src/` y un manifest interno
con versión, contratos y SHA256 por fichero.

El mapeo entre fichero local y script real de Homey está en
`release/homey-scripts.json`. Cada entrada declara el nombre funcional local,
el `remoteName` visible en Homey y el `homeyScriptId` real, para evitar
desplegar o verificar un script equivocado por coincidencia de nombres.

Para generar la huella esperada de los scripts locales:

```bash
node tools/release/check-homey-scripts.mjs expected
```

Para comparar contra una exportación remota de Homey:

```bash
node tools/release/check-homey-scripts.mjs verify --remote-file remote-homey-scripts.json
```

Si se quiere guardar exactamente el firmware compilado que se va a subir al
ESP32:

```bash
node tools/release/prepare-release.mjs \
  --system-release v1.0.0 \
  --esp32-bin /private/tmp/esphome-riego-build/.pioenvs/riego/firmware.ota.bin \
  --homey-app-artifact dist/artifacts/homey-app/homey-irrigation-app-0.1.0.zip \
  --homey-scripts-artifact dist/artifacts/homey-scripts/homey-scripts-1.3.0.zip
```

El resultado se escribe en `dist/releases/<release>/`, excluido de Git para
evitar commitear binarios por accidente. Esos artefactos son los que deben
subirse a GitHub Releases.

Para que la app instalada en Homey coincida con el artefacto, después de
generar el zip debe instalarse la build ya generada:

```bash
cd homey/app
npx homey app install --skip-build
```
