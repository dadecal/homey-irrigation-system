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

IrrigationRecovery.js

Responsabilidad:

* comprobar la disponibilidad del dispositivo ESPHome `Riego`;
* localizar de forma inequívoca la app ESPHome Controller;
* reiniciarla tras dos fallos consecutivos durante un riego o tres en reposo;
* aplicar 30 minutos de cooldown y un máximo de tres intentos por incidente;
* persistir el diagnóstico antes de emitir cada trigger de notificación.

No modifica relés, cola ni estado del motor. La acción `status` es de solo
lectura y la acción `check` realiza la supervisión y eventual recuperación.
El Flow periódico de supervisión ejecuta `check` después de
`IrrigationHealth.js`.

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

Cada relé incorpora una barrera local de 35 minutos. Si Homey pierde la
comunicación o deja de ejecutar el tick, ESPHome fuerza el apagado y registra
un error `irrigation.safety`. Es protección de hardware, no programación de
riego.

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
* emitir una solicitud versionada mediante un Flow Trigger.

El trigger se identifica como program_requested y publica una etiqueta local de texto llamada request. El Flow debe entregar esa etiqueta a Irrigation.js mediante la tarjeta HomeyScript "Ejecutar un script con un argumento".

Flow instalado en Homey Pro:

* nombre: Riego programador - solicitud;
* id: e13d0fd1-8ad5-4cef-a210-dd843766e0a8;
* trigger: program_requested;
* acción: ejecutar Irrigation System con el argumento [[request]];
* estado: habilitado tras superar la prueba física controlada del puente completo.

El Flow debe permanecer habilitado para que las solicitudes válidas del Scheduler alcancen Irrigation.js. La configuración del programador puede mantenerse deshabilitada independientemente desde la app.

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
* persiste lastRunDate antes de emitir program_requested;
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
