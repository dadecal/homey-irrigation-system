Sistema de Riego ESP32 + Homey

Testing Guide

Objetivo

Este documento define las pruebas de validación que deben ejecutarse siempre que se modifique cualquier componente del sistema.

El objetivo es garantizar que nuevas funcionalidades o refactorizaciones no introduzcan regresiones.

Siempre que sea posible, las pruebas deben realizarse utilizando el hardware real (ESP32 + electroválvulas) y la integración ESPHome.

⸻

1. Validación del motor (Irrigation.js)

Durante Rama 2, antes de sustituir `Irrigation.js`, el contrato del motor se
protege tambien con pruebas unitarias en `homey/app-v2/test/engine-contract.test.js`.
Estas pruebas no controlan hardware; verifican reglas puras extraidas del
motor actual:

* limites de sector y duracion;
* normalizacion de solicitudes `SCHEDULER`;
* forma de cola manual y programada;
* calculo de minutos restantes;
* decisiones de `tick` para `timeout`, watchdog, grace period y ejecucion
  obsoleta;
* forma del evento de historico.

Estas pruebas deben pasar antes de iniciar el modo sombra del motor nativo.

En Fase 6.1, validar además:

* `/api/app/com.dadecal.irrigation.v2/engine/status` devuelve `mode=SHADOW`,
  `controlsHardware=false`, `writesOperationalVariables=false` y
  `activeCompatSupported=false`;
* `/api/app/com.dadecal.irrigation.v2/engine/check` lee estado legacy, relés
  RAW y cola, calcula `tickDecision` y no escribe ningún valor;
* `migrationControlV2.services.engine` permanece en `SHADOW`;
* intentar activar `engine=ACTIVE_COMPAT` debe fallar hasta una fase posterior.

En Fase 6.2, validar además:

* `/engine/check` incluye `dryRunTransaction`;
* todos los pasos del plan devuelven `dryRun=true`;
* para `STOP_TIMEOUT`, el plan apaga relés antes de persistir historico, emite
  trigger de historico antes de actualizar UI y no apaga el device manual si
  queda cola pendiente;
* para parada manual/watchdog, el plan vacia cola antes de historico y apaga el
  device manual;
* `failurePlan` conserva `activeSector` cuando existe un sector activo y
  planifica `state=ERROR`, `stopReason=error`;
* ninguna prueba dry-run debe escribir relés, Variables Logic ni capabilities.

En Fase 6.3, validar además:

* `POST /engine/manual-start/preview` acepta `sector` y `duration`, construye
  una cola manual y devuelve `type=startQueuedItem` con todos los pasos
  `dryRun=true`;
* `POST /engine/program-start/preview` acepta una solicitud versionada de
  scheduler, conserva la cola restante y devuelve `accepted=true` si el motor
  legacy esta libre;
* `POST /engine/manual-stop/preview` devuelve un plan `type=stop` sin ejecutar
  apagado de relés, persistencia, historico ni proyeccion UI;
* si el motor legacy esta `RUNNING` o en `ERROR`, las previsualizaciones de
  arranque nativo deben devolver `accepted=false`;
* `engine` debe continuar en `SHADOW` y `ACTIVE_COMPAT` debe seguir bloqueado.

En preparacion de Fase 6.4, validar antes de cualquier cutover:

* readiness de migracion sin blockers distintos de `engine` mientras aun no
  este implementado el modo activo;
* los endpoints reales `/engine/manual-start`, `/engine/program-start`,
  `/engine/manual-stop`, `/engine/tick` y `/engine/recover` devuelven error de
  compuerta mientras `engine=SHADOW`;
* app v2 `running`, ESPHome Controller `running` y RAW `Riego` disponible;
* motor `IDLE`, cola `0`, `activeSector=0` y todos los relés apagados;
* Health sin incidencias `ERROR` activas de ESPHome;
* inventario de Flows reales coincide con el runbook de `AppMigrationPlan.md`;
* `Irrigation.js` remoto permanece intacto como rollback.
* `MigrationReadinessService.checkEngineActivation()` devuelve blockers
  especificos si cualquiera de esas condiciones falla;
* si `readyToActivateEngine=true`, `safeToDisableTechnicalFlows` debe seguir
  siendo `false` hasta que se ejecute el runbook fisico.

En Fase 6.4 activa, validar:

* `engine=ACTIVE_COMPAT` solo se acepta con confirmacion explicita;
* `/engine/status` declara `controlsHardware=true`,
  `writesOperationalVariables=false`, `writesInternalState=true` y
  `activeCompatSupported=true`;
* `MotorConfirmationStore` confirma solicitudes del Scheduler contra
  `appStateV2.engine` cuando `engine=ACTIVE_COMPAT`, tanto con motor `RUNNING`
  como con historico nativo ya persistido;
* los Flows legacy `Riego motor - ON`, `Riego motor - OFF`,
  `Riego programador v2 - solicitud` y `Riego motor - tick 1 min` quedan
  deshabilitados durante la prueba;
* arranque manual nativo activa solo el relé elegido;
* parada manual nativa apaga todos los relés, vacia cola, persiste historico y
  proyecta devices;
* timeout nativo apaga relés, genera historico y continua cola si existe;
* si el motor queda `IDLE` con cola pendiente y reles apagados, el siguiente
  tick debe reanudar la cola con `START_PENDING_QUEUE` y no vaciarla;
* si `programStart` y `tick` coinciden al inicio de un programa, el tick debe
  saltarse con `OPERATION_RUNNING` y la cola restante S2-S6 debe conservarse;
* con motor `IDLE`, cola vacia y todos los relés apagados, `FORCE_IDLE_NONE`
  no debe escribir relés ni tener `failurePlan`; una indisponibilidad puntual
  del RAW `Riego` no debe convertir el reposo normal en `ERROR`;
* si el motor no esta `RUNNING` pero se observa algun relé activo,
  `FORCE_IDLE_WATCHDOG` sí debe apagar relés y conservar el plan de fallo
  fisico;
* cada tick nativo añade una entrada compacta en
  `appStateV2.engine.tickDiagnostics`, visible desde
  `/engine/status.diagnostics.lastTicks`, con decision, relés observados,
  cola, disponibilidad RAW y resultado de ejecucion;
* las acciones relevantes del motor aparecen en
  `/engine/status.diagnostics.lastActions`;
* rollback devuelve `engine=SHADOW` y rehabilita los Flows legacy en el orden
  documentado.

Tras el intento abortado del 2026-07-25, validar ademas antes de repetir el
cutover:

* el backend `stateBackend=appState` del `EnginePlanExecutor` aplica estado,
  cola, historico y eventos en `appStateV2.engine` sin escrituras Logic;
* `IrrigationEngineService` lee Logic en `SHADOW`, lee `appStateV2.engine` en
  `ACTIVE_COMPAT` y sus acciones reales no escriben Variables Logic;
* Health, Recovery, SystemDevice y History leen la fuente activa correcta del
  motor cuando `engine=ACTIVE_COMPAT`;
* con Health/Recovery/History en `ACTIVE_COMPAT` pero `engine=SHADOW`, esos
  servicios siguen leyendo Variables Logic para conservar la convivencia
  actual;
* Health no reemite `health_transition` para el mismo error accionable cuando
  solo cambian warnings no accionables de ESPHome;
* `MigrationReadinessService` mantiene `readyToActivateEngine=false` mientras
  el motor nativo no declare soporte activo real sin dependencia de Logic.

1.1 Arranque manual

Objetivo

Verificar que un riego manual arranca correctamente.

Pasos

1. Seleccionar un sector.
2. Seleccionar una duración.
3. Activar el dispositivo Riego Manual.

Resultado esperado

* El relé correspondiente se activa.
* Ningún otro relé se activa.
* Estado = RUNNING.
* Sector activo correcto.
* Tiempo restante correcto.
* Cola vacía.
* El dispositivo Sistema de Riego refleja el nuevo estado.

⸻

1.2 Parada manual

Pasos

Durante un riego manual:

* desactivar ON/OFF.

Resultado esperado

* Todos los relés apagados.
* Estado = IDLE.
* Cola eliminada.
* Tiempo restante = 0.
* Histórico actualizado.
* Trigger histórico emitido.

⸻

1.3 Finalización por tiempo

Pasos

Ejecutar un riego de duración conocida.

Esperar a su finalización.

Resultado esperado

* Parada automática.
* Relés apagados.
* Histórico generado.
* Volumen registrado.
* Estado = IDLE.

⸻

1.4 Cola de riego

Pasos

Crear manualmente una cola con varios sectores.

Resultado esperado

* Se ejecutan en orden.
* Nunca existen dos relés activos.
* Cada sector genera una entrada de histórico.

⸻

1.5 Recuperación tras reinicio

Pasos

Reiniciar Homey durante un riego.

Resultado esperado

* El motor recupera correctamente el estado.
* No quedan relés abiertos indefinidamente.
* El watchdog actúa si es necesario.

⸻

1.6 Watchdog

Pasos

Simular:

* relé abierto
* estado interno IDLE

Resultado esperado

El motor detecta la inconsistencia.

Todos los relés se apagan.

Si el dispositivo RAW rechaza el apagado:

* estado = ERROR;
* la cola se cancela;
* se conserva el sector activo;
* no se publica IDLE falsamente.

Simular también un tick recibido más de dos minutos después de
`Irrigation.EndTimestamp`. Debe abortar el programa completo y nunca continuar
con el siguiente sector.

⸻

1.7 Estados inválidos

Probar:

* sector 0
* sector 7
* duración negativa
* duración superior al máximo

Resultado esperado:

No se inicia ningún riego.

Se informa del error.

⸻

1.8 Notificaciones por sector

Validar desde los ajustes de la app las cuatro combinaciones de
`notifySectorStart` y `notifySectorEnd`.

Resultado esperado:

* cada sector de una cola emite exactamente un evento de inicio y uno de fin;
* en Rama 2 activa, las notificaciones salen por las Flow Cards nativas
  `sector_started` y `sector_ended`;
* los Flows legacy basados en `Irrigation.SectorStartTrigger` e
  `Irrigation.SectorEndTrigger` permanecen deshabilitados mientras
  `engine=ACTIVE_COMPAT`;
* sólo se crea la notificación cuyo booleano está activo;
* el aviso de inicio incluye sector, duración y origen;
* el aviso de fin incluye sector, litros y motivo cuando no termina por tiempo;
* `appStateV2.engine.lastSectorEvent` se persiste antes de disparar la Flow
  Card nativa;
* una ejecución `status`, `tick` o `sync` no genera notificaciones de sector.

⸻

1.9 Interfaz del programador

Comprobar:

* la hora de fin es la hora inicial más la suma de todas las duraciones;
* cambia inmediatamente al modificar la hora inicial o cualquier sector;
* identifica correctamente el salto al día siguiente;
* Guardar está deshabilitado tras cargar o guardar;
* Guardar se habilita al modificar cualquier campo persistido;
* devolver todos los campos a su valor original vuelve a deshabilitar Guardar;
* con cambios pendientes, Rain Delay queda bloqueado;
* abandonar la página con cambios pendientes muestra confirmación;
* cerrar el diálogo Configurar con cambios pendientes muestra un aviso Homey;
* abandonar la página sin cambios no muestra confirmación.

⸻

2. Validación ESPHome

Relés

Comprobar:

* cada sector activa únicamente su relé.

⸻

Sensores de caudal

Verificar:

* litros ciclo
* reinicio al comenzar un nuevo riego
* actualización correcta
* detección "relé activo sin caudal" sólo cuando
  `flow_fault_detection_enabled` esté en `true`

⸻

Temperaturas

Comprobar:

* detección I2C del DHT20 en la dirección `0x38`
* temperatura ambiente `Temperatura Riego`
* humedad ambiente `Humedad Riego`
* temperatura ESP32
* que `Temp estimada chip ESP` usa `Temperatura Riego + temp_box_offset_c`
  cuando el DHT20 tiene lectura válida
* que `Temp estimada chip ESP` usa `ESP Internal Temp` como respaldo si el DHT20
  no publica lectura válida
* que `Sobrecalentamiento ESP` se activa por encima de 85°C estimados y se
  libera al bajar por debajo de 80°C

Relés tras migración I2C

Comprobar específicamente:

* Línea 5 activa únicamente el relé cableado en GPIO23.
* Línea 6 activa únicamente el relé cableado en GPIO13.

⸻

Estado conexión

Verificar:

* pérdida de conexión
* recuperación automática
* trazas `API_CLIENT_CONNECTED` y `API_CLIENT_DISCONNECTED` con `client` y
  `address` en el log durante el diagnóstico de clientes API
* actualización del text sensor diagnóstico `ESP Último cliente API`
* publicación de `ESP Firmware Version`
* publicación de `ESP Hardware Contract` con formato
  `irrigation-hw-api@<version>`

⸻

Timeout local de relé

Mantener un relé activado sin órdenes de Homey. A los 35 minutos ESPHome debe:

* forzar OFF;
* publicar el nuevo estado;
* registrar un error `irrigation.safety`.

⸻

Fuga

Simular flujo con todos los relés apagados.

Debe detectarse.

⸻

3. IrrigationStatus.js

Comprobar que sincroniza correctamente:

* temperatura ambiente
* humedad
* temperatura ESP32
* fuga
* watchdog
* estado conexión

Validar que:

* nunca modifica el estado del motor.
* nunca modifica relés.
* nunca modifica la cola.

⸻

4. IrrigationHistory.js

Generación de histórico

Cada finalización de riego debe generar exactamente una entrada.

⸻

Duplicados

Ejecutar varias veces el script sobre el mismo evento.

Resultado esperado:

No aumenta:

* litros acumulados
* tiempo acumulado
* contador

⸻

Último riego

Verificar:

* fecha
* sector
* duración
* litros

⸻

Histórico por sector

Cada sector debe mantener su último riego independiente.

⸻

4.1 IrrigationHealth.js

Validar individualmente:

* error WARN genérico del logger;
* error ERROR genérico del logger;
* DHT sin lecturas válidas;
* ESP32 desconectado y recuperado;
* reinicio detectado mediante caída de uptime;
* relé activo sin caudal durante 30 segundos;
* caudal con relé apagado;
* dos relés activos simultáneamente.

Comprobar siempre el orden:

* `Irrigation.Health` persistido;
* mensaje y trigger actualizados después;
* interfaz actualizada al final;
* ninguna notificación duplicada sin cambio de firma.

Flows de supervisión en Rama 2:

* `Riego - Supervisión hardware cada minuto` está deshabilitado; Health corre
  dentro de `HealthService` en la app v2;
* `Riego - Aviso de incidencia hardware v2` está habilitado, no está roto y se
  dispara con la Flow Card nativa `health_transition` solo para `ERROR` u
  `OFFLINE`;
* el texto de la notificacion v2 debe incluir el detalle del token `message`
  con el formato `Incidencia en sistema de riego: [[message]]`;
* una recuperacion a `OK` no debe generar notificacion de incidencia;
* un estado `WARNING` debe quedar visible en Health/UI sin generar
  notificacion movil de incidencia;
* warnings genericos de ESPHome procedentes de `api`, `web_server` o `httpd`
  con mensajes `Reading failed CONNECTION_CLOSED` o
  `Unsupported content type` no deben generar incidencia;
* `Riego - Aviso de incidencia hardware` legacy permanece deshabilitado tras el
  cutover a Health v2;
* una incidencia nueva genera una notificación y las ejecuciones posteriores
  con la misma firma no generan otra.

Simular además los dos fallos críticos del motor:

* `Irrigation.State = ERROR` conservando un sector activo debe publicar
  `ENGINE_STOP_UNCONFIRMED` y notificar que el cierre no está confirmado;
* ESP32 no disponible mientras el motor está `RUNNING` debe publicar
  `ENGINE_CONTROLLER_OFFLINE` y pedir comprobar la electroválvula del sector;
* las ejecuciones siguientes sin cambio no deben repetir la notificación.

⸻

4.2 RecoveryService

Validar con `/api/app/com.dadecal.irrigation.v2/recovery/status` que localiza
la app ESPHome Controller, informa `restartSupported = true` y no modifica su
estado.

Simular indisponibilidad del dispositivo `Riego` y comprobar:

* en reposo no reinicia hasta la tercera comprobación consecutiva;
* durante `RUNNING` no reinicia hasta la segunda comprobación;
* persiste `RESTART_REQUESTED` antes de llamar a `restartApp`;
* no repite el reinicio durante los 30 minutos de cooldown;
* abandona tras tres intentos y genera un único aviso de agotamiento;
* al recuperar el dispositivo reinicia contadores y notifica `RECOVERED`;
* nunca modifica relés, motor ni cola;
* cada evento genera como máximo una notificación.

El Flow `Riego - Supervisión hardware cada minuto` debe permanecer
deshabilitado mientras `HealthService` este activo en Rama 2. Recovery corre
dentro de la app v2 con timer interno; el script antiguo
`IrrigationRecovery.js` no debe quedar conectado a ningun Flow para evitar
duplicar intentos durante una incidencia.

El Flow legacy `Riego - Aviso autorrecuperación ESPHome` debe permanecer
deshabilitado. Las notificaciones de Recovery deben salir por
`Riego - Aviso autorrecuperacion ESPHome v2` y la Flow Card nativa
`recovery_event`.

⸻

5. Device Capabilities

Verificar:

Riego Manual

* Sector
* Duración
* Información
* Tiempo restante

⸻

Sistema de Riego

* Estado
* Sector activo
* Tiempo restante
* Cola
* Programa
* Último mensaje
* Trigger histórico

⸻

Histórico

Verificar todos los campos visibles.

⸻

6. Variables Logic

Comprobar consistencia de:

* Irrigation.State
* Irrigation.Queue
* Irrigation.History
* Irrigation.ActiveSector
* Irrigation.StartTimestamp
* Irrigation.EndTimestamp
* Irrigation.StopReason
* Irrigation.LastTickTimestamp
* Irrigation.SectorStartMessage
* Irrigation.SectorStartTrigger
* Irrigation.SectorEndMessage
* Irrigation.SectorEndTrigger

No deben existir estados inconsistentes.

⸻

7. Flows

Comprobar:

* Tick
* Sincronización ESPHome
* Trigger Histórico
* Aviso inicio de sector
* Aviso fin de sector

Los Flows nunca deben contener lógica de negocio.

⸻

8. Pruebas de regresión

Tras cualquier modificación importante ejecutar obligatoriamente:

* Arranque manual
* Parada manual
* Finalización automática
* Histórico
* Sincronización ESPHome
* Recuperación tras reinicio

⸻

9. Rendimiento

Comprobar:

* No existen escrituras innecesarias en Device Capabilities.
* No existen escrituras innecesarias en Variables Logic.
* El tick mantiene una ejecución inferior a 1 segundo.
* No se producen errores repetitivos en el log.

⸻

10. Criterio de aceptación

Una modificación del sistema se considera válida únicamente si:

* Todas las pruebas anteriores son satisfactorias.
* No se introducen nuevas advertencias en los logs.
* No aparecen inconsistencias entre:
    * Hardware (ESP32)
    * Variables Logic
    * Dispositivos virtuales
    * Histórico

Cualquier regresión detectada deberá corregirse antes de continuar el desarrollo de nuevas funcionalidades.

⸻

11. Prueba del Scheduler 2026-07-02

Prueba física controlada:

* configuración: sector 1, 1 minuto;
* origen persistido: SCHEDULER;
* Flow program_requested habilitado y no roto;
* sólo el relé del sector 1 se activó;
* sectores 2..6 permanecieron apagados;
* parada automática por timeout;
* estado final IDLE;
* cola final vacía;
* histórico persistido y proyectado;
* configuración restaurada con enabled = false.

Resultado: satisfactorio para el puente completo.

Observación: el programa de 1 minuto finalizó en el siguiente tick periódico. Los timestamps registraron aproximadamente 115 segundos y durationRealMin = 2. La precisión temporal continúa limitada por la cadencia actual del Flow tick de un minuto.

⸻

12. Prueba de interfaz 2026-07-02

Comprobaciones:

* render estable de los seis sectores antes de cargar datos;
* escritorio sin desbordamiento horizontal;
* viewport móvil de 390 px sin desbordamientos ni solapamientos;
* guardado de hora, intervalo y duraciones;
* Rain Delay de 24 horas;
* cancelación de Rain Delay;
* persistencia tras reiniciar la aplicación;
* restauración final con enabled = false.

Resultado: satisfactorio.

⸻

13. Validación de release

Antes de publicar una release de sistema:

* comprobar que `release/components.json` refleja las versiones reales de los
  componentes modificados;
* comprobar que sólo cambian de versión los componentes que realmente han
  cambiado;
* si se despliega app Homey, ejecutar
  `node tools/release/build-homey-app.mjs`;
* si se despliegan HomeyScripts, ejecutar
  `node tools/release/build-homey-scripts.mjs`;
* generar la huella local con
  `node tools/release/check-homey-scripts.mjs expected`;
* comprobar que `release/homey-scripts.json` contiene `remoteName` y
  `homeyScriptId` reales para cada script que exista en Homey;
* ejecutar `node tools/release/prepare-release.mjs --system-release <release>`;
* verificar que `release-manifest.json` contiene el commit Git correcto;
* verificar si el manifest está marcado como `dirty`; si lo está, decidir
  explícitamente si se trata de una release provisional o si falta commitear;
* si se despliega firmware ESP32, subir exactamente el `.ota.bin` registrado en
  el manifest mediante `esphome upload ... --file`;
* si se despliega app Homey, instalar el artefacto `.tgz` ya generado con
  `node tools/release/install-homey-app-artifact.mjs --artifact <file.tgz>`;
* si se despliegan HomeyScripts, comprobar que los scripts subidos a Homey
  corresponden al artefacto `homey-scripts-<version>.zip` y sus hashes;
* cuando exista exportación remota de scripts, ejecutar
  `node tools/release/check-homey-scripts.mjs verify --remote-file <file>` y
  exigir estado `OK`;
* subir a GitHub Releases los artefactos generados y `SHA256SUMS.txt`;
* validar que las discrepancias se evalúan por contratos compatibles y no por
  igualdad de versiones entre componentes.
