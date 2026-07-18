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
      locales/

Las seis líneas ESPHome se instancian desde `riego/linea.yaml`. Cada instancia
recibe `line`, `flow_pin` y `relay_pin` desde la sección `packages` de
`Riego_Homey.yaml`. El paquete común conserva IDs y nombres distintos por línea
mediante sustituciones, evitando mantener seis copias de la misma lógica.


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

La fuga se obtiene agregando los seis sensores “Fuga Línea”. El watchdog se
proyecta desde la disponibilidad del dispositivo, el sobrecalentamiento y el
tiempo de loop; un loop superior a 200 ms se considera alerta.

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
riego.

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

Una release de sistema es una combinación validada de componentes. No obliga a
subir la versión ni recompilar componentes que no han cambiado. Si el firmware
ESP32 sigue siendo compatible y su binario ya fue validado, una nueva release de
la app puede referenciar ese mismo artefacto mediante su versión y SHA256.

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

El script comprueba que `homey/app/package.json`, `homey/app/app.json` y
`release/components.json` declaran la misma versión de app, ejecuta
`npm run validate`, `npm test`, `npx homey app build` y comprime la carpeta
preprocesada `homey/app/.homeybuild`. El zip resultante representa la build de
Homey que debe subirse a GitHub Releases. Para instalar exactamente esa misma
build en Homey, ejecutar `npx homey app install --skip-build` desde
`homey/app` inmediatamente después de generar el artefacto, evitando que el CLI
vuelva a construir otra salida distinta.

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
