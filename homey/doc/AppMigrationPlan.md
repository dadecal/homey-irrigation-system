# Plan Rama 2 - app Homey nativa

Fecha de inicio: 2026-07-18

Este documento es la fuente de seguimiento de la Rama 2 del sistema de riego.
Debe actualizarse cada vez que avancemos una fase, cambiemos de estrategia o
dejemos una decision pendiente.

## Estado actual - 2026-08-29

* Release activa de sistema: `v2.0.23`.
* App activa: `homeyAppV2@2.0.18`, instalada desde artefacto exacto de release.
* Firmware ESP32 activo: `esp32Firmware@1.0.6`, instalado por OTA desde
  artefacto exacto de release. La version anterior `1.0.5` fue instalada por
  OTA desde artefacto exacto de release.
* `esp32Firmware@1.0.2` reduce `pulse_counter.update_interval` a `1s` y espera
  `1200ms` al cierre de linea para registrar mejor calibraciones manuales
  cortas.
* `homeyAppV2@2.0.16` espera `2000ms` antes de leer litros finales tras apagar
  el rele y, si la primera lectura sigue siendo `0`, reintenta durante una
  ventana corta para absorber el retraso con el que Homey puede exponer la
  publicacion ya recibida desde ESPHome Controller. Tambien solicita
  `RecoveryService` si un arranque manual falla porque ESPHome Controller no
  acepta comandos (`CONTROLLER_COMMAND_UNAVAILABLE`).
* `esp32Firmware@1.0.3` calibra S3 a `286 pulsos/L`, calculado con una prueba
  fisica de `11 L` reales frente a `7.952 L` reportados con el factor anterior
  `396 pulsos/L`.
* `esp32Firmware@1.0.4` corrige falsos disparos de `irrigation.safety` en
  pruebas manuales cortas: el watchdog local de `35 min` deja de vivir como
  `delay` directo en `on_turn_on` y pasa a un script cancelable/reiniciable por
  linea.
* `esp32Firmware@1.0.5` aplica `990 pulsos/L` a S1-S6 y anade una
  ventana de gracia global de `60s` tras cerrar cualquier rele antes de
  considerar fuga por caudal residual.
* `esp32Firmware@1.0.6` anade un watchdog local de volumen por linea: si un
  sector supera `300 L` en un unico riego, el ESP32 registra
  `irrigation.safety` y fuerza el cierre del rele como fuga probable.
* `homeyAppV2@2.0.17` elimina la notificacion push directa desde
  `HealthService`. Las incidencias accionables se comunican por
  `health_transition`, y el Flow `Riego - Aviso de incidencia hardware v2`
  queda como unico propietario de la notificacion visible para evitar duplicados
  app+Flow en la cronologia.
* `homeyAppV2@2.0.18` mejora el diagnostico de fugas: cuando hay una unica
  capability de fuga activa y el ultimo evento crudo reciente de ESPHome indica
  `Flow detected on line X while relay is off`, Health usa esa linea explicita
  para nombrar la incidencia y guarda en telemetria la linea cruda, el sector
  deducido de la capability y si existe discrepancia.
* El motor V2 conserva la cola si se pierde ESPHome Controller/RAW durante un
  riego. El programa queda en recuperacion pendiente y la pagina de settings
  permite reanudar los sectores restantes o cancelar el programa.
* Las incidencias accionables de salud (`ERROR`/`OFFLINE`) siguen disparando
  `health_transition` y ademas intentan crear una notificacion Homey con el
  formato corto `Incidencia en sistema de riego: <detalle>`.
* La retirada runtime de devices legacy V1 queda completada y Rama 2 ya no debe
  referenciar codigo, artefactos ni Variables Logic V1 ni siquiera como
  fallback. Su fuente de verdad activa es `appStateV2` mas devices/Flow Cards
  nativos v2.
* `StatusSyncService` queda retirado (`retired=true`, `timerActive=false`).
  `SystemDeviceProjectionService` es el propietario de la proyeccion de
  `Sistema de Riego v2`.
* `ManualDeviceService` usa `IrrigationEngineService` para comandos nativos y
  `appStateV2.engine` para proyectar estado manual.
* `HealthService` persiste salud y dispara `health_transition`, sin escribir
  capabilities V1.
* `HistoryService` proyecta solo a `Historico de Riego v2` y
  `appStateV2.history`; su idempotencia activa no depende de
  `Irrigation.HistoryLastProjectedId`.
* Artefactos: `dist/releases/v2.0.23` contiene la app v2.0.18 y el binario
  ESP32 `riego-esp32-1.0.6.ota.bin`. SHA256 app:
  `74ff1b3645969d71024607a7aea8849e445a6fa38d8c9ab78533363ea4ec767f`;
  SHA256 ESP32:
  `ed615a2af27564313049163d4b4b610bda330e591b72143be105faf242133358`.
* Validacion: `npm run validate`, `npm test` con 156 tests,
  `homey app build` y `homey app validate --level publish` OK. Firmware
  heredado de `v2.0.21` ya validado con `esphome config` y `esphome compile`.
* Instalacion validada: app instalada desde artefacto exacto v2.0.18. Homey
  confirma RAW `Riego` disponible, firmware
  `1.0.6`, contrato `irrigation-hw-api@1.0.0`, seis reles apagados y sensores
  de fuga en `false`. Tras el reinicio OTA puede aparecer un warning
  informativo de `web_server_idf` por POST `application/json`; es ruido conocido
  del web server de ESPHome y no tiene relacion con fuga ni relés.
* Limpieza Homey ejecutada: los Flows V1/deshabilitados de riego han sido
  eliminados. En Homey solo quedan los cuatro Flows v2 activos:
  `Riego - Aviso autorrecuperacion ESPHome v2`,
  `Riego - Aviso de incidencia hardware v2`,
  `Riego - Aviso inicio de sector v2` y
  `Riego - Aviso fin de sector v2`.

## Actualización 2026-08-26

* Se formaliza la release de sistema Rama 2 `v2.0.15`.
* La app Homey no cambia y permanece en `homeyAppV2@2.0.14`.
* Se sube el firmware ESP32 a `1.0.1`, manteniendo contrato hardware
  `irrigation-hw-api@1.0.0`.
* El firmware introduce calibración de caudal por sector mediante
  `pulses_per_liter_1..6` y cada include de línea recibe su factor propio.
* S1 queda provisionalmente en `990 pulsos/L`, equivalente a dividir por 2.5
  la lectura anterior basada en `396 pulsos/L`; S2-S6 conservan `396 pulsos/L`.
* La calibración se marca como provisional: el ajuste definitivo debe calcularse
  con `factor_nuevo = factor_actual * litros_reportados / litros_reales` tras
  medir litros reales en una prueba física.
* Verificacion ESPHome: `esphome config Riego_Homey.yaml` OK y
  `esphome compile Riego_Homey.yaml` OK. El binario OTA generado se registra
  como `dist/releases/v2.0.15/riego-esp32-1.0.1.ota.bin`.
* Artefactos de `dist/releases/v2.0.15`: ESP32 SHA256
  `3090bc334557d2747c4d7c3320e2925013078e4241de5207110b6fe3262c89c6`;
  app v2.0.14 SHA256
  `b1d609d8a48bb69da9e8d2afe2d8355d9f7de49d553b8562736a2f68abe3e2a1`.
* OTA ejecutada con el binario exacto registrado. Homey confirma RAW `Riego`
  disponible, `ESP Firmware Version=1.0.1`,
  `ESP Hardware Contract=irrigation-hw-api@1.0.0` y seis reles apagados.

* Se formaliza la release Rama 2 `homeyAppV2@2.0.14`.
* Se corrige la captura de litros del motor nativo: en cierre activo el plan
  apaga primero los reles, espera la publicacion final de ESPHome y lee
  `Litros ciclo actual` antes de persistir historico y emitir `sector_ended`.
* La correccion aplica a parada por `timeout`, parada manual y watchdog/abortos
  que pasan por `buildStopPlan`.
* Se añade un valor runtime de litros en `EnginePlanExecutor`, resuelto en
  ejecucion para `appendHistory` y `emitSectorEvent`, manteniendo los planes
  dry-run sin escrituras reales.
* Se añade prueba de regresion que reproduce el caso fisico: el sensor empieza
  en `0`, ESPHome publica `72.76010131835938` al apagar el rele y el historico
  persiste ese valor final.
* `HistoryService` reconcilia las capacidades acumuladas del device nativo
  desde `appStateV2.history.lastProjection` cuando el evento ya estaba marcado
  como proyectado, evitando dejar el historico parcial tras una reparacion o
  una reinstalacion.
* Verificacion local: `npm run validate`, `npm test` con 150 tests OK,
  `homey app build` y `homey app validate` correctos.
* Artefactos de `dist/releases/v2.0.14`: app v2 SHA256
  `b1d609d8a48bb69da9e8d2afe2d8355d9f7de49d553b8562736a2f68abe3e2a1`;
  ESP32 SHA256
  `3c9fb7a6fb671e6f621ceabfe2aa25055c478ccd58845bf5f5fc48f30a054961`.
* La release incluye el binario ESP32 compatible aunque el firmware no cambia,
  reutilizando el artefacto validado en `v2.0.12`.
* Se corrige el evento real del 26 de agosto de 2026 para S1 manual de 5
  minutos: el RAW habia publicado `72.76010131835938 L`, pero el historico se
  habia persistido con `0 L` por la carrera de cierre.

## Actualización 2026-08-25

* Se prepara la release Rama 2 `homeyAppV2@2.0.12`.
* Se corrige el fallo de arranque nativo cuando ESPHome Controller aparece
  disponible para lectura pero rechaza escrituras con
  `Cannot send command: client not connected`.
* `IrrigationEngineService` clasifica ese fallo como
  `CONTROLLER_COMMAND_UNAVAILABLE` y `retryable=true` solo para arranques de
  programa.
* El plan de fallo de arranque deja el motor en `IDLE`, sector `0`, sin cola y
  `stopReason=none`, evitando el falso estado `ERROR sector 0`.
* `Scheduler` no marca `lastRunDate`, limpia la solicitud pendiente, registra
  `START_DEFERRED`, crea notificacion Homey y mantiene el programa como
  reintentable dentro de la ventana activa del dia.
* `Scheduler` solicita a `RecoveryService` un reinicio seguro por fallo de
  comandos; Recovery conserva su responsabilidad exclusiva de reiniciar ESPHome
  Controller y aplica modo `ACTIVE_COMPAT`, confirmacion explicita, motor
  `IDLE`, sector `0`, reles apagados, scope/token, cooldown y limite de
  intentos.
* Verificacion local: `npm run validate`, `npm test` con 148 tests OK,
  `homey app build` y `homey app validate` correctos.
* Artefactos de `dist/releases/v2.0.12`: app v2 SHA256
  `ef9665c02acad581f65dbb7bdc072686c76373b47f7e2cf6f4fb6dd84d9d728b`;
  ESP32 SHA256
  `3c9fb7a6fb671e6f621ceabfe2aa25055c478ccd58845bf5f5fc48f30a054961`.
* La release incluye el binario ESP32 compatible aunque el firmware no cambia,
  reutilizando el artefacto validado en `v2.0.11`.
* Instalacion validada en Homey Pro desde artefacto exacto:
  `com.dadecal.irrigation.v2` queda en `version=2.0.12`, `enabled=true`,
  `state=running`. La comprobacion posterior confirma motor `IDLE`, sector `0`,
  cola `0`, sin interrupcion y sin reles activos. La llamada `/release` via
  `getAppStd` no aplica a esta instalacion local porque Homey responde
  `App Origin Not App Store`.

* Se formaliza la release Rama 2 `homeyAppV2@2.0.11`.
* Se corrige la reaccion del motor nativo ante perdida de ESPHome
  Controller/RAW durante `RUNNING`: ya no interpreta el snapshot incompleto
  como “todos los reles apagados” ni limpia la cola pendiente.
* Se introduce `appStateV2.engine.interruption` como estado interno de
  recuperacion asistida. Mientras existe, el motor permanece en `ERROR`,
  conserva `queue`, no auto-reanuda y espera decision del usuario.
* La recuperacion marca la interrupcion como `READY_TO_RESUME` cuando el RAW
  vuelve a estar disponible y no hay reles activos. Entonces la UI permite
  `Reanudar pendientes`; si el usuario no quiere continuar, puede
  `Cancelar programa`.
* Se añaden los endpoints nativos `/engine/resume-pending` y
  `/engine/cancel-pending`.
* `HealthService` añade notificacion Homey directa para incidencias accionables
  con formato corto, ademas del Flow Trigger `health_transition` existente.
* Verificacion local: `npm run validate`, `npm test` con 143 tests OK,
  `homey app build` y `homey app validate` correctos.
* Artefactos de `dist/releases/v2.0.11`: app v2 SHA256
  `619e1407667aad86224d72dd09ed28f8c3cdb8fabd46e089886d2ad5779a4eae`;
  ESP32 SHA256
  `3c9fb7a6fb671e6f621ceabfe2aa25055c478ccd58845bf5f5fc48f30a054961`.
* La release incluye el binario ESP32 compatible aunque el firmware no cambia,
  reutilizando el artefacto validado en `v2.0.10`.
* Instalacion validada en Homey Pro desde artefacto exacto:
  `com.dadecal.irrigation.v2` queda en `version=2.0.11`, `enabled=true`,
  `state=running`.

## Actualización 2026-08-13

* Se formaliza la release Rama 2 `homeyAppV2@2.0.10`.
* Se corrige la UI de Rain Delay en settings: los botones permanecen
  accionables visualmente aunque existan cambios pendientes y muestran un aviso
  explicito para guardar antes de aplicar/cancelar Rain Delay, evitando la
  sensacion de boton inactivo sin feedback.
* Se elimina del manifest fuente `.homeycompose/app.json` la ruta obsoleta
  `/diagnostics/logic-write-probe`, para que futuras regeneraciones no
  recuperen artefactos retirados de Rama 2.
* Se añade la regla de cierre: toda release liberada debe subirse a GitHub con
  codigo, herramientas, documentacion y entregables.
* Artefactos de `dist/releases/v2.0.10`: app v2 SHA256
  `a2d79bf1bfc589ff4e33d03fdbcbe507e6159d9b9f1fa93e297c0c142a7f5030`;
  ESP32 SHA256
  `3c9fb7a6fb671e6f621ceabfe2aa25055c478ccd58845bf5f5fc48f30a054961`.
* La release incluye el binario ESP32 compatible aunque el firmware no cambia,
  reutilizando el artefacto validado en `v2.0.9`.
* Instalacion validada en Homey Pro desde artefacto exacto:
  `com.dadecal.irrigation.v2` queda en `version=2.0.10`, `enabled=true`,
  `state=running`; `/release` devuelve `appVersion=2.0.10` y
  `artifactPattern=homey-irrigation-app-v2-2.0.10.tgz`.
* Verificacion de servicios tras instalacion: `engine`, `health`, `history`,
  `recovery`, `system-device`, `manual-device`, `status-sync` y `diagnostics`
  sin `lastError`; `status-sync` mantiene `retired=true`, `timerActive=false`.

* Se formaliza la release Rama 2 `homeyAppV2@2.0.9`.
* Decision arquitectonica posterior a la retirada de V1: `homey/app-v2` no debe
  referenciar codigo, artefactos ni variables de Rama 1 ni siquiera como
  fallback. La Rama 2 es una generacion separada y su fuente de verdad activa
  es `appStateV2` mas los devices/Flow Cards nativos v2.
* Se retiran de la app v2 los fallbacks a Variables Logic `Irrigation.*`,
  `LogicVariableStore`, `logic-write-probe` y la ruta
  `/diagnostics/logic-write-probe`.
* `EngineStateSource`, `IrrigationEngineService`, `HealthService`,
  `HistoryService`, `RecoveryService`, `SystemDeviceProjectionService` y
  `MotorConfirmationStore` quedan alineados con estado nativo v2.
* La pagina de settings mejora la visibilidad de la pestana activa y el boton
  Guardar queda deshabilitado hasta que existan cambios pendientes, con feedback
  visual despues de guardar.
* Verificacion local: busqueda limpia en `homey/app-v2` para referencias a
  Variables Logic/artefactos V1, `npm run validate` correcto y `npm test`
  correcto con 141 tests.
* Artefactos de `dist/releases/v2.0.9`: app v2 SHA256
  `da3620aecc4ed5b5318614979b847c470af76c1c60f1fe06888e370c8d647028`;
  ESP32 SHA256
  `3c9fb7a6fb671e6f621ceabfe2aa25055c478ccd58845bf5f5fc48f30a054961`.
* La release incluye el binario ESP32 compatible aunque el firmware no cambia,
  reutilizando el artefacto validado en `v2.0.8`.
* Instalacion validada en Homey Pro desde artefacto exacto:
  `com.dadecal.irrigation.v2` queda en `version=2.0.9`, `enabled=true`,
  `state=running`; `/release` devuelve `appVersion=2.0.9` y
  `artifactPattern=homey-irrigation-app-v2-2.0.9.tgz`.
* Verificacion de servicios tras instalacion: `engine`, `health`, `history`,
  `recovery`, `system-device`, `manual-device`, `status-sync` y `diagnostics`
  sin `lastError`; `status-sync` mantiene `retired=true`, `timerActive=false`.

* Se formaliza la release Rama 2 `homeyAppV2@2.0.7` para preparar la retirada
  de devices legacy V1.
* Las proyecciones hacia `Riego manual`, `Sistema de Riego` e
  `Historico de Riego` pasan a ser opcionales. La ausencia del device legacy
  se registra como `LEGACY_DEVICE_NOT_FOUND` y no debe romper planes del motor,
  checks periodicos ni proyeccion nativa.
* `EnginePlanExecutor` mantiene obligatorio solo el RAW ESPHome `Riego` para
  operaciones físicas; los devices V1 quedan como espejo legacy retirables.
* `ManualDeviceService` conserva sector/duracion desde el device nativo en
  `engine=ACTIVE_COMPAT` y no necesita escribir en `Riego manual` V1.
* `HistoryService` puede proyectar hacia `Historico de Riego v2` y avanzar
  `appStateV2.history.lastProjectedEventId` aunque falten los devices legacy
  de sistema/historico.
* Artefactos de `dist/releases/v2.0.7`: app v2 SHA256
  `1184e17620542971a05a6f650270ec3627b4baede8b028a894a56b5cdbb3f994`;
  ESP32 SHA256
  `3c9fb7a6fb671e6f621ceabfe2aa25055c478ccd58845bf5f5fc48f30a054961`.
* La release incluye el binario ESP32 compatible aunque el firmware no cambia,
  reutilizando el artefacto validado en `v2.0.6`.
* Verificacion local: `npm test` pasa con 147 tests; el build formal de app v2
  completa validate, tests, build y validacion Homey.
* La instalacion de `v2.0.7` se realiza desde artefacto formal sin `--clean`.
  Homey confirma `/release.appVersion=2.0.7`,
  `artifactPattern=homey-irrigation-app-v2-2.0.7.tgz` y contrato
  `irrigation-app-api@2.0.7`.
* Preflight real tras instalacion: `engine`, `health`, `statusSync`,
  `history`, `recovery`, `manualDevice` y `systemDevice` siguen en
  `ACTIVE_COMPAT` sin `lastError`; Health devuelve `OK`; StatusSync y
  SystemDevice proyectan correctamente; History no tiene evento pendiente
  (`NO_HISTORY`); ManualDevice proyecta al device nativo.
* Estado de fase: preparada la eliminacion controlada de los tres devices V1.
  No se han borrado todavía.
* Retirada ejecutada: se borran `Riego manual`, `Sistema de Riego` e
  `Historico de Riego` V1 de Homey. Los IDs legacy quedan inexistentes tras la
  operacion.
* Preflight posterior a la retirada: los tres devices nativos v2 permanecen
  disponibles en zona `Riego`; todos los servicios Rama 2 siguen en
  `ACTIVE_COMPAT` sin `lastError`; Health queda `OK`; StatusSync y ManualDevice
  reportan la ausencia legacy por los caminos esperados (`LEGACY_DEVICE_NOT_FOUND`
  y `legacyDeviceAvailable=false`).
* Estado de fase: los devices V1 ya estan retirados.
* Limpieza posterior ejecutada: se eliminan los Flows V1/deshabilitados de
  Homey, incluidos avisos legacy, status/history/health legacy, motor ON/OFF,
  tick legacy, programador legacy, puente `program_requested` v2 hacia
  `Irrigation.js` y prototipos deshabilitados. Permanecen solo los cuatro
  Flows v2 activos de notificacion.

* Se formaliza la release Rama 2 `homeyAppV2@2.0.6`.
* `v2.0.6` corrige falsos errores de Health durante reposo: `FORCE_IDLE_NONE`
  ya no escribe relés ni aplica `failurePlan` fisico cuando el motor esta
  `IDLE` y no se observan relés activos. El apagado defensivo se conserva para
  `FORCE_IDLE_WATCHDOG`.
* `HealthService` deja de re-notificar el mismo error accionable si solo
  cambian warnings no accionables de ESPHome.
* Artefactos de `dist/releases/v2.0.6`: app v2 SHA256
  `8c252742cef01c575fe7b00a9e72094d05e8745cafbc0358b88672969f03feae`;
  ESP32 SHA256
  `3c9fb7a6fb671e6f621ceabfe2aa25055c478ccd58845bf5f5fc48f30a054961`.
* La instalacion de `v2.0.6` se realiza desde artefacto formal sin `--clean`;
  Homey confirma `/release.appVersion=2.0.6`.
* Verificacion en Homey: `POST /health/check` devuelve `OK`,
  `notificationChanged=false` y `health_transition=UNCHANGED`; `POST
  /engine/tick` en reposo ejecuta `FORCE_IDLE_NONE` sin escritura de relés y
  sin plan de fallo.
* Se formaliza la release Rama 2 `homeyAppV2@2.0.5`.
* `v2.0.5` corrige el icono visible de los devices nativos declarando
  `drivers/<driverId>/assets/icon.svg` para los tres drivers v2. Esta ubicacion
  es la que Homey usa para calcular el `iconObj` del driver y del device nuevo.
* Se instalan los artefactos formales sin `--clean`; Homey confirma
  `/release.appVersion=2.0.5`.
* Artefactos de `dist/releases/v2.0.5`: app v2 SHA256
  `239961c2e21d072f3c55109d77e2fa7172f1fe9649553788bd8d6e52c2e8037e`;
  ESP32 SHA256
  `3c9fb7a6fb671e6f621ceabfe2aa25055c478ccd58845bf5f5fc48f30a054961`.
* Se recrean los devices v2 en la zona `Riego` para heredar los iconos de
  driver corregidos: `Sistema de Riego v2`
  (`9b64ed88-17cd-4dd0-bd0d-484850ad83fd`), `Historico de Riego v2`
  (`793d9117-8709-43f2-a0d8-9938d07ab22e`) y `Riego Manual v2`
  (`8171ea4e-7f63-4597-b53d-0a027a540840`).
* Se verifican por API local `iconOverride=null`, `iconObj` propio por driver,
  indicadores `irrigation_state`, `irrigation_history_timestamp` y `.none`, y
  quick action `onoff` en `Riego Manual v2`.
* Se formaliza la release Rama 2 `homeyAppV2@2.0.4`.
* `v2.0.4` elimina los `iconOverride` legacy de la recreacion interna de
  devices v2 para que los nuevos emparejamientos usen los iconos PNG de driver.
* Se alinean los indicadores con V1: sistema `irrigation_state`, historico
  `irrigation_history_timestamp` y manual `.none`.
* Homey permite corregir `uiIndicator` en caliente, pero no permite actualizar
  `ui.quickAction` ni recalcula `iconObj` de devices ya emparejados. Para
  cerrar iconos y accion por defecto hay que recrear los tres devices v2 tras
  instalar `2.0.4`.
* Artefactos de `dist/releases/v2.0.4`: app v2 SHA256
  `30f4f4dcd7e880c69c754813578bd59086853960fac9d3b86ed095dd758e523f`;
  ESP32 SHA256
  `3c9fb7a6fb671e6f621ceabfe2aa25055c478ccd58845bf5f5fc48f30a054961`.
* La instalacion de `v2.0.4` se realiza desde artefacto formal sin `--clean`.
  Homey confirma Manager Apps `version=2.0.4`, `state=running` y
  `/release.appVersion=2.0.4`.
* Se prepara la release Rama 2 `homeyAppV2@2.0.3`.
* `v2.0.3` corrige la presentacion de los devices nativos v2: iconos PNG de
  driver empaquetados, quick action `onoff` para `Riego Manual v2` e
  indicadores `irrigation_state`, `irrigation_history_last_watering` e
  `irrigation_manual_message`.
* La release de sistema `v2.0.3` incluye de nuevo el binario ESP32 compatible
  `riego-esp32-1.0.0.ota.bin` sin cambios de firmware.
* Artefactos de `dist/releases/v2.0.3`: app v2 SHA256
  `bfeb3f99552c3b028338538e8d36f57ae1a3ee6fec9ce7fbbe28a240c386b7a5`;
  ESP32 SHA256
  `3c9fb7a6fb671e6f621ceabfe2aa25055c478ccd58845bf5f5fc48f30a054961`.
* La instalacion de `v2.0.3` se realiza desde artefacto formal sin `--clean`.
  Homey confirma Manager Apps `version=2.0.3`, `state=running` y
  `/release.appVersion=2.0.3`.
* Se formaliza la release Rama 2 `homeyAppV2@2.0.2`.
* La pantalla de settings separa la configuracion operativa y el diagnostico
  en pestanas internas para que el bloque de diagnostico no interrumpa el
  recorrido hasta `Proximo riego` y `Guardar cambios`.
* La release de sistema `v2.0.2` mantiene el binario ESP32 compatible
  `riego-esp32-1.0.0.ota.bin` sin cambios de firmware.
* Artefactos de `dist/releases/v2.0.2`: app v2 SHA256
  `b20a4ca6e1b670dc6bc3903cb048cd64d988ef7a26762fd0f86ec453a16bce4d`;
  ESP32 SHA256
  `3c9fb7a6fb671e6f621ceabfe2aa25055c478ccd58845bf5f5fc48f30a054961`.
* La instalacion se ha realizado desde el artefacto formal sin `--clean`;
  Homey confirma `/release.appVersion=2.0.2` y conserva la configuracion
  del programador.
* Semanas despues se detecta que los devices nativos v2 habian desaparecido
  de Homey, probablemente por una reinstalacion previa con limpieza. Se
  recrean por PairSession CLI y quedan como inventario vivo:
  `Sistema de Riego v2` (`67bd9d74-d638-4f41-9e68-0e721d447925`),
  `Historico de Riego v2` (`925622ad-4530-4b34-be25-fff9fb89586f`) y
  `Riego Manual v2` (`79ff2ec7-07a6-49f0-af93-7e562445114e`).
  Mientras no se validen visualmente de nuevo, no deben borrarse los devices
  legacy V1.
* Los tres devices v2 se corrigen a la zona `Riego`
  (`c00ba2c5-9d67-4e16-89c0-cc4ef82b5d1f`) y se les asigna `iconOverride`
  con las mismas rutas usadas por los devices V1. Los `ensure` internos quedan
  actualizados para conservar zona e icono si hay que recrearlos de nuevo.
* Se detecta que `iconOverride` hacia rutas `userdata` no cambia el icono
  generico visible de los devices nativos v2. Se añaden iconos PNG propios en
  `homey/app-v2/assets/device-icons` y se declaran en los drivers
  `irrigation_system`, `irrigation_history` e `irrigation_manual`.
* Se declaran en driver los ajustes UI equivalentes: manual con quick action
  `onoff`, sistema con indicador `irrigation_state`, historico con indicador
  `irrigation_history_last_watering` y manual con indicador
  `irrigation_manual_message`. Para devices ya creados puede ser necesario
  recrearlos, porque Homey no expone `ui.quickAction` como actualizable.

## Actualización 2026-08-12

* Se formaliza la release Rama 2 `homeyAppV2@2.0.1`.
* La release de sistema `v2.0.1` queda regenerada con el binario ESP32
  compatible `riego-esp32-1.0.0.ota.bin`. No hay cambio de firmware; se
  reutiliza el artefacto validado de v1.0.1 y queda incluido en
  `dist/releases/v2.0.1` con SHA256
  `3c9fb7a6fb671e6f621ceabfe2aa25055c478ccd58845bf5f5fc48f30a054961`.
* Se añade preflight al Scheduler v2 antes de entregar un programa al motor
  nativo. El preflight bloquea arranques cuando la salud esta en
  `ERROR/OFFLINE`, Recovery esta esperando recuperacion, ESPHome Controller se
  acaba de reiniciar/recuperar, el motor no esta `IDLE`, RAW no esta disponible
  o hay reles activos observados.
* El bloqueo se persiste en `schedulerConfigV2.preflightBlock`. El Scheduler
  reintenta durante 15 minutos y, si el sistema no se estabiliza, cancela el
  riego del dia con evento `PREFLIGHT_CANCELLED`.
* Se crea `DiagnosticsService` y `/diagnostics/status` para consultar estado
  agregado de Scheduler, Health, Recovery, motor, ticks, acciones y eventos.
  La pantalla de settings incorpora una seccion compacta de diagnostico.
* `appStateV2.events` pasa a retener 150 eventos como caja negra operativa.
* Recovery v2 queda configurado con una API Key local `Irrigation Recovery v2`
  con scope `homey.app`; `/recovery/status` confirma
  `canRestartController=true`.
* Tras la instalacion formal, los servicios `scheduler`, `health`,
  `statusSync`, `history`, `recovery` y `engine` quedan en `ACTIVE_COMPAT`.
  El motor queda `IDLE`, sector activo `0`, `preflightBlock=null` y proximo
  riego `2026-08-13`.
* Leccion operativa: no volver a liberar Rama 2 con `homey app install` directo
  salvo emergencia. El procedimiento obligatorio es subir version, construir
  artefacto `homey-irrigation-app-v2-<version>.tgz`, instalar ese artefacto
  exacto y registrar manifest/checksums. Las llamadas a `/migration/control`
  deben ejecutarse secuencialmente.

## Actualización 2026-07-26

* Incidencia nocturna diagnosticada: el riego programado del 2026-07-25 arranco
  S1 a las 23:50:29 y finalizo a las 23:55:29 con motivo `watchdog`, antes del
  fin previsto de las 23:56:29. Al no ser una parada por `timeout`, el motor
  nativo limpio la cola por seguridad y no ejecuto S2-S6.
* Se mantiene la politica de seguridad del motor: una parada `watchdog` aborta
  el programa completo y no continua con la siguiente electrovalvula.
* Se detecta y corrige una desviacion de Rama 2: `MotorConfirmationStore`
  seguia confirmando solicitudes del Scheduler contra Variables Logic legacy.
  En `engine=ACTIVE_COMPAT` debe confirmar contra `appStateV2.engine`, que es
  la fuente activa del motor nativo.
* La correccion conserva compatibilidad con `engine=SHADOW`, donde la lectura
  legacy sigue siendo la fuente correcta.
* Se implementa la mejora diagnostica pendiente: el motor nativo persiste en
  `appStateV2.engine.tickDiagnostics` un anillo compacto de los ultimos ticks
  con decision, reles observados, cola restante, `rawAvailable`, `rawError` y
  resultado de ejecucion. `/engine/status` expone estos datos en
  `diagnostics.lastTicks`.
* Mejora operativa de notificaciones: el Flow activo
  `Riego - Aviso de incidencia hardware v2`
  (`b902c1a4-a148-476e-9478-29704db9c3e4`) envia ahora
  `Incidencia en sistema de riego: [[message]]`, usando el detalle emitido por
  la Flow Card nativa `health_transition`.
* Incidencia del 2026-07-26: el programa diario arranco S1 a las 22:00:05 y lo
  cerro a las 22:06:05 por `timeout`, pero S2-S6 no llegaron a ejecutarse. El
  estado persistido confirma historico solo de S1, cola final vacia y
  `lastRunDate=2026-07-26`. No queda el tick exacto de las 22:06 porque la
  retencion anterior de diagnostico cubria solo unos 20 minutos.
* Correccion aplicada en Rama 2: `IrrigationEngineService` recibe ahora las
  Flow Cards nativas `sector_started` y `sector_ended` desde `app.js`, de forma
  que los eventos de sector persistidos en `appStateV2.engine.lastSectorEvent`
  tambien disparan los Flows de notificacion v2.
* Robustez de cola: si el motor queda en `IDLE` con cola pendiente y todos los
  reles apagados, el siguiente tick nativo reanuda el programa con
  `START_PENDING_QUEUE` en lugar de limpiar la cola mediante `forceIdle`.
  Esto cubre estados transitorios entre sectores y reinicios/interrupciones
  despues de cerrar un sector por `timeout`.
* Diagnostico ampliado: `tickDiagnostics` retiene 240 ticks y
  `actionDiagnostics` conserva acciones relevantes del motor para auditar
  `programStart`, `startNextQueuedItem`, paradas y fallos aunque el sistema se
  revise mas tarde.
* Se ajusta Health v2 para no generar falsas alarmas moviles: las transiciones
  a `OK` y los estados `WARNING` se persisten/proyectan, pero no disparan la
  Flow Card `health_transition`. El Flow de aviso de incidencia queda reservado
  a `ERROR` y `OFFLINE`.
* Se descartan como incidencias los warnings tecnicos de ESPHome originados en
  `api`, `web_server` o `httpd` con mensajes de conexion/HTTP no accionables.

## Actualización 2026-07-27

* Incidencia repetida diagnosticada con la nueva telemetria persistente: el
  programa del 2026-07-27 arranco S1 a las 22:00:27 y lo cerro a las 22:06:27
  por `timeout`, pero no ejecuto S2-S6.
* `actionDiagnostics` confirma que `programStart` genero correctamente una cola
  S1-S6 y dejo como `remainingQueue` S2-S6.
* `tickDiagnostics` confirma que un tick programado entro practicamente al
  mismo tiempo con snapshot anterior `IDLE + queue=[]`, ejecuto `forceIdle` y
  limpio la cola mientras el arranque estaba en curso. Los ticks posteriores ya
  vieron S1 `RUNNING`, pero con `queueLength=0`.
* Correccion aplicada: `IrrigationEngineService` incorpora exclusion mutua para
  entradas activas del motor. Las acciones explicitas esperan a que termine la
  operacion previa y el tick se salta si hay otra operacion en curso.
* Se añade prueba de regresion para evitar que `tick` pueda vaciar la cola
  durante `programStart`.

La Rama 2 no es un evolutivo menor de la Rama 1. Es una generacion distinta
basada en una app Homey nativa completa. La Rama 1 queda congelada como la
generacion publicada y validada basada en HomeyScripts, Variables Logic, Flows
tecnicos y dispositivos virtuales.

El objetivo de la Rama 2 no es modificar directamente la Rama 1 en produccion,
sino construir una nueva generacion con separacion clara de codigo, artefactos,
binarios y documentacion. La Rama 1 debe permanecer recuperable como linea
estable mientras la Rama 2 se desarrolla y valida.

## Generaciones

| Generacion | Descripcion | Estado | Politica |
| --- | --- | --- | --- |
| Rama 1 | Sistema actual publicado: ESPHome + HomeyScripts + app de programador | Estable/congelada | Solo correcciones criticas |
| Rama 2 | App Homey nativa completa con servicios internos | En diseno | Desarrollo separado |

### Rama 1

La Rama 1 incluye:

* firmware ESPHome estable;
* `Irrigation.js` como motor;
* `IrrigationStatus.js`;
* `IrrigationHistory.js`;
* `IrrigationHealth.js`;
* `RecoveryService` ya migrado a la app como excepcion incorporada antes de
  abrir formalmente Rama 2;
* app Homey nativa del programador;
* Flows tecnicos existentes;
* Variables Logic como fuente de verdad operativa.

La Rama 1 debe poder reconstruirse desde sus artefactos versionados y su
documentacion de release.

### Rama 2

La Rama 2 tendra como objetivo:

* app Homey nativa como propietario principal del sistema;
* servicios internos para motor, scheduler, status, health, recovery e
  historico;
* devices propios de la app;
* Flow Cards propias;
* Variables Logic como proyeccion publica y compatibilidad, no como bus interno
  ni fuente de verdad de Rama 2;
* separacion de artefactos frente a Rama 1.

## Politica de versionado y artefactos

La Rama 2 debe identificarse de forma explicita en codigo, binarios y
documentacion.

Reglas:

1. Los artefactos de Rama 1 y Rama 2 no deben compartir nombre final.
2. Las releases de Rama 2 deben usar version mayor `2.x`.
3. Los contratos de Rama 2 deben usar contratos `irrigation-*-api@2.x` cuando
   exista cambio incompatible.
4. Si se permite instalacion paralela durante desarrollo, la app de Rama 2
   debe usar un identificador distinto, por ejemplo
   `com.dadecal.irrigation.v2`, hasta decidir la estrategia final de cutover.
5. Los binarios ESPHome solo cambian de rama si cambia su contrato hardware. Si
   el firmware de Rama 1 sigue siendo compatible, Rama 2 puede requerir
   `irrigation-hw-api@1.x` temporalmente.
6. Toda herramienta de release debe indicar la generacion del artefacto.
7. La documentacion de Rama 2 no debe sobrescribir la documentacion operacional
   de Rama 1 sin marcar claramente la generacion a la que aplica.
8. Toda release liberada es de sistema: debe incluir o referenciar tanto el
   artefacto Homey como el binario ESP32 compatible, aunque solo haya cambiado
   uno de los dos.
9. Toda release liberada debe subirse a GitHub como parte del cierre: codigo,
   herramientas, documentacion y entregables de `dist/releases/<version>` deben
   quedar publicados en `origin/main`.
10. Toda release liberada debe existir tambien como GitHub Release publicada:
    tag `vX.Y.Z`, assets adjuntos desde `dist/releases/<version>` y verificacion
    posterior con `gh release list` y `git fetch --tags`.
11. Toda GitHub Release nueva debe incluir notas de cambio legibles: resumen,
    componentes afectados, validacion ejecutada y observaciones operativas si
    aplican. No basta con adjuntar assets.

Nombres recomendados de artefactos:

```text
Rama 1:
  homey-irrigation-app-1.x.x.tgz
  homey-scripts-1.x.x.zip
  riego-esp32-1.x.x.ota.bin

Rama 2:
  homey-irrigation-app-v2-2.x.x.tgz
  riego-esp32-v2-2.x.x.ota.bin
```

La existencia de `homey-scripts` en Rama 2 debe ser temporal. El objetivo final
de Rama 2 es no depender de HomeyScripts.

## Principios

1. ESPHome sigue siendo exclusivamente hardware.
2. Solo un componente puede ser propietario activo de cada responsabilidad.
3. `Irrigation.js` no se migra hasta que los servicios perifericos esten
   estabilizados en la app.
4. Las Variables Logic se mantienen como contrato publico y observabilidad
   durante la migracion, pero Rama 2 usara almacenamiento interno propio como
   fuente de verdad.
5. Cada fase debe dejar el sistema en estado operativo, probado y documentado.
6. No debe existir doble ejecucion entre script y servicio nativo.
7. Rama 1 y Rama 2 no deben compartir artefactos ni despliegues ambiguos.

## Arquitectura objetivo

```text
ESPHome / ESP32
  Hardware:
  - reles
  - sensores de caudal
  - sensores ambientales
  - protecciones locales

Homey App nativa
  Servicios:
  - IrrigationEngine
  - SchedulerService
  - StatusSyncService
  - HealthService
  - RecoveryService
  - HistoryService

  Infraestructura:
  - HomeyApiClient
  - LogicVariableStore
  - EspHomeDeviceClient
  - EventPublisher
  - App storage / ManagerSettings

  Superficie Homey:
  - devices nativos de la app
  - settings GUI
  - API interna
  - Flow Cards propias
  - proyecciones a Variables Logic
```

## Estado actual de responsabilidades

| Responsabilidad | Propietario actual | Propietario objetivo | Estado |
| --- | --- | --- | --- |
| Hardware fisico | ESPHome | ESPHome | Cerrado |
| Motor y cola | `Irrigation.js` | App nativa, fase final | No iniciado |
| Scheduler Rama 1 | App nativa Rama 1 | App nativa Rama 1 | Desactivado |
| Scheduler Rama 2 | App nativa v2 | App nativa v2 | Activo ACTIVE_COMPAT |
| Recovery ESPHome Controller | App nativa v2 | App nativa v2 | Activo ACTIVE_COMPAT |
| Health | App nativa v2 | App nativa | Activo ACTIVE_COMPAT |
| Status sync | `IrrigationStatus.js` | App nativa | Shadow |
| Historico | App nativa v2 | App nativa | Activo ACTIVE_COMPAT |
| UI programador | App nativa | App nativa | Migrado |
| App Rama 2 | `homey/app-v2` | App nativa v2 | Activa compatibilidad |
| UI motor/manual | dispositivos virtuales | devices app | Sistema nativo emparejado y validado |
| Notificaciones | Flow Cards app + compatibilidad | Flow v2 Health activo |

## Papel de Variables Logic

Decision 2026-07-18: Rama 2 no usara Variables Logic como fuente de verdad ni
como bus interno. El probe `/diagnostics/logic-write-probe` confirma que la app
nativa no puede escribir Variables Logic desde dentro de Homey con el token
interno disponible (`403 Missing Scopes`). Por tanto, Rama 2 usara
almacenamiento interno propio (`appStateV2`, ManagerSettings/storage de app)
para estado persistente, y Variables Logic quedaran como contrato publico de
compatibilidad mientras conviva con Rama 1.

Evolucion prevista:

1. Fase actual: Rama 1 mantiene Variables Logic como fuente de verdad; Rama 2
   las lee para comparar en sombra.
2. Fases intermedias: Rama 2 persiste su estado en `appStateV2` y proyecta a
   devices/Flow Cards propios; Logic solo se usa como compatibilidad cuando sea
   posible o necesario.
3. Fase final: Variables Logic dejan de ser bus interno y pueden retirarse o
   mantenerse solo como observabilidad externa.

Estado 2026-07-25: `appStateV2.engine` ya existe como almacenamiento interno
del motor nativo. Contiene estado, sector activo, timestamps, origen, motivo de
parada, cola, historico propio, ultimo tick y ultimos eventos tecnicos. El
`EnginePlanExecutor` soporta `stateBackend=appState` para aplicar pasos de
estado, cola, historico y eventos sin escribir Variables Logic. El backend
activo de produccion no se cambia todavia y `engine=ACTIVE_COMPAT` sigue
bloqueado hasta migrar los lectores del motor y validar el cutover completo.

Variables que deben conservar compatibilidad:

* `Irrigation.State`
* `Irrigation.Queue`
* `Irrigation.History`
* `Irrigation.Health`
* `Irrigation.HealthEventMessage`
* `Irrigation.HealthTrigger`
* `Irrigation.Recovery`
* `Irrigation.RecoveryMessage`
* `Irrigation.RecoveryTrigger`
* `Irrigation.SectorStartMessage`
* `Irrigation.SectorStartTrigger`
* `Irrigation.SectorEndMessage`
* `Irrigation.SectorEndTrigger`

## Fases Rama 2

### Fase 0 - Arquitectura objetivo, generacion y contrato

Estado: completada.

Objetivo:

* documentar la arquitectura objetivo;
* declarar la separacion Rama 1 / Rama 2;
* fijar las fronteras de responsabilidad;
* decidir el papel de Variables Logic durante la migracion;
* definir orden de desarrollo y criterios de avance;
* fijar politica de versionado y artefactos.

Criterio de salida:

* este documento existe y queda enlazado desde la documentacion principal;
* las fases quedan ordenadas;
* queda explicito que `Irrigation.js` no se migra al principio.
* queda explicito que Rama 2 es una generacion nueva, no un evolutivo menor.

### Fase 1 - Infraestructura base de app

Estado: parcialmente completada.

Ya existe:

* app Rama 2 separada en `homey/app-v2`;
* id propio `com.dadecal.irrigation.v2`;
* version inicial `2.0.0`;
* endpoints seguros `/status`, `/release`, `/config` y `/rain-delay`;
* programador Rama 2 en modo sombra;
* `HomeyApiClient`;
* `LogicVariableStore`;
* Scheduler nativo;
* `RecoveryService` en Rama 1;
* settings/API del programador;
* pruebas unitarias de scheduler y recovery de Rama 1.

Pendiente recomendado:

* crear `EspHomeDeviceClient` para encapsular lectura de dispositivo RAW;
* crear `EventPublisher` para persistir estado, mensaje y trigger en orden;
* evolucionar `AppStateStore` como fuente de verdad interna de Rama 2.

### Fase 1.2 - Storage interno v2 y compatibilidad Logic

Estado: inventario vivo completado.

Objetivo:

* crear una fuente de verdad interna para Rama 2 independiente de Variables
  Logic;
* conservar lectura de Variables Logic solo para sombra, comparacion y
  compatibilidad con Rama 1;
* preparar Health, History y futuros servicios para persistir en `appStateV2`
  antes de intentar nuevos cutovers;
* separar publicacion de eventos nativos de la proyeccion Legacy Logic.

Estado actual:

* existe `AppStateStore` sobre ManagerSettings;
* la clave persistente propia es `appStateV2`;
* el estado inicial contiene `health`, `history` y `events`;
* `HealthService` usa `appStateV2` como fuente activa en `ACTIVE_COMPAT`;
* `HistoryService` usa `appStateV2.history.lastProjectedEventId` como barrera
  activa en `ACTIVE_COMPAT`;
* `LogicVariableStore` queda relegado a compatibilidad/lectura legacy.

Criterio de salida:

* Health persiste su ultimo estado activo en `appStateV2`;
* History usa `appStateV2.history.lastProjectedEventId` como barrera de
  idempotencia;
* los cutovers de Health/History no dependen de escribir Variables Logic;
* las proyecciones legacy quedan claramente marcadas como opcionales.

### Fase 1.5 - Portar funcionalidad actual de la app a Rama 2

Estado: completada y activada en compatibilidad.

Objetivo:

* portar configuracion del programador, duracion de sectores, hora de inicio,
  intervalo y Rain Delay a `homey/app-v2`;
* calcular el proximo riego con la misma logica de Rama 1;
* mantener configuracion propia en `schedulerConfigV2`;
* emitir `program_requested` solo cuando `scheduler=ACTIVE_COMPAT`;
* no modificar `Irrigation.Queue`, `Irrigation.State` ni Variables Logic
  operativas.

Criterio de salida:

* `/status` de Rama 2 devuelve `scheduler.mode = ACTIVE_COMPAT`;
* `canEmitProgramRequests = true`;
* Rama 1 conserva su configuracion pero queda con `enabled=false`;
* el Flow antiguo `Riego programador - solicitud` queda deshabilitado;
* existe el Flow `Riego programador v2 - solicitud`
  (`64919d62-ac08-43cd-b4de-f7472f696336`) conectado a
  `homey:app:com.dadecal.irrigation.v2:program_requested`.

### Fase 2 - Migrar Health

Estado: activo en compatibilidad.

Objetivo:

* sustituir `IrrigationHealth.js` por `HealthService` en la app;
* sustituir el aviso legacy `Irrigation.HealthTrigger` por Flow Card nativa de
  Rama 2;
* desconectar el Flow tecnico que ejecuta `IrrigationHealth.js`.

Riesgo principal:

* duplicar incidencias si conviven script y servicio app.

Estado actual:

* `HealthService` existe en `homey/app-v2` y corre con timer interno;
* expone `/health/status` y `/health/check`;
* lee ESPHome y Variables Logic para calcular `Irrigation.Health`;
* en `SHADOW` no escribe `Irrigation.Health`, `Irrigation.HealthEventMessage`
  ni `Irrigation.HealthTrigger`, y no actualiza capabilities;
* el codigo de `ACTIVE_COMPAT` persiste el ultimo estado en `appStateV2`,
  registra transiciones en `appStateV2.events`, emite el Flow Trigger nativo
  `health_transition` y actualiza solo watchdog y conexion ESPHome del
  dispositivo virtual "Sistema de Riego";
* `ACTIVE_COMPAT` ya no escribe `Irrigation.Health`,
  `Irrigation.HealthEventMessage` ni `Irrigation.HealthTrigger`;
* el cutover se intento en Homey, pero la escritura de Variables Logic desde la
  app devolvio `Missing Scopes`;
* se hizo rollback operativo: `HealthService` vuelve a `SHADOW` y el Flow
  tecnico `Riego - Supervision hardware cada minuto` vuelve a estar activo;
* `activeCompatSupported` vuelve a permitir Health porque la notificacion ya no
  depende de escritura Logic;
* se instalo la version con `health_transition` en Homey;
* se creo el Flow `Riego - Aviso de incidencia hardware v2`
  (`b902c1a4-a148-476e-9478-29704db9c3e4`) basado en
  `homey:app:com.dadecal.irrigation.v2:health_transition`;
* `HealthService` esta activo en `ACTIVE_COMPAT`;
* el Flow tecnico `Riego - Supervision hardware cada minuto`
  (`2f02d7f8-0a4a-44b6-b469-5dffc6622065`) esta deshabilitado;
* el Flow legacy `Riego - Aviso de incidencia hardware` permanece habilitado
  como compatibilidad, pero ya no recibe eventos si `IrrigationHealth.js` no se
  ejecuta.

Criterio de salida:

* `HealthService` corre con timer interno;
* el Flow Trigger nativo `health_transition` esta disponible;
* existe un Flow de notificacion en Homey basado en `health_transition`;
* el Flow `Riego - Supervision hardware cada minuto` ya no ejecuta
  `IrrigationHealth.js` tras activar `HealthService` en `ACTIVE_COMPAT`;
* las notificaciones por `health_transition` siguen funcionando;
* las pruebas de `Testing.md` se cumplen.

### Fase 3 - Migrar Status sync

Estado: activo en compatibilidad.

Objetivo:

* sustituir `IrrigationStatus.js` por `StatusSyncService`;
* proyectar el estado hacia un device nativo de la app;
* mantener compatibilidad temporal con el dispositivo virtual "Sistema de
  Riego" si es necesario.

Criterio de salida:

* no hay escrituras duplicadas en Device Capabilities;
* el estado visible coincide con Variables Logic y ESPHome.

Estado actual:

* `StatusSyncService` existe en `homey/app-v2` y corre con timer interno;
* expone `/status-sync/status` y `/status-sync/check`;
* calcula una proyeccion de temperatura, humedad, temperatura ESP32, fuga y
  conexion ESPHome;
* no escribe Variables Logic;
* `ACTIVE_COMPAT` esta implementado y activado para `StatusSyncService`;
* activar `ACTIVE_COMPAT` requiere escribir explicitamente
  `/migration/control` con `acknowledgeDuplicateWriteRisk=true`;
* el Flow `Riego status - sync 1 min` esta deshabilitado para evitar doble
  escritura;
* durante la validacion se detecta que los dispositivos auxiliares usados por
  `IrrigationStatus.js` para temperatura y humedad ya no existen en Homey. La
  Rama 2 usa como respaldo las capabilities actuales del dispositivo RAW
  `Riego`: `measure_temperature.temperatura` y
  `measure_humidity.humedad_riego`.

Resultado de validacion en Homey:

* RAW disponible;
* CPU, fuga y conexion coinciden con "Sistema de Riego";
* temperatura y humedad no coinciden porque el dispositivo virtual conserva
  valores antiguos, mientras RAW publica lecturas actuales.
* readiness reconoce `statusSync` en `ACTIVE_COMPAT`, sin diferencias
  pendientes y sin permitir aun desactivar todos los Flows tecnicos.
* valores verificados en "Sistema de Riego" tras el cutover:
  temperatura `33.3`, humedad `57.5`, temperatura ESP32 `85.6`, fuga
  `No detectada`, ESPHome `Conectado`.

### Fase 4 - Migrar Historico

Estado: activo en compatibilidad.

Objetivo:

* sustituir `IrrigationHistory.js` por `HistoryService`;
* mantener `Irrigation.History` como entrada legacy mientras el motor siga
  siendo `Irrigation.js`;
* proyectar resumen historico en device nativo de la app.

Criterio de salida:

* no hay reprocesado de eventos;
* no hay duplicados;
* el historico existente se conserva.

Estado actual:

* `HistoryService` existe en `homey/app-v2` y corre con timer interno;
* expone `/history/status` y `/history/check`;
* lee `Irrigation.History` e `Irrigation.HistoryLastProjectedId` como
  compatibilidad legacy;
* calcula la proyeccion del ultimo evento persistido;
* el codigo de `ACTIVE_COMPAT` esta implementado para `HistoryService` sin
  escrituras Logic;
* en `ACTIVE_COMPAT`, la app proyecta capabilities del dispositivo virtual
  "Historico de Riego" y persiste
  `appStateV2.history.lastProjectedEventId` al final, manteniendo
  idempotencia;
* si `appStateV2` aun no tiene barrera pero `Irrigation.HistoryLastProjectedId`
  coincide con el ultimo evento, el servicio inicializa la barrera interna sin
  reprocesar acumulados;
* tras detectar que la app nativa no puede escribir Variables Logic
  (`Missing Scopes`), se hizo rollback operativo anterior para evitar
  reprocesados; esa limitacion ya no bloquea el nuevo diseño con `appStateV2`;
* `HistoryService` esta activo en `ACTIVE_COMPAT`;
* el Flow `Riego History` esta deshabilitado;
* los Flows `Riego history - sync 1 min` y `Riego history - on OFF` permanecen
  deshabilitados, igual que antes del cutover;
* `activeCompatSupported` vuelve a permitir History porque la idempotencia ya
  no depende de escritura Logic.

Resultado de validacion en Homey:

* ultimo evento persistido durante la validacion anterior:
  `1784323620114-6`, sector 6, origen `SCHEDULER`,
  motivo `timeout`;
* `Irrigation.HistoryLastProjectedId` coincide con el ultimo evento;
* `HistoryService` devuelve `READY`, `alreadyProjected=true` y
  `wouldProject=false`;
* la proyeccion sombra coincide con el dispositivo virtual "Historico de
  Riego".
* readiness reconoce `history` como servicio con `ACTIVE_COMPAT` soportado;
* acumulados verificados tras el cutover: contador `90`, duracion acumulada
  `1507`, litros acumulados `0`, sin reprocesado del ultimo evento.

### Fase 4.5 - Migrar Recovery ESPHome Controller

Estado: activo en compatibilidad.

Objetivo:

* portar `RecoveryService` desde la app de Rama 1 a `homey/app-v2`;
* mantener la responsabilidad exclusiva de recuperar ESPHome Controller;
* no controlar reles, motor ni cola;
* persistir el estado activo en `appStateV2.recovery`;
* sustituir el aviso legacy `Irrigation.RecoveryTrigger` por la Flow Card
  nativa `recovery_event`.

Riesgo principal:

* doble reinicio automatico de ESPHome Controller si conviven activos
  `RecoveryService` de Rama 1 y Rama 2.

Estado actual:

* `RecoveryService` existe en `homey/app-v2` y corre con timer interno;
* expone `/recovery/status` y `/recovery/check`;
* en `SHADOW` observa disponibilidad del dispositivo `Riego`, calcula umbrales
  y devuelve `WOULD_RESTART` cuando procederia reiniciar, pero no persiste ni
  llama a `restartApp`;
* en `ACTIVE_COMPAT` persiste incidentes en `appStateV2.recovery`,
  aplicar cooldown, limitar intentos y reiniciar ESPHome Controller;
* `MigrationControlStore` incluye `recovery` como servicio migrable;
* `MigrationReadinessService` incluye Recovery en el precheck;
* existe la Flow Card nativa `recovery_event` para notificaciones v2;
* existe el Flow `Riego - Aviso autorrecuperacion ESPHome v2`
  (`20cfcfe6-0802-4d42-aca4-9a127f9ccdd4`) basado en `recovery_event`;
* la app Rama 1 `com.dadecal.irrigation` esta desactivada para evitar doble
  autorrecuperacion;
* `recovery` esta en `ACTIVE_COMPAT`.

Criterio de salida:

* app v2 desplegada con Recovery en `ACTIVE_COMPAT`;
* `/recovery/status` confirma `restartSupported=true`,
  `canRestartController=true` y dispositivo RAW disponible;
* `/recovery/check` devuelve `AVAILABLE` sin incidente activo;
* la app Rama 1 queda desactivada para evitar doble recuperacion;
* existe Flow de notificacion basado en `recovery_event`;
* queda pendiente validar fisicamente cooldown, agotamiento y recuperacion
  durante una incidencia controlada.

### Fase 5 - Reducir Flows tecnicos

Estado: preparada con precheck.

Objetivo:

* sustituir Flows tecnicos por timers/Flow Cards propias de la app;
* mantener solo Flows de usuario o notificacion cuando aporten valor.

Flows candidatos:

* tick del motor;
* sync status;
* history trigger;
* supervision hardware.

Esta fase no debe retirar el tick del motor hasta que el motor se migre o haya
un mecanismo equivalente validado.

Estado actual:

* Rama 2 incorpora `MigrationControlStore` y `MigrationReadinessService`;
* expone `/migration/readiness` y `/migration/readiness/check`;
* el precheck ejecuta scheduler, health, status sync, historico y recovery en
  sombra y devuelve un semaforo de cutover;
* `safeToDisableTechnicalFlows` permanece `false` mientras el tick del motor
  siga siendo un Flow tecnico y el motor siga en `Irrigation.js`;
* ya se han deshabilitado los Flows tecnicos de StatusSync e Historico tras
  activar sus servicios en `ACTIVE_COMPAT`.

Resultado de validacion en Homey:

* Health listo para comparar y coincidente con `Irrigation.Health`;
* StatusSync con RAW disponible y diferencias pendientes conocidas en
  temperatura/humedad del dispositivo virtual;
* History listo, ultimo evento ya proyectado;
* Scheduler ya no bloquea readiness: Rama 2 emite solicitudes en
  `ACTIVE_COMPAT`;
* el precheck bloquea correctamente la reduccion de Flows tecnicos con
  `safeToDisableTechnicalFlows=false`.

Siguiente subfase recomendada:

* ejecutar una fase de limpieza y control previa a migrar `Irrigation.js`.

### Fase 5.8 - Limpieza y control previo al motor

Estado: limpieza operativa parcial completada.

Objetivo:

* auditar Flows, dispositivos legacy y dependencias restantes antes de migrar
  el motor;
* evitar desactivar accidentalmente el tick o los Flows que aun necesita
  `Irrigation.js`;
* definir un rollback operativo claro para Rama 2;
* separar lo que puede retirarse ya de lo que debe mantenerse hasta Fase 6.

Principio de seguridad:

* no se deshabilita ningun Flow adicional sin inventario previo;
* no se elimina ningun dispositivo legacy en esta fase;
* no se modifica `Irrigation.js`;
* el tick del motor debe permanecer activo mientras el motor siga siendo
  HomeyScript.

Clasificacion prevista:

| Elemento | Accion prevista | Motivo |
| --- | --- | --- |
| `Riego motor - tick 1 min` | Mantener activo | `Irrigation.js` aun depende del tick para watchdog, finalizacion y cola |
| `Riego motor - ON` / `Riego motor - OFF` | Mantener activos | `Riego Manual v2` usa puente legacy hacia estos Flows |
| `Riego programador v2 - solicitud` | Mantener activo | Scheduler v2 entrega solicitudes al motor existente |
| Flows legacy de status/history/health ya sustituidos | Mantener deshabilitados | Evitar doble escritura/proyeccion |
| Flows legacy de notificacion duplicados | Deshabilitar si existe Flow v2 equivalente | Evitar avisos duplicados y dejar Health/Recovery en Flow Cards nativas |
| Dispositivos virtuales legacy | Mantener visibles/rollback | Rama 2 aun convive con `Irrigation.js` |
| Devices nativos v2 | Mantener activos | UI objetivo ya validada |

Criterio de salida:

* inventario de Flows de riego con estado `activo/deshabilitado` documentado;
* inventario de dispositivos legacy y v2 documentado;
* lista de Flows que deben quedar activos hasta Fase 6;
* lista de Flows que pueden quedar deshabilitados de forma segura;
* plan de rollback de Rama 2 a Rama 1/legacy documentado;
* decision explicita sobre si iniciar Fase 6.

Inventario operativo conocido:

| Flow | Estado previsto | Tratamiento antes de Fase 6 |
| --- | --- | --- |
| `Riego motor - tick 1 min` (`f1b7892f-acb7-477a-9565-e728d87abb8d`) | Activo | Critico. Mantener hasta migrar motor o sustituir tick en app |
| `Riego motor - ON` (`789ee46b-77f3-4f6d-86f8-616c6f252020`) | Activo | Mantener. Usado por `Riego Manual v2` via puente legacy |
| `Riego motor - OFF` (`9520036e-8d17-4516-8521-c623df94b16e`) | Activo | Mantener. Usado por `Riego Manual v2` via puente legacy |
| `Riego programador v2 - solicitud` (`64919d62-ac08-43cd-b4de-f7472f696336`) | Activo | Mantener. Entrega `program_requested` v2 a `Irrigation.js` |
| `Riego programador - solicitud` (`e13d0fd1-8ad5-4cef-a210-dd843766e0a8`) | Deshabilitado | Mantener deshabilitado para evitar doble programador |
| `Riego status - sync 1 min` (`0463902d-0c76-4bf3-9ccc-87a65dbd8a1d`) | Deshabilitado | Mantener deshabilitado; sustituido por `StatusSyncService` |
| `Riego History` (`4571a073-1f27-45bd-8317-33a94c6b18fb`) | Deshabilitado | Mantener deshabilitado; sustituido por `HistoryService` |
| `Riego history - sync 1 min` (`741b4200-a29a-4c1b-9c34-8ec819da564d`) | Deshabilitado | Mantener deshabilitado |
| `Riego history - on OFF` (`cd0ea12d-2d55-423d-85a8-44b2327a3876`) | Deshabilitado | Mantener deshabilitado |
| `Riego - Supervision hardware cada minuto` (`2f02d7f8-0a4a-44b6-b469-5dffc6622065`) | Deshabilitado | Mantener deshabilitado; sustituido por `HealthService` |
| `Riego - Aviso de incidencia hardware v2` (`b902c1a4-a148-476e-9478-29704db9c3e4`) | Activo | Mantener. Notificacion nativa de Health |
| `Riego - Aviso autorrecuperacion ESPHome v2` (`20cfcfe6-0802-4d42-aca4-9a127f9ccdd4`) | Activo | Mantener. Notificacion nativa de Recovery |
| `Riego - Aviso inicio de sector` (`42bcc2d5-4947-4467-8c2e-a7956177fe1c`) | Activo | Mantener mientras `Irrigation.js` emita triggers Logic de motor |
| `Riego - Aviso fin de sector` (`efd15da0-4c73-44eb-9c69-7dacbb8365bc`) | Activo | Mantener mientras `Irrigation.js` emita triggers Logic de motor |
| `Riego - Aviso de incidencia hardware` (`bab5b514-4fa7-429d-86a4-fda2d44a0123`) | Deshabilitado | Sustituido por `Riego - Aviso de incidencia hardware v2` |
| `Riego - Aviso autorrecuperacion ESPHome` (`445c484a-6d4f-4f08-8cf6-0372b0f58df7`) | Deshabilitado | Sustituido por `Riego - Aviso autorrecuperacion ESPHome v2` |

Flows prototipo/deshabilitados conocidos:

* `Riego L1 - 5 min (deshabilitado - prototipo)`;
* `Riego motor - control manual (deshabilitado - prototipo)`;
* `Riego motor - heartbeat 1 min (deshabilitado - prototipo)`;
* `Riego motor - toggle (deshabilitado - listener generico)`;
* `Riego motor - apagado (deshabilitado - duplicado antiguo)`.

Estos Flows deben permanecer deshabilitados. La retirada definitiva se aplaza
hasta tener exportacion/rollback y confirmacion en vivo.

Inventario de dispositivos conocido:

| Device | Tipo | Estado en Fase 5.8 | Uso |
| --- | --- | --- | --- |
| `Riego` (`1120df26-8201-49de-b262-8fb98289d811`) | ESPHome RAW | Mantener | Hardware fisico |
| `Riego manual` (`f702f97b-7ba3-4ba2-9a82-426ca94a05f8`) | Virtual legacy | Mantener | Puente manual hacia `Irrigation.js` |
| `Sistema de Riego` (`611125df-85eb-4fa0-bce1-aabbbdabc55e`) | Virtual legacy | Mantener | Proyeccion legacy y triggers de motor |
| `Historico de Riego` (`4e479970-4f59-4bb1-8e4f-8cbfc1ef0bdb`) | Virtual legacy | Mantener temporalmente | Fuente de compatibilidad para History v2 |
| `Sistema de Riego v2` (`9b64ed88-17cd-4dd0-bd0d-484850ad83fd`) | App v2 | Mantener | UI nativa de sistema. Zona `Riego`; icono SVG de driver; indicador `irrigation_state` |
| `Historico de Riego v2` (`793d9117-8709-43f2-a0d8-9938d07ab22e`) | App v2 | Mantener | UI nativa de historico. Zona `Riego`; icono SVG de driver; indicador `irrigation_history_timestamp` |
| `Riego Manual v2` (`8171ea4e-7f63-4597-b53d-0a027a540840`) | App v2 | Mantener | UI nativa manual con puente legacy. Zona `Riego`; icono SVG de driver; quick action `onoff`; indicador `.none` |

Rollback operativo antes de Fase 6:

1. Desactivar temporalmente `com.dadecal.irrigation.v2` si sus servicios
   provocan comportamiento inesperado.
2. Rehabilitar la app Rama 1 `com.dadecal.irrigation` solo si se necesita
   recuperar Recovery legacy.
3. Rehabilitar los Flows legacy sustituidos solo de uno en uno y segun
   responsabilidad:
   `Riego status - sync 1 min`, `Riego History` o
   `Riego - Supervision hardware cada minuto`.
4. Mantener siempre activo `Riego motor - tick 1 min`, salvo que el motor ya
   haya sido migrado y validado.
5. Usar los dispositivos virtuales legacy como interfaz de emergencia si un
   device v2 queda roto o se borra accidentalmente.

Decision ejecutada:

* los Flows legacy de notificacion de Health y Recovery quedan deshabilitados
  en Homey porque ya existen equivalentes nativos v2;
* no se deshabilitan los avisos de inicio/fin de sector porque aun pertenecen
  al contrato vivo de `Irrigation.js`.

Inventario vivo 2026-07-21:

* Homey API vuelve a responder y confirma que la matriz de Flows coincide con
  el estado real.
* Apps relevantes:
  * `com.dadecal.irrigation.v2` habilitada y `running`, version `2.0.0`;
  * `com.dadecal.irrigation` deshabilitada y `stopped`, version `0.1.0`;
  * `com.ugrbnk.esphome` habilitada y `running`, version `1.3.20`;
  * `nl.qluster-it.DeviceCapabilities` habilitada y `running`, version
    `2.16.3`.
* Dispositivos relevantes disponibles:
  * `Riego`;
  * `Riego manual`;
  * `Sistema de Riego`;
  * `Historico de Riego`;
  * `Sistema de Riego v2`;
  * `Historico de Riego v2`;
  * `Riego Manual v2`.
* Flows legacy de notificacion deshabilitados tras confirmar equivalentes v2:
  * `Riego - Aviso de incidencia hardware`;
  * `Riego - Aviso autorrecuperacion ESPHome`.
* Flows de notificacion que siguen activos por depender aun del motor legacy:
  * `Riego - Aviso inicio de sector`;
  * `Riego - Aviso fin de sector`.

### Fase 6 - Migracion controlada del motor a Rama 2

Estado: en progreso. Fases 6.0, 6.1, 6.2 y 6.3 completadas; Fase 6.4A/6.4B
implementadas detras de compuerta y desplegadas en Homey en `SHADOW`. Fase
6.4C no ejecutada: no se ha activado ejecucion real del motor nativo.

Objetivo:

* trasladar la responsabilidad completa de `Irrigation.js` a un servicio nativo
  de la app v2;
* conservar una unica autoridad sobre relés, estado operativo, cola e
  historico;
* eliminar la dependencia de HomeyScript para el tick, arranque manual,
  arranque programado y parada;
* mantener rollback operativo hacia `Irrigation.js` hasta superar una prueba
  fisica completa.

Principio de seguridad:

* no se modifica `Irrigation.js` durante el diseno ni durante el modo sombra;
* no se deshabilita `Riego motor - tick 1 min` hasta que el motor nativo este
  en `ACTIVE_COMPAT` y validado;
* no se deshabilitan `Riego motor - ON` ni `Riego motor - OFF` hasta que
  `Riego Manual v2` pueda llamar al motor nativo directamente;
* no se retiran los avisos de inicio/fin de sector mientras `Irrigation.js`
  siga siendo quien emite `Irrigation.SectorStartTrigger` y
  `Irrigation.SectorEndTrigger`;
* cualquier fallo apagando relés debe mantener el mismo contrato transaccional:
  cola cancelada, estado `ERROR` y sector activo conservado para hacer visible
  una posible salida energizada.

Responsabilidades actuales de `Irrigation.js`:

| Responsabilidad | Detalle actual | Tratamiento en Rama 2 |
| --- | --- | --- |
| Entrada manual | Lee sector/duracion/onoff del device legacy `Riego manual` | `Riego Manual v2` pasara a llamar al motor nativo; el device legacy quedara solo rollback |
| Entrada programada | Recibe JSON `program_requested` via Flow y HomeyScript argument | Scheduler v2 llamara al motor nativo por API interna o metodo de servicio |
| Tick | Flow cada minuto ejecuta `tick` | Timer interno del motor nativo; frecuencia a decidir tras pruebas |
| Cola | `Irrigation.Queue` como JSON en Logic | Durante compatibilidad se mantiene el contrato Logic; objetivo final: estado interno en `appStateV2.engine` con proyeccion legacy opcional |
| Estado motor | `Irrigation.State`, sector, timestamps, source y stopReason | En cutover inicial se mantiene escritura Logic para compatibilidad visual/rollback |
| Hardware | Escribe relés del dispositivo RAW `Riego` | Nuevo `EspHomeIrrigationHardwareAdapter`, unica clase autorizada para relés |
| Historico | Añade entrada a `Irrigation.History` antes de UI | Mantener el mismo evento y orden; HistoryService v2 proyecta despues |
| Eventos sector | Escribe mensaje y trigger Logic de inicio/fin | Fase inicial mantiene triggers Logic; fase posterior podra sustituirlos por Flow Cards nativas |
| UI legacy | Actualiza `Riego manual` y `Sistema de Riego` | Mantener en `ACTIVE_COMPAT`; retirar solo despues de validar devices v2 |
| Recuperacion manual | Accion `recover` tras confirmar hardware apagado | Exponer endpoint/accion nativa equivalente antes de retirar script |

Arquitectura propuesta:

* `IrrigationEngineService`
  * propietario unico del motor en Rama 2;
  * implementa acciones `startManual`, `startProgram`, `stop`, `tick`,
    `recover`, `status`;
  * contiene la maquina de estados `IDLE/RUNNING/ERROR`;
  * no conoce detalles de UI Homey salvo servicios de proyeccion inyectados.
* `EngineStateStore`
  * abstrae estado, cola, historico y eventos;
  * en `SHADOW` solo lee el contrato legacy;
  * en `ACTIVE_COMPAT` escribe el contrato legacy necesario para convivencia;
  * prepara la migracion futura a `appStateV2.engine` como fuente principal.
* `EspHomeIrrigationHardwareAdapter`
  * unica capa de la app autorizada a escribir relés del dispositivo RAW
    `Riego`;
  * lee relés y litros de ciclo;
  * apaga todos los relés antes de activar uno;
  * propaga errores para que el motor pueda pasar a `ERROR`.
* `EngineLegacyProjectionService`
  * actualiza `Riego manual` y `Sistema de Riego` mientras existan como
    compatibilidad;
  * evita escrituras si el valor no cambia;
  * no decide estado ni controla hardware.
* `EngineEventService`
  * emite eventos de inicio/fin de sector;
  * en la primera fase conserva `Irrigation.SectorStartMessage`,
    `Irrigation.SectorStartTrigger`, `Irrigation.SectorEndMessage` e
    `Irrigation.SectorEndTrigger`;
  * en fase posterior puede anadir Flow Cards nativas sin romper los Flows
    existentes.

Modos de migracion:

| Modo | Escritura hardware | Escritura estado/cola | Uso |
| --- | --- | --- | --- |
| `SHADOW` | No | No | Calcula diagnostico e invariantes comparando contra `Irrigation.js` |
| `ACTIVE_COMPAT` | Si | Si, contrato legacy minimo | Sustituye a `Irrigation.js` manteniendo Flows/devices legacy de rollback |
| `NATIVE_ONLY` | Si | Principalmente `appStateV2.engine` | Objetivo futuro, solo tras retirar legacy |

Subfases:

1. Fase 6.0 - Inventario y pruebas de contrato
   * estado: completada para contrato base, sin despliegue operativo;
   * extraida una matriz ejecutable de comportamientos de `Irrigation.js`;
   * creado `lib/engine-contract.js` con reglas puras de validacion de cola,
     solicitudes programadas, calculo de restante, decisiones de tick e
     historico;
   * creadas pruebas unitarias de validacion de arranque, cola manual,
     cola scheduler, timeout, watchdog, stale run e historico;
   * no se modifica `Irrigation.js`, no se instalan cambios en Homey y no se
     controla hardware.
2. Fase 6.1 - Motor nativo en `SHADOW`
   * estado: implementada y verificada en Homey;
   * creado `IrrigationEngineService` sin capacidad de escribir relés,
     Variables Logic ni devices;
   * expuestos `/engine/status` y `/engine/check`;
   * `engine` se anade a `migrationControlV2` siempre en `SHADOW`, con
     `activeCompatSupported=false`;
   * `/engine/check` lee el contrato legacy, relés RAW, cola, timestamps y
     calcula la decision teorica de `tick` usando `engine-contract.js`;
   * `MigrationReadinessService` incluye el motor como servicio observado, pero
     mantiene blocker `ENGINE_ACTIVE_COMPAT_NOT_IMPLEMENTED`.
3. Fase 6.2 - Adaptadores y dry-run transaccional
   * estado: implementada y verificada en Homey;
   * introducidos `EngineStateStore`, `EspHomeIrrigationHardwareAdapter` y
     `EngineLegacyProjectionService` en modo dry-run;
   * `/engine/check` incluye `dryRunTransaction` con pasos ordenados, todos con
     `dryRun=true`;
   * se prueba con mocks el orden critico: relés, historico, trigger,
     persistencia de estado, evento de sector y UI;
   * se prueba que un fallo de apagado planifica estado `ERROR`, cola vaciada y
     sector activo conservado cuando existe un sector activo.
4. Fase 6.3 - Entradas nativas sin cutover
   * estado: implementada y verificada en Homey en modo `SHADOW`;
   * preparar `Riego Manual v2` para poder llamar al motor nativo cuando el
     modo lo permita mediante `/engine/manual-start/preview` y
     `/engine/manual-stop/preview`;
   * preparar `Scheduler` para entregar solicitudes al servicio interno en vez
     de al Flow HomeyScript mediante `/engine/program-start/preview`;
   * mantener activos los Flows legacy durante toda la fase;
   * todas las entradas nativas devuelven una transaccion dry-run y no ejecutan
     relés, no escriben Variables Logic operativas y no actualizan devices.
5. Fase 6.4 - Cutover controlado a `ACTIVE_COMPAT`
   * estado: 6.4A/6.4B implementadas y verificadas en bloqueo; 6.4C pendiente;
   * subfase 6.4A: implementar ejecucion real detras de una compuerta
     `engine=ACTIVE_COMPAT`, manteniendo endpoints/preview en `SHADOW`;
   * subfase 6.4B: redirigir `Riego Manual v2`, `Scheduler` y tick interno al
     motor nativo solo cuando `engine=ACTIVE_COMPAT`;
   * subfase 6.4C: realizar cutover operativo con confirmacion explicita y
     ventana de prueba fisica;
   * deshabilitar Flows legacy de motor solo despues de activar la ruta nativa,
     evitando cualquier periodo con dos motores o con ningun tick;
   * validar arranque manual, parada manual, programa automatico, timeout,
     historico, Health, Recovery y proyeccion v2 antes de considerar estable.
6. Fase 6.5 - Limpieza posterior
   * mantener `Irrigation.js` sin borrar durante un periodo de observacion;
   * decidir si los triggers de inicio/fin de sector pasan a Flow Cards nativas;
   * retirar dependencias legacy solo con rollback documentado.

Cutover operativo previsto:

| Elemento | Antes de Fase 6.4 | Durante `ACTIVE_COMPAT` | Rollback |
| --- | --- | --- | --- |
| `Riego motor - tick 1 min` | Activo | Deshabilitado | Rehabilitar si motor nativo falla |
| `Riego motor - ON/OFF` | Activos | Deshabilitados cuando manual v2 llame nativo | Rehabilitar y volver a puente legacy |
| `Riego programador v2 - solicitud` | Activo | Deshabilitado cuando Scheduler llame nativo | Rehabilitar para devolver solicitudes a `Irrigation.js` |
| `Irrigation.js` remoto | Intacto | Intacto, no ejecutado por Flows | Ejecutar de nuevo mediante Flows |
| Devices legacy | Visibles | Visibles como compatibilidad | Interfaz de emergencia |
| Devices v2 | Activos | Activos | Desactivar app v2 si es necesario |

Inventario real previo a Fase 6.4, consultado en Homey el 2026-07-21:

| Flow/App | ID | Estado | Tratamiento para cutover |
| --- | --- | --- | --- |
| `Riego motor - tick 1 min` | `f1b7892f-acb7-477a-9565-e728d87abb8d` | Activo | Deshabilitar cuando el tick nativo este activo |
| `Riego motor - ON` | `789ee46b-77f3-4f6d-86f8-616c6f252020` | Activo | Deshabilitar cuando manual v2 llame nativo |
| `Riego motor - OFF` | `9520036e-8d17-4516-8521-c623df94b16e` | Activo | Deshabilitar cuando manual v2 llame nativo |
| `Riego programador v2 - solicitud` | `64919d62-ac08-43cd-b4de-f7472f696336` | Activo | Deshabilitar cuando Scheduler llame nativo |
| `Riego - Aviso inicio de sector` | `42bcc2d5-4947-4467-8c2e-a7956177fe1c` | Activo | Mantener mientras el motor emita triggers Logic |
| `Riego - Aviso fin de sector` | `efd15da0-4c73-44eb-9c69-7dacbb8365bc` | Activo | Mantener mientras el motor emita triggers Logic |
| App `com.dadecal.irrigation.v2` | - | Running | App propietaria de Rama 2 |
| App `com.dadecal.irrigation` | - | Stopped | Mantener parada salvo rollback de programador Rama 1 |
| App `com.ugrbnk.esphome` | - | Running | Debe estar disponible |

Criterios de entrada a Fase 6.4:

* `npm test` y `npm run validate` pasan en app v2;
* `/engine/check` en `SHADOW` no reporta diferencias criticas;
* Homey confirma app v2 `running`, ESPHome Controller `running` y RAW `Riego`
  disponible;
* no hay riego activo y todos los relés estan apagados;
* `HealthService` no reporta incidencias `ERROR` activas de ESPHome;
* existe plan de rollback paso a paso validado contra los IDs reales de Flows;
* el usuario confirma una ventana de prueba fisica.

Estado de entrada observado el 2026-07-21:

* app v2 `running`, ESPHome Controller `running`, motor legacy `IDLE`, cola
  `0`, RAW disponible y relés apagados;
* readiness bloqueado por `engine` sin `ACTIVE_COMPAT`, esperado;
* readiness bloqueado tambien por `HEALTH_SHADOW_DIFFERS_FROM_PUBLIC_HEALTH`
  debido a evento ESPHome `Line 2 exceeded maximum relay-on time; forcing OFF`;
* no ejecutar Fase 6.4C hasta que la salud vuelva a `OK` o el evento expire y
  quede verificado que no hay relé energizado ni riego activo.

Plan de implementacion de Fase 6.4A/6.4B:

1. Crear ejecutores reales para los planes existentes:
   * `EngineStateStore` debe poder escribir estado, cola, historico y eventos;
   * `EspHomeIrrigationHardwareAdapter` debe poder escribir relés RAW y
     propagar errores;
   * `EngineLegacyProjectionService` debe poder actualizar devices legacy de
     compatibilidad.
2. Mantener el orden transaccional ya probado en dry-run:
   * parada: relés primero, historico, triggers, estado, UI;
   * arranque: cola, apagado general, relé de sector, estado, evento, UI;
   * fallo apagando relés: cola cancelada, estado `ERROR`, sector activo
     conservado.
3. Añadir acciones reales en `IrrigationEngineService`:
   * `startManual`, `startProgram`, `stop`, `tick`, `recover`;
   * cada accion debe rechazar ejecucion si `engine` no esta en
     `ACTIVE_COMPAT`;
   * conservar endpoints `/preview` como diagnostico sin escrituras.
4. Añadir timer interno de tick:
   * iniciar solo en `ACTIVE_COMPAT`;
   * frecuencia inicial 30 segundos o 60 segundos, documentando impacto sobre
     duracion real;
   * evitar ejecuciones concurrentes.
5. Redirigir entradas:
   * `ManualDeviceService` usara motor nativo cuando `engine=ACTIVE_COMPAT` y
     seguira usando puente legacy cuando `engine=SHADOW`;
   * `Scheduler` usara motor nativo cuando `engine=ACTIVE_COMPAT` y seguira
     emitiendo `program_requested` mientras el motor este en `SHADOW`.
6. Actualizar readiness:
   * `engine.activeCompatSupported=true` solo cuando las acciones reales,
     tests, rollback y blockers de salud esten implementados;
   * `safeToDisableTechnicalFlows=true` solo si todos los servicios activos
     estan listos y no quedan blockers criticos.

Resultado Fase 6.4A/6.4B:

* creado `lib/engine-plan-executor.js` para ejecutar planes del motor contra
  relés RAW, Variables Logic operativas, historico, triggers y devices legacy;
* los constructores de planes usan ahora el `dryRun` real de sus adaptadores,
  de modo que las mismas reglas sirven para diagnostico (`dryRun=true`) y para
  ejecucion activa (`dryRun=false`);
* `IrrigationEngineService` implementa acciones reales `startManual`,
  `startProgram`, `stopManual`, `tick` y `recover`, todas protegidas por
  `engine=ACTIVE_COMPAT`;
* el tick nativo queda instalado como timer interno, pero solo actua si
  `engine=ACTIVE_COMPAT`; en `SHADOW` no controla hardware ni escribe estado;
* `ManualDeviceService` redirige START/STOP al motor nativo solo si
  `engine=ACTIVE_COMPAT`; en `SHADOW` mantiene el puente legacy;
* `Scheduler` entrega solicitudes al motor nativo solo si `engine=ACTIVE_COMPAT`;
  en `SHADOW` mantiene el Flow `program_requested` hacia `Irrigation.js`;
* se exponen endpoints reales protegidos: `/engine/manual-start`,
  `/engine/program-start`, `/engine/manual-stop`, `/engine/tick` y
  `/engine/recover`;
* `MigrationControlStore` mantiene `engine=ACTIVE_COMPAT` bloqueado y
  `activeCompatSupported=false`; esta fase prepara el codigo, no habilita el
  cutover;
* en Homey real, llamar `/engine/manual-start` con `engine=SHADOW` devuelve
  error de compuerta y no modifica relés, cola ni estado;
* `/engine/status` sigue mostrando `mode=SHADOW`, `controlsHardware=false`,
  `writesOperationalVariables=false` y `activeCompatSupported=false`;
* `/engine/check` tras instalar confirma motor `IDLE`, cola `0`, relés apagados
  e `issues=[]`.

Resultado Fase 6.4 - compuerta inteligente:

* `MigrationReadinessService` calcula `engineActivation` con `allowed` y
  blockers especificos antes de permitir el cutover del motor;
* el precheck bloquea activacion si Scheduler no esta activo, si Health no esta
  listo o contiene incidencias `ERROR`, si Recovery/RAW no estan disponibles,
  si el motor no esta `IDLE`, si `activeSector` no es `0`, si la cola no esta
  vacia, si hay relés activos o si existen incidencias de invariantes del
  motor;
* `MigrationControlStore` acepta `engine=ACTIVE_COMPAT` solo si recibe un
  `engineActivationPrecheck.allowed=true` desde la API y se mantiene el
  `acknowledgeDuplicateWriteRisk=true`;
* `safeToDisableTechnicalFlows` permanece `false` aunque
  `readyToActivateEngine=true`; los Flows se deshabilitan solo dentro del
  runbook 6.4C;
* pruebas locales: `npm test` pasa con 103 tests OK y `npm run validate` OK;
* estado Homey observado antes del intento fisico del 2026-07-25: Health
  limpio, motor `IDLE`, cola `0`, relés apagados y
  `engineActivation.allowed=true`;
* intento fisico de Fase 6.4C abortado antes de deshabilitar Flows legacy:
  tras activar temporalmente `engine=ACTIVE_COMPAT`, el tick nativo registro
  `Missing Scopes`, coherente con la limitacion ya conocida de escritura de
  Variables Logic desde la app;
* rollback ejecutado inmediatamente: `engine=SHADOW`, Flows legacy de motor
  activos, motor `IDLE`, cola `0`, relés apagados y sin riego fisico iniciado;
* tras el intento fallido, el readiness debe volver a bloquear
  `engine=ACTIVE_COMPAT` con `ENGINE_ACTIVE_COMPAT_NOT_IMPLEMENTED` hasta que
  el motor nativo deje de depender de escrituras Logic o exista una capacidad
  Homey validada para escribirlas;
* `engine` permanece en `SHADOW`, `activeCompatSupported=false`,
  `controlsHardware=false`, `writesOperationalVariables=false` y
  `activeTickEnabled=false`;
* llamada real a `/engine/manual-start` sigue bloqueada por compuerta mientras
  `engine=SHADOW`.

Runbook de Fase 6.4C:

1. Confirmar con Homey:
   * app v2 `running`;
   * ESPHome Controller `running`;
   * RAW `Riego` disponible;
   * motor `IDLE`, cola `0`, relés apagados;
   * Health `OK` o sin incidencias criticas activas.
2. Confirmar que `/migration/readiness/check` devuelve
   `engineActivation.allowed=true` sin blockers de escritura Logic ni de
   soporte `ACTIVE_COMPAT`.
3. Activar `engine=ACTIVE_COMPAT` con confirmacion explicita.
4. Verificar `/engine/status`:
   * `controlsHardware=true`;
   * `writesOperationalVariables=false`;
   * `writesInternalState=true`;
   * `activeCompatSupported=true`.
5. Deshabilitar Flows legacy en este orden operativo:
   * `Riego motor - ON`;
   * `Riego motor - OFF`;
   * `Riego programador v2 - solicitud`;
   * `Riego motor - tick 1 min`.
6. Ejecutar prueba fisica corta:
   * arranque manual de un sector de bajo riesgo;
   * parada manual;
   * comprobar relés apagados;
   * comprobar historico, devices v2, devices legacy y Health.
7. Ejecutar prueba de timeout con duracion corta.
8. Dejar scheduler activo solo si la prueba manual y timeout son correctas.

Rollback de Fase 6.4C:

1. Poner `engine=SHADOW`.
2. Rehabilitar, en este orden:
   * `Riego motor - tick 1 min`;
   * `Riego motor - ON`;
   * `Riego motor - OFF`;
   * `Riego programador v2 - solicitud`.
3. Ejecutar `/engine/check` y confirmar relés apagados o estado visible
   `ERROR` si no se pudieron apagar.
4. Usar `Riego manual` legacy como interfaz de emergencia.
5. Mantener `Irrigation.js` intacto como artefacto Rama 1.

Resultado Fase 6.4D - base appState del motor:

* `appStateV2.engine` se añade al estado interno normalizado de Rama 2;
* `AppStateStore` expone operaciones para estado, cola, historico, ultimo tick
  y eventos tecnicos del motor nativo;
* `EnginePlanExecutor` permite `stateBackend=appState`, que aplica pasos
  `EngineStateStore` sin escribir Variables Logic;
* el backend por defecto sigue siendo `logic` para no cambiar operacion real;
* pruebas locales: `npm test` pasa con 106 tests OK y `npm run validate` OK;
* `Irrigation.js` permanece intacto;
* siguiente paso: hacer que `IrrigationEngineService`, Health, Recovery,
  SystemDevice y History lean `appStateV2.engine` cuando el motor nativo este
  activo, manteniendo Logic como lectura legacy en `SHADOW`.

Resultado Fase 6.4E - motor lee/escribe appState en modo activo:

* `IrrigationEngineService` recibe `appStateStore`;
* en `SHADOW`, el motor sigue leyendo Variables Logic como fuente legacy de
  comparacion;
* en `ACTIVE_COMPAT`, el snapshot operativo del motor se lee desde
  `appStateV2.engine`;
* las acciones reales del motor usan `EnginePlanExecutor` con
  `stateBackend=appState`, por lo que estado, cola, historico, ultimo tick y
  eventos tecnicos se persisten sin escribir Variables Logic;
* `activeCompatSupported` se mantiene `false` de forma deliberada hasta migrar
  Health, Recovery, SystemDevice y History a la fuente activa correcta;
* pruebas locales: `npm test` pasa con 108 tests OK y `npm run validate` OK;
* `Irrigation.js` permanece intacto.

Resultado Fase 6.4F - lectores del motor con fuente activa:

* se añade `engine-state-source.js` como helper comun para leer estado, cola,
  ultimo tick e historico del motor;
* mientras `migrationControlV2.services.engine=SHADOW`, Health, Recovery,
  SystemDevice e History siguen leyendo Variables Logic para mantener la
  operacion actual de Rama 1/Rama 2;
* cuando `engine=ACTIVE_COMPAT`, esos servicios leen `appStateV2.engine` como
  fuente primaria del motor;
* `SystemDeviceProjectionService` recibe `controlStore` para elegir la fuente
  de motor con la misma compuerta que los demas servicios;
* `HealthService` expone `telemetry.engineStateSource` para diagnostico;
* `HistoryService` lee el historico nativo desde `appStateV2.engine.history`
  solo cuando el motor nativo este activo;
* `RecoveryService` decide el umbral idle/running usando la fuente activa del
  motor, conservando su responsabilidad exclusiva sobre ESPHome Controller;
* pruebas locales: `npm test` pasa con 110 tests OK y `npm run validate` OK;
* `Irrigation.js` permanece intacto;
* siguiente paso: actualizar `IrrigationEngineService`/readiness para declarar
  `activeCompatSupported=true` solo cuando esta cadena completa este validada
  y preparar una nueva prueba fisica controlada.

Resultado Fase 6.4G - soporte activo del motor habilitado tras precheck:

* `IrrigationEngineService` declara `activeCompatSupported=true` cuando dispone
  de `AppStateStore`, porque el backend activo ya persiste en
  `appStateV2.engine` y no en Variables Logic;
* `/engine/check` calcula `readyForCutover` y un `blocker` operativo concreto
  a partir de RAW disponible, motor `IDLE`, cola vacia, relés apagados e
  invariantes del snapshot;
* las acciones reales del motor activo declaran
  `writesOperationalVariables=false` y `writesInternalState=true`, para
  reflejar que ya no escriben Variables Logic operativas;
* `MigrationControlStore` mantiene `activeCompatSupported.engine=true` tambien
  tras rollback a `SHADOW`; volver a sombra cambia el propietario operativo,
  no desinstala la implementacion;
* `MigrationReadinessService` deja de bloquear por motor no implementado si el
  check del motor declara soporte activo, pero mantiene el bloqueo por
  condiciones fisicas u operativas no limpias;
* la activacion real continua exigiendo `PUT /migration/control` con
  `acknowledgeDuplicateWriteRisk=true` y
  `MigrationReadinessService.checkEngineActivation()` sin blockers;
* pruebas locales: `npm test` pasa con 111 tests OK y `npm run validate` OK;
* verificacion en Homey tras reinstalar: `/engine/status` devuelve
  `engine=SHADOW`, `controlsHardware=false`, `writesOperationalVariables=false`
  y `activeCompatSupported=true`;
* `MigrationReadinessService.check()` en Homey real devuelve
  `readyToActivateEngine=true`, `engineActivation.allowed=true` y
  `blockers=[]`, con motor legacy `IDLE`, cola `0`, relés apagados y Health
  `OK`;
* `Irrigation.js` permanece intacto;
* siguiente paso: ejecutar el runbook fisico de Fase 6.4C, empezando por
  deshabilitar los Flows legacy de motor y activar `engine=ACTIVE_COMPAT` con
  confirmacion explicita.

Resultado Fase 6.4C repetida - cutover fisico del motor nativo:

* se deshabilitan los Flows legacy de motor:
  * `Riego motor - ON`;
  * `Riego motor - OFF`;
  * `Riego programador v2 - solicitud`;
  * `Riego motor - tick 1 min`;
* se activa `migrationControlV2.services.engine=ACTIVE_COMPAT`;
* `/engine/status` confirma `controlsHardware=true`,
  `writesOperationalVariables=false`, `writesInternalState=true`,
  `activeTickEnabled=true` y `activeCompatSupported=true`;
* readiness posterior queda sin blockers y los lectores transversales leen el
  motor desde `appStateV2.engine`;
* prueba fisica manual corta: arranque nativo de sector 1 activa solo el relé
  1, parada manual apaga relés, deja cola vacia, motor `IDLE` e historico
  nativo `1784981933726-1`;
* prueba fisica de timeout: arranque nativo de sector 1 durante 1 minuto,
  cierre automatico por tick nativo con motivo `timeout`, relé 1 apagado,
  historico `1784982055901-1`, `durationRealMin=1`;
* `HistoryService` proyecta el historico timeout en devices legacy y v2,
  contador `133` y duracion acumulada `2004`;
* Health posterior queda `OK`, sin incidencias, con
  `engineStateSource=appStateV2.engine`;
* `Irrigation.js` permanece intacto;
* siguiente paso: monitorizar el riego programado de las 22:00 en modo motor
  nativo y mantener rollback documentado disponible durante la ventana de
  estabilizacion.

Resultado Fase 6.4H - avisos de sector nativos:

* se añaden Flow Cards nativas `sector_started` y `sector_ended` a la app v2;
* `EnginePlanExecutor` dispara esas tarjetas solo en backend
  `stateBackend=appState`, despues de persistir
  `appStateV2.engine.lastSectorEvent`;
* los tokens nativos incluyen mensaje, sector, duracion/origen para inicio y
  mensaje, sector, duracion, litros, motivo/origen para fin;
* se crean en Homey los Flows `Riego - Aviso inicio de sector v2`
  (`4e6c61e8-7d10-4a8b-8a6b-162dc0f033e8`) y
  `Riego - Aviso fin de sector v2`
  (`b16e8ad7-9844-4e33-9ccb-b2557fb6e87c`), ambos activos y no rotos;
* ambos Flows usan las condiciones nativas existentes
  `notify_sector_start_enabled` y `notify_sector_end_enabled`;
* se deshabilitan los Flows legacy basados en Variables Logic:
  `Riego - Aviso inicio de sector`
  (`42bcc2d5-4947-4467-8c2e-a7956177fe1c`) y
  `Riego - Aviso fin de sector`
  (`efd15da0-4c73-44eb-9c69-7dacbb8365bc`);
* pruebas locales: `npm test` pasa con 112 tests OK y `npm run validate` OK;
* `Irrigation.js` permanece intacto.

Resultado Fase 6.0:

* `npm test` en `homey/app-v2`: 82 tests OK;
* `npm run validate` en `homey/app-v2`: OK;
* `Irrigation.js` permanece intacto;
* siguiente paso: crear `IrrigationEngineService` en `SHADOW` usando
  `engine-contract.js` como base de comparacion, sin escribir relés ni estado.

Resultado Fase 6.1 local:

* `IrrigationEngineService` implementado en modo sombra;
* `npm test` en `homey/app-v2`: 86 tests OK;
* `npm run validate` en `homey/app-v2`: OK;
* `engine=ACTIVE_COMPAT` queda bloqueado en `MigrationControlStore`;
* no se modifica `Irrigation.js`, no se controla hardware y no se escriben
  Variables Logic operativas.

Resultado Fase 6.1 en Homey:

* app v2 instalada correctamente;
* `/engine/status` devuelve `mode=SHADOW`, `controlsHardware=false`,
  `writesOperationalVariables=false` y `activeCompatSupported=false`;
* `/engine/check` devuelve motor legacy `IDLE`, sector activo `0`, cola `0`,
  RAW disponible, sin relés activos, `tickDecision=FORCE_IDLE_NONE` e
  `issues=[]`;
* `/migration/readiness/check` incluye `engine` observado y comparable, pero
  mantiene blockers esperados `ENGINE_ACTIVE_COMPAT_NOT_IMPLEMENTED` y
  `ACTIVE_COMPAT_NOT_IMPLEMENTED`;
* `safeToDisableTechnicalFlows=false`, por lo que los Flows del motor legacy
  siguen protegidos.

Resultado Fase 6.2:

* `engine-dry-run-adapters.js` implementa adaptadores dry-run para estado,
  hardware y proyeccion legacy;
* `npm test` en `homey/app-v2`: 91 tests OK;
* `npm run validate` en `homey/app-v2`: OK;
* `homey app validate --level publish`: OK;
* app v2 instalada en Homey;
* `/engine/check` en Homey devuelve `dryRunTransaction.type=forceIdle` para el
  estado real actual `IDLE`, con pasos `setAllRelays(false)`, `clearQueue`,
  `setValues(IDLE)`, actualizacion manual y actualizacion sistema, todos con
  `dryRun=true`;
* `issues=[]` y no se modifica `Irrigation.js`.

Resultado Fase 6.3:

* `IrrigationEngineService` expone previsualizaciones nativas para arranque
  manual, arranque programado y parada manual:
  `/engine/manual-start/preview`, `/engine/program-start/preview` y
  `/engine/manual-stop/preview`;
* las previsualizaciones usan el mismo contrato de cola que
  `engine-contract.js` y devuelven `dryRunTransaction` con pasos ordenados;
* `npm test` en `homey/app-v2`: 97 tests OK;
* `npm run validate` en `homey/app-v2`: OK;
* `homey app validate --level publish`: OK;
* app v2 instalada en Homey;
* en Homey real, una previsualizacion manual `S2/3 min` devuelve
  `type=startQueuedItem`, `accepted=true`, relé 2 planificado y todos los
  pasos con `dryRun=true`;
* en Homey real, una previsualizacion scheduler `S1/5 min, S2/6 min` devuelve
  `type=startQueuedItem`, `accepted=true`, primer item S1 y cola restante S2;
* en Homey real, la previsualizacion de parada manual devuelve `type=stop` con
  apagado de relés, limpieza de cola, historico y proyeccion solo planificados;
* `engine` permanece en `SHADOW`, `ACTIVE_COMPAT` sigue bloqueado y
  `Irrigation.js` permanece intacto.

Criterios de salida de Fase 6:

* el motor nativo ejecuta manual y programado sin usar HomeyScript;
* no queda ningun Flow activo que ejecute `Irrigation.js`;
* `Irrigation.js` queda congelado como artefacto Rama 1/rollback;
* historico, dispositivos v2, Health, Recovery e Insights siguen funcionando;
* la parada ante error de hardware conserva la visibilidad de posible relé
  energizado;
* el rollback hacia `Irrigation.js` esta probado o queda documentado como
  ultimo recurso.

Riesgos tecnicos:

* cambiar accidentalmente el orden transaccional de parada y publicar `IDLE`
  cuando no se han podido apagar relés;
* duplicar motores si queda activo algun Flow que ejecute `Irrigation.js`;
* perder confirmacion del Scheduler si se retira demasiado pronto el contrato
  legacy de Variables Logic;
* duplicar historico si la barrera de idempotencia no se migra con cuidado;
* retrasos diferentes al tick de un minuto que cambien duraciones reales e
  Insights;
* errores de permisos Homey API al escribir capabilities o relés desde la app;
* dependencia temporal de devices legacy durante rollback.

### Fase 5.5 - Devices nativos Rama 2

Estado: completada funcionalmente.

Objetivo:

* sustituir gradualmente los dispositivos virtuales de Device Capabilities por
  devices propios de la app v2;
* mantener los devices legacy activos hasta validar que la proyeccion nativa
  cubre los mismos casos;
* no introducir controles de motor hasta la fase del device manual.

Primer device: `Sistema de Riego v2`.

Implementacion:

* driver nativo `irrigation_system`;
* emparejamiento estatico de un unico device;
* capabilities custom de solo lectura para estado, sector activo, tiempo
  restante, cola, origen, programa, mensaje, conexion ESPHome, fuga,
  temperatura, humedad, temperatura ESP32 y salud;
* servicio `SystemDeviceProjectionService` con timer interno cada minuto;
* endpoints `/system-device/status`, `/system-device/check` y
  `/system-device/ensure`;
* pairing declarado explicitamente con vistas `list_devices` y `add_devices`;
* alta idempotente: si el device ya existe no se crea duplicado. Si el device
  no existe, Homey puede requerir pairing manual o PairSession externa por
  scopes.

Fuentes:

* Variables Logic de lectura para estado del motor, sector, cola, origen y
  tiempos;
* dispositivo RAW `Riego` para entorno, fuga y conexion;
* `appStateV2.health` para estado de salud.

Estado actual:

* app v2 instalada en Homey con el driver y las capabilities;
* existe el device nativo `Sistema de Riego v2`
  (`fafc57a1-b4f9-4882-b9e2-6dc170d312c2`);
* `/system-device/check` calcula y aplica la proyeccion sin escribir Variables
  Logic ni motor;
* si el device se borra accidentalmente, se puede volver a crear desde
  "Anadir dispositivo" seleccionando la app `Sistema de Riego v2` o mediante
  PairSession externa; `POST /system-device/ensure` detecta de forma
  idempotente si ya existe;
* el dispositivo virtual legacy "Sistema de Riego" sigue siendo la proyeccion
  visible principal hasta validar el device nativo.

Resultado de validacion en Homey:

* `writesOperationalVariables=false`;
* `pairedDevices=1`;
* RAW disponible;
* motor `IDLE`;
* cola `0`;
* ESPHome `Conectado`;
* fuga `No detectada`;
* salud `WARNING`;
* temperatura `32.1`, humedad `59.7`, temperatura ESP32 `85`;
* capabilities nativas verificadas en Homey: estado `IDLE`, sector `0`,
  tiempo restante `0`, cola `0`, origen `SCHEDULER`.

Segundo device: `Historico de Riego v2`.

Implementacion:

* driver nativo `irrigation_history`;
* emparejamiento estatico de un unico device;
* capabilities custom de solo lectura para ultimo riego, fecha, programa,
  duracion/litros del ultimo riego, acumulados y ultimo riego por sector;
* proyeccion nativa integrada en `HistoryService`, derivada de la misma
  proyeccion usada para el dispositivo virtual legacy;
* endpoints `/history/status`, `/history/check` y `/history-device/ensure`;
* pairing declarado explicitamente con vistas `list_devices` y `add_devices`.

Fuentes:

* `Irrigation.History` como historico persistido producido por `Irrigation.js`;
* dispositivo virtual legacy "Historico de Riego" para copiar los ultimos
  valores por sector y acumulados durante la convivencia;
* `appStateV2.history.lastProjectedEventId` como barrera activa de
  idempotencia.

Estado actual:

* app v2 instalada en Homey con el driver y las capabilities;
* existe el device nativo `Historico de Riego v2`
  (`40413129-f263-433b-adba-69c67bea662c`);
* `/history/check` proyecta el historico legacy y el nativo sin escribir
  Variables Logic ni motor;
* `POST /history-device/ensure` detecta el device existente sin duplicarlo. Si
  el device no existe, la creacion interna puede fallar con `Missing Scopes` y
  debe usarse pairing manual desde Homey o PairSession externa por CLI.

Resultado de validacion en Homey:

* `writesOperationalVariables=false`;
* `pairedNativeDevices=1`;
* ultimo evento `1784582820068-6`, sector 6, origen `SCHEDULER`, motivo
  `timeout`;
* ultimo riego `S6 · 0 L · 15 min · timeout`;
* fecha `20/07/2026, 23:27`;
* contador `108`;
* duracion acumulada `1750`;
* litros acumulados `0`;
* ultimo riego por sectores 1..6 proyectado en el device nativo;
* se corrige la comparacion `null`/`0` para escribir correctamente valores
  numericos cero.

Tercer device: `Riego Manual v2`.

Decision de contrato:

* no se modifica `Irrigation.js` en esta fase;
* `Riego Manual v2` no controla reles, no escribe Variables Logic y no modifica
  directamente motor ni cola;
* el device nativo actua como puente hacia el dispositivo virtual legacy
  `Riego manual`;
* al cambiar sector o duracion en v2 se copian esos valores al legacy;
* al activar/desactivar `onoff` en v2 se escribe `onoff` en el legacy; los
  Flows existentes `Riego motor - ON` y `Riego motor - OFF` siguen lanzando
  `Irrigation.js` con `start` o `stop`;
* para iniciar, el puente escribe primero sector y duracion, y despues
  `onoff=true`, garantizando que el motor lee la configuracion actual.

Implementacion:

* driver nativo `irrigation_manual`;
* emparejamiento estatico de un unico device;
* capabilities custom para sector, duracion, tiempo restante e informacion,
  mas `onoff` nativo;
* servicio `ManualDeviceService` con timer interno cada 30 segundos;
* endpoints `/manual-device/status`, `/manual-device/check` y
  `/manual-device/ensure`;
* pairing declarado con `list_devices` y `add_devices`.

Estado actual:

* app v2 instalada en Homey con el driver y las capabilities;
* existe el device nativo `Riego Manual v2`
  (`b0121276-44e0-4d4f-9214-982084c83e17`);
* la prueba no fisica confirma que cambiar sector `2` y duracion `3` en v2 se
  replica al dispositivo legacy manteniendo `onoff=false`;
* la prueba fisica controlada confirma que el arranque y la parada desde
  `Riego Manual v2` funcionan correctamente de extremo a extremo.

### Fase 6 - Migrar motor

Estado: planificada, no iniciar implementacion sin aprobacion explicita.

Objetivo:

* sustituir `Irrigation.js` por `IrrigationEngine` dentro de la app;
* que la app sea propietaria de motor, cola, reles y watchdog operativo;
* conservar ESPHome como hardware puro.

El plan detallado de Fase 6 esta documentado en la seccion
`Fase 6 - Migracion controlada del motor a Rama 2`, abierta tras completar el
inventario operativo de Fase 5.8. Esa seccion define arquitectura propuesta,
modos `SHADOW`, `ACTIVE_COMPAT` y `NATIVE_ONLY`, subfases, cutover, rollback y
riesgos.

Riesgo:

* es la fase con impacto fisico directo sobre electroválvulas.

Criterio previo:

* Health, Recovery, Status e History migrados y estables;
* rollback documentado;
* pruebas fisicas preparadas;
* usuario aprueba explicitamente iniciar la migracion del motor.

### Fase 7 - Retirada de scripts y dispositivos virtuales

Estado: pendiente.

Objetivo:

* deshabilitar Flows de HomeyScript restantes;
* archivar scripts como backup;
* retirar dispositivos virtuales sustituidos por devices nativos;
* dejar Variables Logic como proyeccion publica, no como bus interno.

## Decisiones abiertas

| Decision | Estado | Nota |
| --- | --- | --- |
| Mantener Variables Logic tras migracion total | Redefinida | Solo observabilidad/compatibilidad, no fuente de verdad Rama 2 |
| Migrar motor a app | Planificada | Fase 6 documentada; siguiente paso: `IrrigationEngineService` en `SHADOW` |
| Crear devices nativos para sistema/manual/historico | Completado | Sistema, historico y manual validados |
| Sustituir notificaciones por Flow Cards app | Parcial | Health usa `health_transition`; motor/historico aun usan compatibilidad |
| App ID de Rama 2 | Decidido | `com.dadecal.irrigation.v2` |
| Contratos hardware Rama 2 | Decidido | Mantener `irrigation-hw-api@1.x` mientras ESPHome no cambie |
| Primer servicio para ACTIVE_COMPAT | Activado | `StatusSyncService`, Flow status sync deshabilitado |
| Segundo servicio para ACTIVE_COMPAT | Activado | `HealthService`, Flow health legacy deshabilitado |
| Tercer servicio para ACTIVE_COMPAT | Activado | `HistoryService`, Flows legacy de historico deshabilitados |
| Scheduler Rama 2 | Activado | Flow v2 entrega `program_requested` a `Irrigation.js`; Rama 1 desactivado |
| Recovery Rama 2 | Activado | App Rama 1 desactivada; Flow v2 `recovery_event` creado |
| Device nativo Sistema | Validado | Device `fafc57a1-b4f9-4882-b9e2-6dc170d312c2` |
| Device nativo Historico | Validado | Device `40413129-f263-433b-adba-69c67bea662c` |
| Device nativo Manual | Validado fisicamente | Device `b0121276-44e0-4d4f-9214-982084c83e17` |
| Iconos capabilities v2 | Implementado | Assets locales replicados desde dispositivos legacy |
| Limpieza previa a motor | Parcialmente completada | Avisos legacy Health/Recovery deshabilitados; inicio/fin de sector se mantienen hasta migrar motor |

## Bitacora

### 2026-07-28

* Diagnostico de fallo nocturno: el motor nativo avanzo hasta S4 y fallo al
  cerrar el sector porque ESPHome Controller no acepto comandos
  (`Cannot send command: client not connected`). El firmware ESPHome forzo el
  apagado por seguridad al superar el tiempo maximo de la linea 4. El motor
  cancelo S5-S6 por seguridad.
* Recovery v2 intento reiniciar ESPHome Controller, pero Homey devolvio
  `Missing Scopes`. La API local declara que `restartApp` requiere el scope
  Web API `homey.app`; la app expone ahora
  `apiScopes.restartScopeAvailable` en `/recovery/status` para diagnosticar si
  el token interno lo tiene realmente.
* Se corrige `RecoveryService` para registrar `RESTART_UNAVAILABLE`, marcar
  `appStateV2.recovery.restartBlockedReason=MISSING_SCOPES`, exponer
  `canRestartController=false` y no reintentar el reinicio durante el mismo
  incidente cuando falte el scope o Homey devuelva `Missing Scopes`.
* El bloqueo de reinicio se limpia cuando el dispositivo ESPHome vuelve a estar
  disponible. La supervision continua activa aunque no exista permiso de
  reinicio automatico.
* Se añade `POST /recovery/restart-controller/probe` como prueba controlada
  del reinicio desde el contexto real de la app. El endpoint exige
  `confirmNoIrrigationActive=true`, motor `IDLE` y todos los reles RAW apagados
  antes de llamar a `restartApp`.
* La prueba controlada desde la app confirma que el token interno puede exponer
  `apiScopes.restartScopeAvailable=true` y aun asi recibir `Missing Scopes` en
  la operacion real. La misma llamada a
  `/api/manager/apps/app/com.ugrbnk.esphome/restart` funciona con la sesion CLI
  del propietario, por lo que la API existe y el problema es el token usado por
  la app.
* Se implementa token opt-in con `recoveryControllerTokenV2`: Recovery v2 usa
  directamente el token de usuario configurado para `restartApp` y evita el
  intento conocido con el token interno de la app. Si no hay token configurado,
  conserva el camino interno y registra `RESTART_UNAVAILABLE` ante
  `Missing Scopes`. Se añaden `GET/PUT/DELETE /recovery/token` para consultar,
  guardar o borrar el token sin exponerlo completo.

### 2026-07-21

* Se implementa el driver nativo `irrigation_history` para
  `Historico de Riego v2`.
* Se añaden capabilities custom de solo lectura para ultimo riego, fecha,
  programa, duracion/litros, acumulados y ultimo riego por cada sector.
* `HistoryService` registra devices nativos y proyecta `nativeExpected` desde
  la misma proyeccion legacy, sin recalcular otra fuente de verdad.
* Se añade `/history-device/ensure`; en runtime detecta el device existente sin
  duplicarlo. La creacion desde la app sin device previo queda limitada por
  `Missing Scopes`, por lo que el alta inicial se hizo mediante PairSession
  externa.
* Se crea en Homey el device `Historico de Riego v2`
  (`40413129-f263-433b-adba-69c67bea662c`).
* Se corrige `HistoryService.sameValue` para no tratar `null` como equivalente
  a `0`, evitando que litros o caudal a cero queden sin escribir en el device
  nativo.
* La validacion en Homey confirma ultimo evento `1784582820068-6`, contador
  `108`, duracion acumulada `1750`, litros acumulados `0` y valores por sector
  1..6 proyectados.
* Se replican en Rama 2 los iconos de capabilities del dispositivo virtual
  legacy `Sistema de Riego` como assets locales SVG de la app v2.
* `Historico de Riego v2` replica los iconos legacy existentes para campos de
  texto y usa equivalentes semanticos del mismo set antiguo para los campos
  numericos que no tenian `iconObj` explicito en el dispositivo virtual.
* Se normalizan los SVG de sector, watchdog y ultimo mensaje a paths planos
  sin `defs`, `use`, `href` ni transforms, porque Homey los empaquetaba pero
  algunas vistas de capabilities no los renderizaban.
* Se implementa el driver nativo `irrigation_manual` para `Riego Manual v2`.
* Se añade `ManualDeviceService` como puente de compatibilidad hacia el device
  legacy `Riego manual`, sin controlar reles, motor ni cola.
* Se añaden endpoints `/manual-device/status`, `/manual-device/check` y
  `/manual-device/ensure`.
* Se crea en Homey el device `Riego Manual v2`
  (`b0121276-44e0-4d4f-9214-982084c83e17`).
* La validacion segura confirma que sector `2` y duracion `3` se replican del
  device v2 al legacy y que ambos permanecen con `onoff=false`.
* Tras una prueba fisica se observa que `Sistema de Riego v2` refleja
  `RUNNING/IDLE` con latencia porque su proyeccion depende del polling de
  `SystemDeviceProjectionService` cada 60 segundos, mientras el dispositivo
  legacy "Sistema de Riego" lo escribe directamente `Irrigation.js`.
* Se añade refresco rapido de `Sistema de Riego v2` tras comandos manuales
  `START/STOP` desde `Riego Manual v2`, con comprobaciones programadas a 1, 3,
  7, 15 y 30 segundos. No modifica `Irrigation.js` ni cambia la propiedad del
  motor.
* Se habilitan Insights en las capabilities numericas custom de los tres
  devices nativos: `Sistema de Riego v2`, `Historico de Riego v2` y
  `Riego Manual v2`. Los campos de texto quedan fuera de Insights porque son
  mensajes/estados no numericos.
* Nota operativa: Homey puede no mostrar historico previo para una capability
  que acaba de activar Insights hasta que reciba una nueva escritura de valor.
* El usuario valida fisicamente `Riego Manual v2`: arranque y parada funcionan
  correctamente a traves del puente legacy y `Irrigation.js` sigue siendo el
  motor activo.
* La Fase 5.5 de devices nativos queda completada funcionalmente. El siguiente
  hito requiere decidir si preparar la migracion de `Irrigation.js` o hacer una
  limpieza previa de Flows/dispositivos legacy.
* Se abre Fase 5.8 para auditar Flows, dispositivos legacy y rollback antes de
  iniciar la migracion del motor.
* Se documenta una matriz inicial de Flows, dispositivos y rollback basada en
  el ultimo inventario fiable de Homey.
* El inventario en vivo de Flows, devices y apps se completa cuando Homey API
  deja de responder `Too many requests`; coincide con la matriz inicial.
* Queda pendiente decidir si deshabilitar los dos Flows legacy de notificacion
  de Health/Recovery o mantenerlos como compatibilidad silenciosa.

### 2026-07-19

* Se crea el Flow Trigger nativo `health_transition` en la app Rama 2.
* En `ACTIVE_COMPAT`, `HealthService` persiste salud en `appStateV2`, registra
  eventos internos y emite `health_transition` solo cuando cambia la firma de
  salud.
* El orden de Health activo queda: persistencia interna, trigger nativo,
  proyeccion UI.
* `MigrationControlStore` vuelve a permitir `ACTIVE_COMPAT` para Health.
  Scheduler e History siguen bloqueados para modo activo.
* Se instala la app Rama 2 corregida en Homey y se verifica que queda
  `running`.
* Se crea y habilita el Flow `Riego - Aviso de incidencia hardware v2`
  (`b902c1a4-a148-476e-9478-29704db9c3e4`) con trigger
  `homey:app:com.dadecal.irrigation.v2:health_transition`.
* Se activa `HealthService` en `ACTIVE_COMPAT` y se valida un check activo con
  estado `OK`, sin escrituras Logic, con persistencia en `appStateV2` y sin
  disparo de aviso por no existir transicion nueva.
* Se deshabilita el Flow tecnico `Riego - Supervision hardware cada minuto`
  (`2f02d7f8-0a4a-44b6-b469-5dffc6622065`), por lo que
  `IrrigationHealth.js` deja de ejecutarse periodicamente.
* `HistoryService` deja de escribir `Irrigation.HistoryLastProjectedId` en
  `ACTIVE_COMPAT`. La barrera activa pasa a
  `appStateV2.history.lastProjectedEventId`.
* Se añade bootstrap idempotente de History: si la barrera interna esta vacia
  pero la barrera legacy coincide con el ultimo evento, se inicializa
  `appStateV2` sin sumar acumulados ni contador.
* `MigrationControlStore` vuelve a permitir `ACTIVE_COMPAT` para History.
* Se instala la app Rama 2 actualizada en Homey.
* Se activa `HistoryService` en `ACTIVE_COMPAT`; el ultimo evento
  `1784410020110-6` ya estaba proyectado y se inicializa
  `appStateV2.history.lastProjectedEventId` con ese valor sin reprocesar
  acumulados.
* Se deshabilita el Flow `Riego History`
  (`4571a073-1f27-45bd-8317-33a94c6b18fb`). Los Flows
  `Riego history - sync 1 min` y `Riego history - on OFF` permanecen
  deshabilitados.
* Se añade `program_requested` a Rama 2 y se crea el Flow
  `Riego programador v2 - solicitud`
  (`64919d62-ac08-43cd-b4de-f7472f696336`) para entregar la solicitud JSON a
  `Irrigation.js` mediante HomeyScript con argumento.
* `Scheduler` de Rama 2 se activa en `ACTIVE_COMPAT`. A las 15:05 CEST del
  2026-07-19 el estado verificado es `due=false`, proximo riego
  `2026-07-19 22:00`, sin `pendingRequest` y sin errores.
* El Scheduler de Rama 1 queda con `enabled=false` y el Flow antiguo
  `Riego programador - solicitud`
  (`e13d0fd1-8ad5-4cef-a210-dd843766e0a8`) queda deshabilitado.
* Los Flows `Riego - Aviso inicio de sector` y `Riego - Aviso fin de sector`
  pasan a usar las condiciones v2 `notify_sector_start_enabled` y
  `notify_sector_end_enabled`.
* Se porta `RecoveryService` a `homey/app-v2` como servicio gobernado por
  `migrationControlV2.services.recovery`.
* Recovery v2 en `SHADOW` observa la disponibilidad del dispositivo `Riego` y
  calcula si reiniciaria ESPHome Controller, pero no persiste ni reinicia.
* Recovery v2 en `ACTIVE_COMPAT` usara `appStateV2.recovery`, cooldown de 30
  minutos, maximo de tres intentos por incidente y la Flow Card nativa
  `recovery_event`.
* Se anaden endpoints `/recovery/status` y `/recovery/check` a la app v2.
* `MigrationReadinessService` incluye Recovery en el precheck de Rama 2.
* Se instala la app v2 actualizada en Homey tras superar el rate limit temporal
  de Athom Cloud.
* Se crea y habilita el Flow `Riego - Aviso autorrecuperacion ESPHome v2`
  (`20cfcfe6-0802-4d42-aca4-9a127f9ccdd4`) con trigger
  `homey:app:com.dadecal.irrigation.v2:recovery_event`.
* Se desactiva la app Rama 1 `com.dadecal.irrigation` para evitar doble
  autorrecuperacion.
* Se activa `recovery=ACTIVE_COMPAT` en `migrationControlV2`. La verificacion
  en Homey confirma `restartSupported=true`, `canRestartController=true`,
  `available=true`, `timerActive=true`, sin fallos consecutivos y sin error.
* Se implementa el primer device nativo de Rama 2: driver `irrigation_system`
  con capabilities custom de solo lectura y emparejamiento estatico como
  "Sistema de Riego v2".
* Se añade `SystemDeviceProjectionService`, que calcula la proyeccion del
  sistema desde Variables Logic de lectura, dispositivo RAW `Riego` y
  `appStateV2.health`, sin escribir Variables Logic ni controlar motor.
* Se añaden endpoints `/system-device/status` y `/system-device/check`.
* Se instala la app v2 en Homey y se valida que `/system-device/check` devuelve
  `writesOperationalVariables=false`, RAW disponible, motor `IDLE`, ESPHome
  `Conectado`, fuga `No detectada`.
* Se crea por API de pairing el device nativo `Sistema de Riego v2`
  (`fafc57a1-b4f9-4882-b9e2-6dc170d312c2`) y se confirma `pairedDevices=1`.
* Se corrige la comparacion de capabilities nativas para no tratar `null` y
  `0` como equivalentes. Tras reinstalar, el device muestra sector `0`, tiempo
  restante `0` y cola `0`.
* Se declara explicitamente el flujo de pairing del driver `irrigation_system`
  con `list_devices` y `add_devices`, para que el alta manual del device sea
  visible desde la app Homey.
* Se añade `/system-device/ensure`, endpoint idempotente para recrear
  `Sistema de Riego v2` si se borra accidentalmente sin duplicarlo si ya existe.

### 2026-07-18

* Se crea el plan vivo de migracion a app nativa.
* Se ejecuta la Fase 0: arquitectura objetivo, fronteras y orden de migracion.
* Se fija que el siguiente paso tecnico recomendado es migrar
  `IrrigationHealth.js` a `HealthService`.
* Se redefine el plan como Rama 2: una generacion nueva separada de Rama 1 en
  codigo, artefactos, binarios y documentacion.
* Se crea la carcasa tecnica de Rama 2 en `homey/app-v2`, con app id
  `com.dadecal.irrigation.v2`, version `2.0.0` y sin responsabilidades de
  riego activas.
* Se instala la app Rama 2 en Homey en paralelo con Rama 1:
  `com.dadecal.irrigation.v2` queda `running`, `com.dadecal.irrigation`
  permanece `running`, y `/status` confirma modo `skeleton`.
* Se porta la funcionalidad actual del programador a Rama 2 en modo sombra:
  config propia `schedulerConfigV2`, calculo de proximo riego, Rain Delay y
  GUI de settings. La app v2 no declara Flow Trigger ni puede emitir
  solicitudes al motor.
* Se valida en Homey que Rama 2 calcula el mismo proximo riego que Rama 1 para
  la configuracion actual, mientras Rama 1 mantiene su `lastRunDate` y Flow de
  produccion.
