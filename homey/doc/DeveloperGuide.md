Sistema de Riego ESP32 + Homey

Developer Guide

Objetivo

Este documento contiene los detalles técnicos necesarios para modificar o ampliar el sistema sin romper su arquitectura.

Debe mantenerse sincronizado con el código.

La arquitectura conceptual se describe en Architecture.md.

⸻

1. Organización del proyecto

Homey Irrigation System/
│
├── esp32/
│     │  Riego_Homey.yaml
│     │  stop_esphome_dashboard.sh
│     │  esphome-dashboard-nav.sh
│     │  esphome-dashboard.sh
│     │ secrets.yaml
│     └──riego/
│           linea.yaml
│
│
└── homey/
      Irrigation.js
      IrrigationStatus.js
      IrrigationHistory.js
      app/
        .homeycompose/app.json
        app.js
        api.js
        drivers/irrigation_scheduler/
        lib/
        settings/
      app-v2/
        .homeycompose/app.json
        app.js
        api.js
        lib/
        test/
      locales/

Las seis líneas ESPHome se instancian desde `riego/linea.yaml`. Cada instancia
recibe `line`, `flow_pin` y `relay_pin` desde la sección `packages` de
`Riego_Homey.yaml`. El paquete común conserva IDs y nombres distintos por línea
mediante sustituciones, evitando mantener seis copias de la misma lógica.

`homey/app` pertenece a Rama 1. `homey/app-v2` pertenece a Rama 2 y usa el app
id `com.dadecal.irrigation.v2`. La app v2 puede instalarse en paralelo durante
desarrollo. Su programador guarda configuracion propia en `schedulerConfigV2`.
En `SHADOW` calcula el proximo riego sin emitir solicitudes. En
`ACTIVE_COMPAT` emite la Flow Card `program_requested` con una solicitud JSON
versionada para que el Flow entregue la peticion a `Irrigation.js`. La app v2
no controla relés, no modifica directamente la cola, no cambia el estado del
motor ni escribe Variables Logic operativas del motor.

Decision de arquitectura de Rama 2: Variables Logic dejan de ser fuente de
verdad para la app nativa. Rama 2 persiste estado propio en ManagerSettings,
empezando por `appStateV2`, y usara Variables Logic solo como lectura legacy,
observabilidad o compatibilidad temporal con Rama 1. Los nuevos servicios no
deben depender de poder escribir Variables Logic para ser propietarios activos.

Rama 2 tambien incluye `HealthService`. Este servicio lee el estado del motor,
ESPHome y la variable publica `Irrigation.Health`, calcula las incidencias y
expone `/health/status` y `/health/check`. En `SHADOW` no escribe
`Irrigation.Health`, `Irrigation.HealthEventMessage`,
`Irrigation.HealthTrigger` ni proyecta capabilities. En `ACTIVE_COMPAT`
persiste salud interna en `appStateV2.health`, registra eventos internos y
dispara la Flow Card nativa `health_transition` solo si cambia la firma de
salud accionable. No escribe watchdog ni conexion ESPHome en devices V1.

Rama 2 conserva `StatusSyncService` solo como servicio retirado para
compatibilidad de API y diagnostico historico. Expone `/status-sync/status` y
`/status-sync/check`, pero no arranca timer, no lee RAW/sensores y no escribe
devices. La proyeccion nativa de temperatura, humedad, temperatura ESP32, fuga
y conexion ESPHome pertenece a `SystemDeviceProjectionService`.

Rama 2 incluye `HistoryService`. Este servicio lee `Irrigation.History` e
`Irrigation.HistoryLastProjectedId` solo como compatibilidad en `SHADOW`,
calcula la proyeccion del ultimo evento persistido y expone `/history/status`
y `/history/check`. En `ACTIVE_COMPAT` proyecta exclusivamente
`Historico de Riego v2` y avanza `appStateV2.history.lastProjectedEventId`.
No escribe el dispositivo virtual V1 "Historico de Riego".

Rama 2 incluye `RecoveryService`. Este servicio supervisa exclusivamente la
disponibilidad del dispositivo ESPHome `Riego` y la recuperacion de la app
ESPHome Controller. Expone `/recovery/status` y `/recovery/check`. En `SHADOW`
solo observa y devuelve si llegaria a reiniciar; no persiste estado ni llama a
`restartApp`. En `ACTIVE_COMPAT` persiste en `appStateV2.recovery`, aplica dos
fallos de umbral durante `RUNNING` o tres en reposo, respeta 30 minutos de
cooldown, limita a tres intentos por incidente y emite la Flow Card nativa
`recovery_event`. Nunca controla reles, cola ni estado del motor.

Rama 2 incluye `MigrationReadinessService` como control previo al cutover. Este
servicio expone `/migration/readiness` y `/migration/readiness/check`, ejecuta
los checks sombra y devuelve `safeToDisableTechnicalFlows=false` mientras no
exista un modo activo compatible validado para las responsabilidades migradas.
Este endpoint no modifica Flows, capabilities, Variables Logic ni motor.

`StatusSyncService` puede seguir apareciendo como `ACTIVE_COMPAT` dentro de
`migrationControlV2`, pero esta retirado: `retired=true`, `timerActive=false`,
`updatesDevices=false`. El Flow `Riego status - sync 1 min` permanece
deshabilitado. `IrrigationStatus.js` queda conservado como codigo de Rama 1,
pero ya no es el propietario activo de la proyeccion de estado
ambiental/conexion.

`HistoryService` soporta `ACTIVE_COMPAT`. En modo activo proyecta el ultimo
evento hacia `Historico de Riego v2` y solo despues actualiza
`appStateV2.history.lastProjectedEventId`. Esa clave interna es la barrera de
idempotencia de Rama 2: si el evento ya esta proyectado, no se incrementan
acumulados, contador ni duracion. Si la marca interna esta vacia pero el device
nativo ya contiene el ultimo evento, el servicio lo reconoce por estado nativo
y evita duplicar acumulados.

Estado actual: `HealthService` y `HistoryService` estan en `ACTIVE_COMPAT`.
`HistoryService` ya no depende de escribir ni leer
`Irrigation.HistoryLastProjectedId` para modo activo; usa
`appStateV2.history.lastProjectedEventId` y el estado nativo como barrera. Los
Flows legacy de historico estan deshabilitados para evitar doble proyeccion.
`HistoryService` proyecta ademas el device nativo `Historico de Riego v2`
(`793d9117-8709-43f2-a0d8-9938d07ab22e`) mediante capabilities custom de solo
lectura. La proyeccion nativa no genera historico, no escribe Variables Logic
y no modifica motor ni cola.
`/history-device/ensure` detecta si el device existe; si se borra y Homey
rechaza la creacion interna por `Missing Scopes`, debe recrearse mediante el
pairing normal de Homey o una PairSession externa.

Las capabilities custom de `Historico de Riego v2` declaran iconos SVG locales
en `homey/app-v2/assets/capability-icons`. Los campos legacy que tenian icono
explicito conservan su equivalente visual; los campos numericos del historico
legacy no tenian `iconObj`, por lo que Rama 2 usa iconos semanticos del mismo
set antiguo: reloj para duraciones/fechas, agua para litros/caudal y cola para
contador.

Estado actual: `Scheduler` de Rama 2 esta en `ACTIVE_COMPAT`. La app v2 emite
`homey:app:com.dadecal.irrigation.v2:program_requested` y el Flow
`Riego programador v2 - solicitud` entrega la etiqueta `request` a
`Irrigation.js` mediante HomeyScript con argumento. El Scheduler de Rama 1 esta
desactivado y el Flow antiguo `Riego programador - solicitud` esta
deshabilitado para evitar doble entrega.
Tras el cutover del motor nativo, `MotorConfirmationStore` sigue la misma
fuente activa que el resto de lectores transversales: Variables Logic cuando
`engine=SHADOW` y `appStateV2.engine` cuando `engine=ACTIVE_COMPAT`. El
programador solo marca `lastRunDate` tras observar `RUNNING` o historico de
origen `SCHEDULER` en esa fuente activa.

Estado actual: `HealthService` esta en `ACTIVE_COMPAT`. Persiste salud en
`appStateV2`, registra transiciones en `appStateV2.events` y proyecta
watchdog/conexion ESPHome sin escribir Variables Logic. La Flow Card nativa
`health_transition` se emite solo para estados accionables `ERROR` u
`OFFLINE`; las recuperaciones `OK` y los estados `WARNING` no generan
notificacion de incidencia. Los warnings genericos de ESPHome originados en
`api`, `web_server` o `httpd` con errores de conexion/HTTP se consideran ruido
operativo y no se convierten en incidencia de usuario. El Flow
`Riego - Supervision hardware cada minuto` esta deshabilitado.

Estado actual: `RecoveryService` de Rama 2 esta en `ACTIVE_COMPAT`. La app
Rama 1 `com.dadecal.irrigation` esta desactivada para evitar doble
autorrecuperacion. Recovery v2 puede reiniciar ESPHome Controller si el
dispositivo `Riego` permanece no disponible, y notifica mediante el Flow
`Riego - Aviso autorrecuperacion ESPHome v2` basado en `recovery_event`.
Si Homey devuelve `Missing Scopes` al invocar `restartApp`, Recovery v2 marca
`restartBlockedReason=MISSING_SCOPES`, expone
`canRestartController=false` en `/recovery/status` y no reintenta el reinicio
durante el mismo incidente. La supervision continua activa y el bloqueo se
limpia cuando el dispositivo ESPHome vuelve a estar disponible.
`/recovery/status` expone ademas `apiScopes.restartRequiredScope=homey.app` y
`apiScopes.restartScopeAvailable`, porque `restartApp` exige el scope Web API
`homey.app`. Para validacion controlada existe
`POST /recovery/restart-controller/probe`, que solo ejecuta el reinicio si
Recovery esta activo, el body confirma `confirmNoIrrigationActive=true`, el
motor esta `IDLE` y no hay reles RAW encendidos.
Si existe un token de usuario configurado en `recoveryControllerTokenV2`,
Recovery v2 lo usa directamente para reiniciar ESPHome Controller y no intenta
primero el token interno de la app, porque ese camino ya se ha validado como
fallido con `Missing Scopes`. Se gestiona mediante
`GET/PUT/DELETE /recovery/token`; el endpoint de estado solo devuelve si esta
configurado y una version enmascarada. El token se usa exclusivamente para
`restartApp` y no se mezcla con la configuracion del programador.

Rama 2 incluye `IrrigationEngineService` como propietario activo del motor
nativo cuando `engine=ACTIVE_COMPAT`. En modo activo controla los relés RAW,
persiste estado/cola/historico en `appStateV2.engine` y emite Flow Cards
nativas de inicio/fin de sector. No escribe Variables Logic operativas ni
capabilities V1.

Historicamente, Fase 6.2 añadió adaptadores dry-run del motor:

* `EngineStateStore`, para planificar escrituras de estado, cola, historico y
  eventos sin ejecutarlas;
* `EspHomeIrrigationHardwareAdapter`, para planificar apagado/encendido de
  relés sin llamar a `setCapabilityValue`.

El adaptador de proyeccion legacy fue retirado en `v2.0.8`. Los planes activos
del motor no deben contener pasos hacia devices V1.

`/engine/check` devuelve `dryRunTransaction` con el orden de pasos que el motor
nativo ejecutaria y un `failurePlan` para el caso critico de fallo apagando
relés. Todos los pasos deben conservar `dryRun=true` mientras el servicio
permanezca en `SHADOW`.

Fase 6.3 prepara las entradas nativas del motor sin cutover. La app expone:

* `POST /engine/manual-start/preview`, con `sector` y `duration`;
* `POST /engine/program-start/preview`, con una solicitud versionada de
  scheduler;
* `POST /engine/manual-stop/preview`.

Estos endpoints construyen la misma cola y el mismo plan operativo que usaria
el motor nativo, pero devuelven solo una transaccion `dryRun`. No controlan
relés, no escriben Variables Logic operativas, no actualizan devices y no
sustituyen a los Flows legacy mientras `engine` permanezca en `SHADOW`.

Fase 6.4 no debe activarse como un cambio unico. Primero debe implementarse la
ejecucion real detras de la compuerta `migrationControlV2.services.engine`.
Mientras `engine=SHADOW`, `ManualDeviceService` debe seguir usando el puente
legacy hacia `Riego manual`, `Scheduler` debe seguir emitiendo
`program_requested` hacia el Flow que ejecuta `Irrigation.js`, y el tick real
debe seguir siendo el Flow `Riego motor - tick 1 min`.

Fase 6.4A/6.4B introduce `EnginePlanExecutor`, que aplica planes del motor
contra relés RAW, Variables Logic operativas, historico, triggers y devices
legacy. `IrrigationEngineService` expone acciones reales protegidas:

* `POST /engine/manual-start`;
* `POST /engine/program-start`;
* `POST /engine/manual-stop`;
* `POST /engine/tick`;
* `POST /engine/recover`.

Estas rutas deben devolver error de compuerta mientras `engine=SHADOW`.
`MigrationControlStore` mantiene `engine=ACTIVE_COMPAT` bloqueado hasta que se
complete la validacion de permisos, salud y rollback. Por tanto, la presencia
de endpoints reales no implica que la app controle hardware en Homey real.

Cuando `engine=ACTIVE_COMPAT`, y solo entonces:

* `IrrigationEngineService` sera el propietario unico de relés, cola, estado,
  historico y tick;
* `ManualDeviceService` podra llamar a `startManual` y `stop` nativos en vez
  de escribir `onoff` en el device legacy;
* `Scheduler` podra llamar a `startProgram` nativo en vez de emitir la Flow
  Card `program_requested`;
* los Flows legacy `Riego motor - ON`, `Riego motor - OFF`,
  `Riego programador v2 - solicitud` y `Riego motor - tick 1 min` deberan
  estar deshabilitados para evitar doble motor.

Antes de permitir `engine=ACTIVE_COMPAT`, `MigrationReadinessService` debe
confirmar app v2 y ESPHome Controller activos, RAW `Riego` disponible, motor
`IDLE`, cola vacia, relés apagados y ausencia de incidencias criticas de
Health. Si Health reporta un error ESPHome activo, el cutover queda bloqueado
aunque el motor este aparentemente `IDLE`.

El tick nativo distingue entre reposo normal y apagado defensivo. La decision
`FORCE_IDLE_NONE` significa que el motor no esta `RUNNING` y no se observan
relés activos; en ese caso el plan solo normaliza estado/proyecciones y no
escribe relés ni ejecuta plan de fallo fisico si el RAW `Riego` no esta
disponible. La escritura de apagado y el `failurePlan` que puede dejar el motor
en `ERROR` se reservan para `FORCE_IDLE_WATCHDOG`, `STOP_TIMEOUT`,
`STOP_WATCHDOG` y `STALE_RUN_ABORT`, donde existe riesgo fisico real o un
riego activo que cerrar.

`HealthService` calcula una firma de notificacion separada de la firma completa
de salud. La firma completa conserva warnings y telemetria para diagnostico,
pero `health_transition` solo se reemite si cambia el conjunto de incidencias
accionables (`ERROR`/`OFFLINE`). Un warning accesorio de ESPHome no debe
re-notificar el mismo error de motor.

La activacion de `engine=ACTIVE_COMPAT` se realiza mediante
`PUT /migration/control`. Para el servicio `engine`, la API ejecuta primero
`MigrationReadinessService.checkEngineActivation()` y entrega el resultado a
`MigrationControlStore`. El store solo permite el cambio si
`engineActivationPrecheck.allowed=true` y
`acknowledgeDuplicateWriteRisk=true`. El readiness puede devolver
`readyToActivateEngine=true`, pero `safeToDisableTechnicalFlows` debe seguir
siendo `false` hasta ejecutar el runbook fisico de cutover.

Rama 2 incluye el primer device nativo de sistema, driver
`irrigation_system`. El device `Sistema de Riego v2`
(`9b64ed88-17cd-4dd0-bd0d-484850ad83fd`) expone capabilities custom de solo
lectura. La proyeccion la realiza `SystemDeviceProjectionService`, que lee
Variables Logic del motor, el dispositivo RAW `Riego` y `appStateV2.health`.
Expone `/system-device/status`, `/system-device/check` y
`/system-device/ensure`. El driver declara pairing con `list_devices` y
`add_devices`; `/system-device/ensure` permite recrear el device de forma
idempotente si se borra accidentalmente. Por defecto se crea en la zona Homey
`Riego` (`c00ba2c5-9d67-4e16-89c0-cc4ef82b5d1f`) y sin `iconOverride` legacy,
para que Homey use el icono del driver nativo. No escribe Variables Logic,
no modifica cola, no controla reles y no sustituye todavia el dispositivo
virtual legacy hasta completar la validacion visual sostenida.

Los iconos de device de Rama 2 no dependen del `iconOverride` legacy de
Device Capabilities, porque Homey puede seguir mostrando el icono generico de
la app para devices nativos ya emparejados. Cada driver v2 declara su icono
visible en `homey/app-v2/drivers/<driverId>/assets/icon.svg`, que es la
ubicacion que Homey usa para calcular el `iconObj` del driver y de los nuevos
devices emparejados. El quick action y el indicador principal tambien se
declaran en el driver: sistema sin quick action e
`irrigation_state` como indicador; historico sin quick action e
`irrigation_history_timestamp` como indicador; manual con quick action `onoff`
y `uiIndicator=.none`, igual que el device legacy. En devices ya existentes,
Homey no expone `ui.quickAction` como campo actualizable por API y no recalcula
`iconObj`; para que cambien icono y quick action hay que recrear los devices
v2 tras instalar una version con el driver corregido.

Las capabilities custom de `Sistema de Riego v2` declaran iconos SVG locales
replicados desde los iconos asignados al dispositivo virtual legacy: estado,
sector, cola, origen, programa, mensajes, conexion ESP32, fuga, temperatura,
humedad y salud/watchdog.

Rama 2 incluye tambien el device nativo `Riego Manual v2`, driver
`irrigation_manual` (`8171ea4e-7f63-4597-b53d-0a027a540840`). Este device no
controla reles directamente. En `ACTIVE_COMPAT`, `ManualDeviceService` llama a
`IrrigationEngineService` para arrancar/parar y proyecta su estado desde
`appStateV2.engine`. No escribe sector, duracion ni `onoff` en el device
legacy `Riego manual`.

Para reducir la latencia visual durante la convivencia, `ManualDeviceService`
notifica los comandos `START/STOP` a `SystemDeviceProjectionService`, que
programa refrescos rapidos de `Sistema de Riego v2` a 1, 3, 7, 15 y 30
segundos. El polling normal de sistema sigue siendo de 60 segundos y actua como
respaldo.

Los devices nativos `Historico de Riego v2` y `Riego Manual v2` tambien se
crean por defecto en la zona Homey `Riego` y sin `iconOverride` legacy. Los
iconos visibles de device proceden de los PNG de driver empaquetados. Los
iconos de capabilities en Rama 2 se declaran como SVG locales por significado
funcional. Homey genera nuevos
`iconObj.id` por app/capability, por lo que no se debe comparar el identificador
interno con el del device legacy sino el icono visual y su significado.

Los devices nativos de Rama 2 declaran Insights en sus capabilities numericas
custom. Los textos de estado, mensajes e informacion no se registran en
Insights. Tras activar Insights en una capability existente, Homey puede tardar
en mostrarla hasta que se publique un nuevo valor.

La app v2 expone temporalmente `/diagnostics/logic-write-probe` para aislar el
problema de scopes. El probe crea, actualiza y borra una Variable Logic temporal
`Codex.AppLogicScopeProbe.<timestamp>` y no toca variables de riego.

`AppStateStore` reside en `homey/app-v2/lib/app-state-store.js`. Usa la clave
`appStateV2` y sera la base para persistir estado interno de Health, History y
eventos de Rama 2 sin pasar por Variables Logic.

Desde el 2026-07-25, `appStateV2` incluye tambien `engine`. Este bloque es la
base de persistencia interna del motor nativo e incluye estado, sector activo,
timestamps, origen, motivo de parada, cola, historico propio, ultimo tick,
diagnostico compacto de los ultimos ticks, diagnostico compacto de acciones
relevantes, ultimo trigger de historico y ultimo evento tecnico de sector. El
`EnginePlanExecutor` acepta `stateBackend=appState` para aplicar pasos
`EngineStateStore` contra `appStateV2.engine` sin escribir Variables Logic. El
backend por defecto sigue siendo `logic` mientras `Irrigation.js` conserve la
propiedad operativa del motor.

`appStateV2.engine.tickDiagnostics` conserva un anillo de los ultimos ticks
nativos. Cada entrada incluye timestamp, fuente de estado, estado del
motor, sector, timestamps, cola, relés observados, `rawAvailable`, `rawError`,
decision `tickDecision`, resultado de ejecucion y si hubo arranque del
siguiente sector. `/engine/status` expone estos datos en
`diagnostics.lastTicks` para poder auditar paradas `watchdog` o ejecuciones
obsoletas despues de la incidencia. No participa en la logica de riego.

`appStateV2.engine.actionDiagnostics` conserva acciones relevantes del motor
nativo, excluyendo ticks rutinarios de `forceIdle` y `updateRunning`. Incluye
`programStart`, `startNextQueuedItem`, paradas por `timeout`/`watchdog`,
acciones manuales, recuperacion y cualquier fallo de ejecucion. `/engine/status`
lo expone en `diagnostics.lastActions`.

`IrrigationEngineService` usa lectura dual: en `SHADOW` lee Variables Logic
para compararse con Rama 1; en `ACTIVE_COMPAT` usa `appStateV2.engine` como
snapshot operativo y ejecuta planes con `stateBackend=appState`. El servicio
declara `activeCompatSupported=true` cuando dispone de `AppStateStore`; esto no
activa el motor por si mismo. La activacion real sigue protegida por
`MigrationReadinessService.checkEngineActivation()`, que exige motor `IDLE`,
cola vacia, relés apagados, RAW disponible, Health sin errores criticos y
confirmacion explicita en `PUT /migration/control`.

Si el motor activo encuentra `state=IDLE`, cola pendiente y todos los relés
apagados, el tick no ejecuta `forceIdle`. Genera la decision
`START_PENDING_QUEUE` y arranca el siguiente elemento. Esta regla protege la
continuidad de un programa tras estados transitorios entre sectores.

Las entradas activas de `IrrigationEngineService` estan protegidas por una
exclusion mutua interna. `startManual`, `startProgram`, `stopManual`,
`recover` y `tick` no deben intercalarse, porque todos leen snapshot y despues
aplican planes multi-paso sobre hardware y `appStateV2.engine`. Si el tick
coincide con otra operacion activa, se salta ese ciclo con
`OPERATION_RUNNING`; el siguiente tick retomara el mantenimiento normal.

`engine-state-source.js` centraliza la eleccion de fuente del motor para los
lectores transversales. La regla es el modo de
`migrationControlV2.services.engine`: si `engine=SHADOW`, se leen Variables
Logic; si `engine=ACTIVE_COMPAT`, se lee `appStateV2.engine`. Health, Recovery,
SystemDevice e History usan esta regla para no cambiar su comportamiento actual
mientras el motor legacy siga activo.

Los avisos de inicio y fin de sector de Rama 2 usan Flow Cards nativas
`sector_started` y `sector_ended`. `EnginePlanExecutor` las dispara despues de
persistir `appStateV2.engine.lastSectorEvent` y solo cuando el motor usa
`stateBackend=appState`. En rollback/legacy, el backend `logic` conserva los
triggers `Irrigation.SectorStartTrigger` e `Irrigation.SectorEndTrigger`.
Los Flows legacy basados en Variables Logic quedan deshabilitados tras el
cutover del motor nativo.


2. Scripts

Irrigation.js

Responsabilidad:

Motor completo del sistema.

Funciones principales:

* start
* stop
* tick
* toggle
* sync
* status
* recover (recuperación manual tras confirmar externamente el hardware apagado)

Responsabilidades:

* gestión de cola
* control de relés
* persistencia
* watchdog
* generación del histórico
* emisión persistente de eventos de inicio y fin de sector
* aborto de ejecuciones obsoletas cuando el tick llega con más de dos minutos
  de retraso

No debe contener:

* lógica del programador
* lógica meteorológica
* lógica de presentación

⸻

IrrigationStatus.js

Responsabilidad:

Actualizar el dispositivo virtual “Sistema de Riego” utilizando información procedente de ESPHome.

La fuga se obtiene agregando los seis sensores “Fuga Línea”. Desde firmware
ESP32 `1.0.5`, esos sensores ignoran caudal durante `60s` despues del cierre de
cualquier rele para absorber caudal residual hidraulico sin ocultar fugas
sostenidas. El watchdog se proyecta desde la disponibilidad del dispositivo, el
sobrecalentamiento y el tiempo de loop; un loop superior a 200 ms se considera
alerta.

Desde firmware ESP32 `1.0.6`, el hardware tambien aplica una barrera local de
volumen maximo por sector: `300 L` en un mismo ciclo. Si se supera, el ESP32
cierra el rele de la linea y publica un error `irrigation.safety`. Homey solo
supervisa y notifica la incidencia; la decision de cierre vive en el firmware
por ser una proteccion fisica.

Las capacidades ESPHome se localizan por su significado funcional para evitar
depender de identificadores internos generados por la integración.

Nunca modifica:

* relés
* cola
* variables del motor

⸻

IrrigationHistory.js

Responsabilidad:

Proyectar el histórico persistido hacia el dispositivo virtual.

Características:

* idempotente
* sólo lectura sobre Irrigation.History
* evita duplicados mediante

Irrigation.HistoryLastProjectedId

⸻

IrrigationHealth.js

Responsabilidad:

* agregar telemetría genérica WARN/ERROR procedente de ESPHome;
* detectar desconexión, reinicio, sobrecalentamiento, memoria baja y loop lento;
* alertar de forma prioritaria si el motor queda en `ERROR` sin poder confirmar
  el cierre de una electroválvula o si se pierde el ESP32 durante un riego;
* proyectar incoherencias hidráulicas sin asumir qué componente físico falló;
* persistir `Irrigation.Health` antes de emitir `Irrigation.HealthTrigger`;
* actualizar el diagnóstico visible en “Sistema de Riego”.

Nunca modifica relés, cola ni estado del motor.

Flows asociados:

* `Riego - Supervisión hardware cada minuto`: ejecuta periódicamente
  `IrrigationHealth.js`.
* `Riego - Aviso de incidencia hardware`: reacciona al cambio de
  `Irrigation.HealthTrigger` y crea una notificación genérica. El detalle se
  consulta en el dispositivo “Sistema de Riego” o en `Irrigation.Health`.

Los avisos de seguridad del motor incluyen el sector activo cuando se conoce.
Se emiten mediante el mismo trigger de salud y tienen prioridad en el mensaje
sobre el resto de incidencias concurrentes.

⸻

RecoveryService

Responsabilidad:

* comprobar la disponibilidad del dispositivo ESPHome `Riego`;
* localizar de forma inequívoca la app ESPHome Controller;
* reiniciarla tras dos fallos consecutivos durante un riego o tres en reposo;
* aplicar 30 minutos de cooldown y un máximo de tres intentos por incidente;
* persistir el diagnóstico antes de emitir cada trigger de notificación.

No modifica relés, cola ni estado del motor. La acción `status` es de solo
lectura y la acción `check` realiza la supervisión y eventual recuperación.

Implementación:

* reside en `homey/app/lib/recovery-service.js`;
* se ejecuta internamente desde la app Homey nativa cada minuto;
* usa `homey:manager:api` y `HomeyAPI.createAppAPI` para leer dispositivos,
  apps y Variables Logic, y para reiniciar ESPHome Controller;
* conserva el mismo contrato persistente que `IrrigationRecovery.js`.

`IrrigationRecovery.js` queda sustituido por la app nativa para evitar el fallo
`Missing Scopes` al invocar `restartApp` desde HomeyScript.

⸻

3. Variables Logic

Motor

Irrigation.State

Estado del motor.

Valores:

IDLE
RUNNING
ERROR

⸻

Irrigation.ActiveSector

Sector actualmente activo.

⸻

Irrigation.StartTimestamp

Inicio del riego.

⸻

Irrigation.EndTimestamp

Hora prevista de finalización.

⸻

Irrigation.Source

Origen.

Valores actuales:

MANUAL
PROGRAM

⸻

Irrigation.StopReason

Valores:

none
manual
timeout
watchdog
error

⸻

Irrigation.Queue

Array JSON.

Ejemplo:

[
  {
    "id":"...",
    "sector":1,
    "duration":8,
    "source":"PROGRAM",
    "description":"Programa verano"
  }
]

⸻

Irrigation.History

Array JSON.

Cada elemento:

{
  "id":"",
  "sector":1,
  "source":"MANUAL",
  "reason":"timeout",
  "startTs":0,
  "plannedEndTs":0,
  "endTs":0,
  "plannedDurationMin":8,
  "durationRealMin":8,
  "liters":61.5
}

⸻

Irrigation.HistoryLastProjectedId

Utilizado por IrrigationHistory para evitar reprocesar un evento.

⸻

Irrigation.Health

JSON persistente con el estado agregado `OK`, `WARNING`, `ERROR` u `OFFLINE`,
las incidencias activas y la última telemetría procesada.

⸻

Irrigation.HealthEventMessage

Mensaje legible correspondiente a la última transición de salud.

⸻

Irrigation.HealthTrigger

Timestamp numérico actualizado únicamente ante una transición o un nuevo evento
ESPHome. Los Flows de aviso deben reaccionar a esta variable.

⸻

Irrigation.Recovery

Estado JSON del mecanismo de autorrecuperación. Conserva fallos consecutivos,
intentos, cooldown, resultado y los últimos veinte eventos.

`Irrigation.RecoveryMessage` contiene el último mensaje legible y
`Irrigation.RecoveryTrigger` señala un nuevo evento al Flow de notificación.

⸻

Irrigation.SectorStartMessage / Irrigation.SectorEndMessage

Mensajes persistidos por `Irrigation.js` después de confirmar la transición
correspondiente.

⸻

Irrigation.SectorStartTrigger / Irrigation.SectorEndTrigger

Timestamps técnicos emitidos después del mensaje. Los Flows
`Riego - Aviso inicio de sector` y `Riego - Aviso fin de sector` reaccionan a
ellos y consultan las condiciones de configuración expuestas por la app.

⸻

Irrigation.LastTickTimestamp

Timestamp de la última entrada real en `tick`. Permite distinguir un motor
activo de un motor que ha dejado de recibir mantenimiento periódico.

La parada es transaccional respecto al hardware: la cola no se descarta antes
de intentar apagar los relés. Si el dispositivo RAW rechaza el apagado, el
motor pasa a `ERROR`, la cola se cancela y se conserva el sector activo para
hacer visible la posible salida energizada.

⸻

Programador

ManagerSettings: schedulerConfig

JSON Object persistente privado de la aplicación.

Fuente de verdad de la configuración del programador automático.

Lo escribe y lee la aplicación Homey nativa del programador.

Lo interpreta el Scheduler interno de la aplicación.

No debe ser interpretado por Irrigation.js.

Campos principales:

* version
* enabled
* startTime
* intervalDays
* sectorDurations
* rainDelayUntil
* lastRunDate
* updatedTs
* notifySectorStart
* notifySectorEnd

`notifySectorStart` y `notifySectorEnd` son preferencias de interfaz gestionadas
desde los ajustes de la app. No forman parte de las decisiones del Scheduler ni
del estado operativo del motor. La app las expone mediante condiciones de Flow.

La pantalla de ajustes calcula de forma derivada la hora estimada de fin como
`startTime + suma(sectorDurations)`. Este dato no se persiste. Se actualiza con
cada cambio de hora o duración y señala cuando el resultado cae en otro día.

La pantalla conserva una instantánea normalizada de la última configuración
cargada o guardada. El botón Guardar sólo se habilita cuando el formulario
difiere de esa instantánea. Con cambios pendientes se bloquean temporalmente las
acciones Rain Delay y el navegador solicita confirmación antes de abandonar la
página. Como el diálogo de ajustes de Homey destruye su iframe sin emitir
`beforeunload`, la pérdida de foco muestra además un aviso explícito de Homey.

⸻

Irrigation.Scheduler.NextRunTimestamp

Timestamp informativo del próximo riego automático.

No es fuente de verdad.

⸻

Irrigation.Scheduler.Status

Estado visible del programador.

Valores:

DISABLED
READY
RAIN_DELAY
INVALID_CONFIG
ERROR

⸻

Irrigation.Scheduler.LastDecisionTs

Última evaluación realizada por el Scheduler.

Uso diagnóstico.

⸻

Irrigation.Scheduler.LastMessage

Último mensaje informativo del programador o del Scheduler.

No debe contener estado funcional imprescindible.

⸻

4. Dispositivos

ESPHome

Nombre:

Riego

Responsabilidad:

Hardware.

Incluye:

* relés
* litros ciclo
* sensores
* watchdog

Nunca contiene lógica.

`Riego_Homey.yaml` fija `build_path` en
`/private/tmp/esphome-riego-build`. ESPHome/PlatformIO 2026 rechaza rutas de
build con espacios y el repositorio está en `Homey Irrigation System`; por eso
los artefactos de compilación se generan fuera del árbol del repo. Es una ruta
temporal: puede borrarse y ESPHome la regenerará en la siguiente compilación.

Los scripts locales `esphome-dashboard.sh` y `esphome-dashboard-nav.sh`
arrancan el dashboard con `$HOME/.local/bin/esphome`, la instalación gestionada
por `pipx`. No deben depender del `PATH`, para evitar que un entorno Python
antiguo lance clientes `ESPHome Logs` obsoletos. `stop_esphome_dashboard.sh`
detiene tanto el proceso web del dashboard como posibles hijos
`--dashboard run` asociados a `Riego_Homey.yaml`.

Cada relé incorpora una barrera local de 35 minutos. Si Homey pierde la
comunicación o deja de ejecutar el tick, ESPHome fuerza el apagado y registra
un error `irrigation.safety`. Es protección de hardware, no programación de
riego. Desde firmware `1.0.4`, esta barrera se ejecuta mediante un script
cancelable/reiniciable por línea: se inicia al encender el relé y se cancela al
apagarlo. No debe volver a implementarse como un `delay` directo dentro de
`on_turn_on`, porque las pruebas manuales cortas pueden dejar temporizadores
antiguos vivos y provocar falsos cortes en activaciones posteriores.

Durante la fase de instalación hidráulica, la sustitución ESPHome
`flow_fault_detection_enabled` puede mantenerse en `false` para evitar falsos
avisos `irrigation.hardware` de "relé activo sin caudal". Debe volver a `true`
cuando tuberías y caudalímetros estén operativos.

El sensor ambiental es un DHT20 AZ-Delivery conectado por I2C en el bus estándar
del ESP32: SDA GPIO21 y SCL GPIO22, alimentado a 3.3V con masa común. ESPHome lo
declara mediante `platform: aht10`, `variant: AHT20`, `address: 0x38`. Para
liberar el bus I2C, los relés L5 y L6 quedan cableados en GPIO23 y GPIO13
respectivamente. Los nombres publicados `Temperatura Riego` y `Humedad Riego`
se conservan para minimizar impacto en Homey.

La protección térmica usa `Temperatura Riego + temp_box_offset_c` como
temperatura estimada del chip cuando el DHT20 tiene lectura válida. El sensor
`ESP Internal Temp` queda como respaldo si el DHT20 falla o aún no ha publicado
valor. El umbral operativo vuelve a 85°C sobre esa estimación, con histéresis
de 5°C.

El capturador genérico `logger.on_message` publica WARN/ERROR accionables hacia
Homey, pero filtra mensajes administrativos como `cleared Warning flag` para no
sobrescribir `ESP Último error` con recuperaciones internas de componentes.
También ignora warnings `api.connection` cuyo mensaje contiene `ESPHome Logs`,
porque proceden del visor local de logs/dashboard y no representan una
incidencia del riego ni de la integración ESPHome Controller.

Durante el diagnóstico de desconexiones de ESPHome Controller, los eventos
`api.on_client_connected` y `api.on_client_disconnected` registran
`client_info` y `client_address` con el tag `irrigation.api`. El text sensor
diagnóstico `ESP Último cliente API` conserva el último cliente conectado o
desconectado para identificar si una conexión procede de Homey, del dashboard
local o de un cliente `esphome logs` antiguo.

El firmware publica además los text sensors diagnósticos `ESP Firmware Version`
y `ESP Hardware Contract`. El primero identifica la build del componente ESP32;
el segundo publica el contrato funcional en formato
`irrigation-hw-api@<version>`. La app Homey y los HomeyScripts deben comprobar
compatibilidad contra el contrato, no contra una versión idéntica de firmware.

⸻

Versionado y release

La fuente de verdad de versiones y contratos está en `release/components.json`.
Cada componente declara:

* `version`: versión propia del componente;
* `provides`: contratos que publica;
* `requires`: contratos que necesita de otros componentes;
* `sourcePaths`: ficheros que forman parte de su huella de release;
* artefacto opcional si el componente genera un binario/paquete.

Una release liberada siempre es una release de sistema: debe contener o
referenciar de forma verificable todos los artefactos desplegables necesarios
para reconstruir el sistema, aunque solo haya cambiado uno de ellos. Como
mínimo, toda release debe registrar artefacto Homey y binario ESP32 compatible
con versión y SHA256. No obliga a subir la versión ni recompilar componentes
que no han cambiado. Si el firmware ESP32 sigue siendo compatible y su binario
ya fue validado, una nueva release de la app puede reutilizar ese mismo
artefacto mediante su versión y SHA256. Si solo cambia el binario ESP32, la
release debe igualmente incluir o referenciar el artefacto Homey compatible.

La herramienta local:

```bash
node tools/release/prepare-release.mjs --system-release v1.0.0
```

genera `release-manifest.json` y `SHA256SUMS.txt` en
`dist/releases/<release>/`. Si existe el binario ESPHome en la ruta declarada
por `release/components.json`, lo copia como artefacto de release. También se
puede pasar explícitamente con `--esp32-bin`. Ese mismo `.ota.bin` debe ser el
que se suba al ESP32 mediante `esphome upload ... --file` para garantizar que el
artefacto versionado y el desplegado son idénticos.

La app Homey se empaqueta con:

```bash
node tools/release/build-homey-app.mjs
```

Para Rama 2 debe indicarse el componente explicito:

```bash
node tools/release/build-homey-app.mjs \
  --component homeyAppV2 \
  --out-dir dist/artifacts/homey-app-v2
```

El script comprueba que `package.json`, `app.json` y
`release/components.json` declaran la misma versión de app, ejecuta
`npm run validate`, `npm test`, `npx homey app build` y empaqueta la carpeta
preprocesada `.homeybuild` con el mismo formato `tar.gz` usado por el CLI de
Homey al instalar. El `.tgz` resultante representa la build de Homey que debe
subirse a GitHub Releases.

Para instalar exactamente ese mismo artefacto en Homey:

```bash
node tools/release/install-homey-app-artifact.mjs \
  --artifact dist/artifacts/homey-app/homey-irrigation-app-0.1.0.tgz
```

Para Rama 2:

```bash
node tools/release/install-homey-app-artifact.mjs \
  --artifact dist/artifacts/homey-app-v2/homey-irrigation-app-v2-2.0.1.tgz \
  --app-dir homey/app-v2
```

No usar `homey app install` ni `npx homey app install --skip-build` para liberar
versiones. `homey app install` queda reservado a emergencias de diagnóstico y,
si se usa, debe rehacerse inmediatamente la release formal: subir versión,
construir artefacto, instalar el artefacto exacto y registrar el manifest. En
la versión actual del CLI, `--skip-build` valida contra `.homeybuild` pero
empaqueta la ruta raíz de la app, por lo que no representa exactamente el
artefacto generado.

Una release Rama 2 donde cambia la app pero no cambia ESP32 se registra con:

```bash
node tools/release/prepare-release.mjs \
  --system-release v2.0.1 \
  --homey-app-v2-artifact dist/artifacts/homey-app-v2/homey-irrigation-app-v2-2.0.1.tgz \
  --esp32-bin dist/releases/v1.0.1/riego-esp32-1.0.0.ota.bin
```

Aunque el firmware ESP32 no cambie, una release de sistema Rama 2 debe incluir
el binario ESP32 compatible o referenciarlo mediante `--esp32-bin`. Usar
`--no-esp32-artifact` solo es aceptable para builds parciales de diagnostico,
no para una release liberada.

Despues de validar e instalar una release, el cierre obligatorio incluye subir
a GitHub el codigo, las herramientas, la documentacion y los entregables de esa
version. La release no se considera cerrada mientras el commit correspondiente
no este publicado en `origin/main` y contenga el directorio
`dist/releases/<version>` con su manifest, checksums, artefacto Homey y binario
ESP32 compatible.

De forma simetrica, si solo cambia ESP32, debe generarse la release con el
nuevo `--esp32-bin` y el artefacto Homey compatible mediante
`--homey-app-v2-artifact`. No liberar binarios ESP32 sueltos fuera de un
manifest de sistema.

Tras instalar, las llamadas a `/migration/control` deben hacerse
secuencialmente. No paralelizar cambios de modo porque todos actualizan la
misma clave `migrationControlV2` en ManagerSettings.

Los HomeyScripts se empaquetan con:

```bash
node tools/release/build-homey-scripts.mjs
```

La herramienta comprueba sintaxis con `node -c`, copia los scripts declarados
en `release/components.json` y genera un `homey-scripts-manifest.json` interno
con versión, contratos y SHA256 por fichero. Las cabeceras de comentario de
cada script deben mantenerse sincronizadas con `homey-scripts@<version>` y
`irrigation-scripts-api@<version>`. Este artefacto aporta trazabilidad local;
la verificación automática contra los scripts realmente subidos a Homey se
implementa como paso posterior.

El mapeo explícito local→Homey reside en `release/homey-scripts.json`. Cada
entrada declara `name` como nombre funcional local, `remoteName` como nombre
visible en Homey y `homeyScriptId` como identificador real del script remoto.
Ninguna herramienta debe inventar IDs ni resolverlos por nombre si existe
riesgo de ambigüedad.

La herramienta:

```bash
node tools/release/check-homey-scripts.mjs expected
```

genera la huella esperada de los scripts locales. La comparación contra Homey se
hace con:

```bash
node tools/release/check-homey-scripts.mjs verify --remote-file remote-homey-scripts.json
```

El fichero remoto debe incluir `content` o `sha256` por script y, como mínimo,
una clave de correspondencia: `homeyScriptId`, `remoteName` o `name`. La
comparación prioriza `homeyScriptId`, después `remoteName` y por último `name`.
Los estados posibles son `OK`, `MISSING`, `DRIFT` y `EXTRA`. Hasta automatizar
la extracción desde Homey, este mecanismo permite verificar de forma
determinista una exportación obtenida por navegador/API.

El criterio de discrepancias es:

* `OK`: todos los contratos requeridos existen y están dentro de rango;
* `WARNING`: los contratos son compatibles pero la build desplegada no coincide
  exactamente con el manifest validado;
* `ERROR`: falta un contrato, el nombre no coincide o la versión está fuera de
  rango.

⸻

Riego Manual

Interfaz manual.

El usuario sólo inicia riegos.

No contiene estado del motor.

⸻

Sistema de Riego

Representación del estado interno.

Incluye:

* estado
* sector
* cola
* origen
* tiempo restante
* trigger histórico

⸻

Histórico de Riego

Representación agregada.

No calcula datos.

Sólo presenta información persistida.

⸻

Programador

Será proporcionado por una aplicación Homey nativa.

Su responsabilidad será:

* almacenar configuración
* mostrar el próximo riego
* mostrar el estado del programador
* gestionar Rain Delay desde la interfaz

Nunca abrir relés.

Nunca modificar Irrigation.Queue.

Nunca modificar el estado del motor.

⸻

App Homey nativa

Ruta:

homey/app

Responsabilidad:

* ofrecer una interfaz moderna de configuración;
* validar schedulerConfig;
* persistir la configuración en ManagerSettings;
* proyectar estado informativo del programador;
* exponer un dispositivo "Programador de Riego";
* emitir una solicitud versionada mediante un Flow Trigger;
* supervisar la integración ESPHome Controller y reiniciarla cuando proceda,
  sin controlar relés, motor ni cola.

El trigger se identifica como program_requested y publica una etiqueta local de texto llamada request. El Flow debe entregar esa etiqueta a Irrigation.js mediante la tarjeta HomeyScript "Ejecutar un script con un argumento".

Flow instalado en Homey Pro:

* nombre: Riego programador - solicitud;
* id: e13d0fd1-8ad5-4cef-a210-dd843766e0a8;
* trigger: program_requested;
* acción: ejecutar Irrigation System con el argumento [[request]];
* estado: habilitado tras superar la prueba física controlada del puente completo.

El Flow debe permanecer habilitado para que las solicitudes válidas del Scheduler alcancen Irrigation.js. La configuración del programador puede mantenerse deshabilitada independientemente desde la app.

Flow de supervisión instalado en Homey Pro:

* nombre: Riego - Supervisión hardware cada minuto;
* ejecuta únicamente `IrrigationHealth.js`;
* ya no ejecuta `IrrigationRecovery.js`, porque Recovery reside en la app
  nativa y corre con timer interno.

No debe:

* controlar relés;
* modificar Irrigation.Queue;
* modificar Irrigation.State;
* sustituir Irrigation.js;
* contener lógica de ejecución del programa.

La API interna de la app puede guardar configuración y Rain Delay.

La decisión temporal corresponderá al Scheduler de la aplicación. La validación de la solicitud, la cola y la ejecución seguirán correspondiendo a Irrigation.js.

⸻

5. Flows

Los Flows deben ser extremadamente simples.

Nunca deben contener lógica.

Su función es:

* lanzar scripts
* reaccionar a eventos

Toda decisión pertenece a Homey Scripts.

⸻

6. Comunicación entre scripts

Los scripts nunca se llaman entre sí.

Se comunican mediante:

Logic Variables

y

Device Capability Trigger

No utilizar:

run HomeyScript

como mecanismo habitual de comunicación.

⸻

7. Contrato del motor

Sólo Irrigation.js puede:

* modificar relés
* modificar cola
* cambiar el estado del motor

Ningún otro componente debe hacerlo.

⸻

8. Scheduler

Responsabilidad:

Construir una solicitud de programa con una cola propuesta.

Leer schedulerConfig desde ManagerSettings.

Actualizar las proyecciones informativas de la interfaz.

Nunca:

* abrir relés
* cerrar relés
* leer Device Capabilities como fuente de verdad
* modificar directamente Irrigation.Queue

Flujo:

Configuración
↓
Scheduler
↓
Flow Trigger con solicitud JSON
↓
HomeyScript con argumento
↓
Irrigation.js
↓
Motor

Implementación:

* reside en homey/app/lib/scheduler.js;
* evalúa la configuración cada 30 segundos;
* usa la zona horaria configurada en Homey;
* evita evaluaciones simultáneas;
* excluye sectores con duración 0;
* emite program_requested y conserva una pendingRequest hasta confirmar el
  arranque real del motor mediante Variables Logic;
* persiste lastRunDate sólo tras confirmar que Irrigation.js ha iniciado o
  registrado un riego SCHEDULER;
* conserva la cadencia de intervalDays aunque Homey haya estado detenido;
* Rain Delay omite cualquier inicio programado anterior a rainDelayUntil.

⸻

9. Principios

Siempre cumplir:

✓ Un único dueño del hardware.

✓ Persistencia antes que interfaz.

✓ Scripts idempotentes.

✓ Flows sin lógica.

✓ Comunicación mediante eventos.

✓ Los dispositivos virtuales representan estado; no implementan lógica.

✓ El ESP32 ejecuta órdenes; nunca toma decisiones.

⸻

10. Pendientes

* Programador.
* Rain Delay.
* Programas múltiples.
* Meteorología.
* Optimización estacional.
* IA de riego.
* Alertas por anomalías.
* Dashboard de consumo.
* Exportación del histórico.
