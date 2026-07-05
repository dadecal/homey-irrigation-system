Sistema de Riego ESP32 + Homey

DataModel.md

Objetivo

Este documento define el modelo de datos compartido entre todos los componentes del sistema.

Constituye el contrato de comunicación entre:

* Irrigation.js
* IrrigationStatus.js
* IrrigationHistory.js
* Scheduler (futuro)
* Aplicación Homey nativa del programador
* Homey Flows
* Variables Logic

Las estructuras aquí definidas deben mantenerse compatibles entre versiones.

⸻

1. Variables Logic

Irrigation.State

Tipo

string

Valores posibles

IDLE
RUNNING
ERROR

Descripción

Estado actual del motor.

⸻

Irrigation.ActiveSector

Tipo

number

Valores

0

No existe riego activo.

1..6

Sector actualmente regando.

⸻

Irrigation.StartTimestamp

Tipo

number

Timestamp UNIX (ms).

Representa el instante real de comienzo del riego.

⸻

Irrigation.EndTimestamp

Tipo

number

Timestamp UNIX (ms).

Hora prevista de finalización.

⸻

Irrigation.Source

Tipo

string

Valores actuales

MANUAL
PROGRAM

Valores futuros permitidos

API
RAIN_DELAY
AUTOMATIC
TEST

⸻

Irrigation.StopReason

Tipo

string

Valores

none
manual
timeout
watchdog
error

⸻

Irrigation.LastTickTimestamp

Tipo `number`. Timestamp UNIX en milisegundos de la última ejecución de
`Irrigation.js` con acción `tick`. Es telemetría de supervisión y no sustituye
al estado del motor.

⸻

Irrigation.Health

Tipo

JSON Object serializado como string.

Estructura principal

```json
{
  "version": 1,
  "status": "WARNING",
  "updatedTs": 1783170000000,
  "issues": [],
  "lastEvent": null,
  "telemetry": {
    "lastEspSequence": 0,
    "uptimeSeconds": 0
  }
}
```

`status` admite `OK`, `WARNING`, `ERROR` y `OFFLINE`.

Las incidencias `ENGINE_STOP_UNCONFIRMED` y `ENGINE_CONTROLLER_OFFLINE`
indican respectivamente que el motor quedó en `ERROR` sin confirmar el cierre,
o que se perdió el controlador durante un riego. Incluyen `sector` cuando está
disponible y deben priorizarse en el mensaje de evento por su impacto físico.

⸻

Irrigation.HealthEventMessage

Tipo `string`. Resumen legible de la última transición.

⸻

Irrigation.HealthTrigger

Tipo `number`. Timestamp UNIX en milisegundos utilizado como trigger técnico.

⸻

Irrigation.Recovery

Tipo `JSON Object` serializado como string. Estado persistente y fuente de
verdad de `IrrigationRecovery.js`.

Campos principales:

* `consecutiveFailures`: comprobaciones consecutivas sin dispositivo;
* `incidentStartedTs`: comienzo del incidente actual;
* `attemptsInIncident`: reinicios solicitados durante el incidente;
* `lastRestartTs`: último reinicio, utilizado para el cooldown;
* `awaitingRecovery`: existe un reinicio pendiente de verificar;
* `exhaustedNotified`: evita repetir el aviso de intentos agotados;
* `lastRecoveryTs` y `lastMessage`;
* `events`: máximo veinte eventos, más reciente primero.

`Irrigation.RecoveryMessage` es un `string` legible y
`Irrigation.RecoveryTrigger` un timestamp numérico. El estado debe persistirse
antes de actualizar mensaje y trigger.

⸻

Irrigation.SectorStartMessage / Irrigation.SectorEndMessage

Tipo `string`. Mensaje legible del último evento de inicio o fin de sector.

⸻

Irrigation.SectorStartTrigger / Irrigation.SectorEndTrigger

Tipo `number`. Timestamp UNIX en milisegundos. El mensaje correspondiente debe
persistirse antes de actualizar el trigger.

Las preferencias `notifySectorStart` y `notifySectorEnd` pertenecen a
`schedulerConfig`, son booleanas y su valor inicial es `false`. La app las
proyecta como condiciones de Flow; `Irrigation.js` no las interpreta.

La hora estimada de fin mostrada por la app no forma parte del modelo
persistente. Se deriva de `startTime` y `sectorDurations`, evitando duplicar
estado calculable.

⸻

2. Cola de riego

Variable

Irrigation.Queue

Tipo

JSON Array

Ejemplo

[
  {
    "id": "1751196000000-a3f81c",
    "createdTs": 1751196000000,
    "sector": 1,
    "duration": 8,
    "source": "PROGRAM",
    "description": "Programa verano"
  },
  {
    "id": "1751196001000-c74ab2",
    "createdTs": 1751196001000,
    "sector": 2,
    "duration": 6,
    "source": "PROGRAM",
    "description": "Programa verano"
  }
]

Campo id

Identificador único.

Nunca debe reutilizarse.

⸻

Campo createdTs

Momento en que se añadió a la cola.

⸻

Campo sector

Valores válidos

1..6

⸻

Campo duration

Unidad

minutos

Valores

1..30

⸻

Campo source

Origen del elemento.

Ejemplos

MANUAL
PROGRAM

⸻

Campo description

Descripción libre utilizada únicamente para información.

No participa en la lógica.

⸻

3. Histórico persistente

Variable

Irrigation.History

Tipo

JSON Array

Elemento

{
  "id": "1751196480000-1",
  "sector": 1,
  "source": "MANUAL",
  "reason": "timeout",
  "startTs": 1751196420000,
  "plannedEndTs": 1751196480000,
  "endTs": 1751196480034,
  "plannedDurationMin": 1,
  "durationRealMin": 1,
  "liters": 12.6
}

⸻

id

Identificador único del evento.

Actualmente:

endTs-sector

Debe permanecer único.

⸻

sector

Valores

1..6

⸻

source

Origen del riego.

⸻

reason

Motivo de finalización.

Valores

manual
timeout
watchdog
error

⸻

startTs

Inicio real.

⸻

plannedEndTs

Hora prevista de finalización.

⸻

endTs

Hora real de finalización.

Puede diferir ligeramente de plannedEndTs.

⸻

plannedDurationMin

Duración planificada.

⸻

durationRealMin

Duración realmente ejecutada.

⸻

liters

Litros consumidos.

Unidad

L

⸻

4. Último histórico proyectado

Variable

Irrigation.HistoryLastProjectedId

Tipo

string

Utilizada por IrrigationHistory.js.

Permite evitar reprocesar el mismo evento varias veces.

⸻

5. Trigger técnico

Campo del dispositivo

Sistema de Riego

Nombre

HIS Trigger histórico

Tipo

Number

Uso

No almacena información funcional.

Se incrementa al finalizar cada riego para disparar el Flow que ejecuta IrrigationHistory.js.

Debe considerarse un mecanismo de señalización, no de persistencia.

⸻

6. Configuración del programador

La configuración del programador se almacena de forma persistente y privada en ManagerSettings de la aplicación Homey.

La aplicación Homey nativa actúa como interfaz de usuario para editar esta configuración.

El Scheduler interno de la aplicación será el único responsable de interpretar esta configuración para construir una solicitud de riego.

La aplicación no debe:

* abrir relés;
* cerrar relés;
* modificar Irrigation.Queue;
* modificar el estado del motor;
* ejecutar programas directamente;
* modificar Variables Logic del motor.

⸻

Setting

schedulerConfig

Tipo

JSON Object.

Fuente de verdad

Sí.

Descripción

Contiene la configuración funcional del programador.

Ejemplo

{
  "version": 1,
  "enabled": true,
  "startTime": "07:30",
  "intervalDays": 2,
  "sectorDurations": {
    "1": 8,
    "2": 6,
    "3": 6,
    "4": 7,
    "5": 5,
    "6": 8
  },
  "rainDelayUntil": 0,
  "lastRunDate": null,
  "updatedTs": 1751196000000
}

⸻

Campo version

Tipo

number

Valor inicial

1

Uso

Permite migraciones futuras manteniendo compatibilidad hacia atrás.

⸻

Campo enabled

Tipo

boolean

Descripción

Indica si el programador automático está activo.

Si enabled = false, el Scheduler no debe crear nuevas colas automáticas.

⸻

Campo startTime

Tipo

string

Formato

HH:mm

Ejemplo

07:30

Zona horaria

Europe/Madrid.

Descripción

Hora local prevista para iniciar el programa automático.

⸻

Campo intervalDays

Tipo

number

Valores

1..30

Descripción

Intervalo entre riegos automáticos.

1 = diario.

2 = días alternos.

⸻

Campo sectorDurations

Tipo

JSON Object

Claves válidas

"1"
"2"
"3"
"4"
"5"
"6"

Valores

number

Unidad

minutos

Rango

0..30

Descripción

Duración configurada para cada sector.

Un valor 0 significa que el sector queda excluido del programa automático.

Los sectores con duración mayor que 0 podrán convertirse en elementos de Irrigation.Queue por el Scheduler.

⸻

Campo rainDelayUntil

Tipo

number

Unidad

Timestamp UNIX en milisegundos.

Valores

0

No hay Rain Delay activo.

Timestamp futuro

El programador queda suspendido hasta ese instante.

Descripción

Durante un Rain Delay activo, el Scheduler no debe crear nuevas colas automáticas.

No debe detener un riego ya en curso.

Los inicios programados anteriores a rainDelayUntil se omiten. El siguiente riego será la primera fecha de la cadencia cuya hora de inicio sea igual o posterior al final del Rain Delay.

⸻

Campo lastRunDate

Tipo

string o null

Formato

YYYY-MM-DD

Descripción

Fecha local del último programa automático generado por el Scheduler.

Se utiliza para calcular intervalos de días de forma idempotente.

La aplicación Homey no debe actualizar este campo al guardar configuración.

El Scheduler lo persiste antes de emitir el Flow Trigger para impedir solicitudes duplicadas tras un reinicio.

⸻

Campo updatedTs

Tipo

number

Unidad

Timestamp UNIX en milisegundos.

Descripción

Momento de la última modificación de configuración realizada por la interfaz.

⸻

Proyección de la API de la aplicación

nextRunTs

Tipo

number

Fuente de verdad

No.

Descripción

Proyección informativa del próximo riego automático calculado a partir de schedulerConfig.

Será calculada por la aplicación y mostrada en su interfaz.

No se persiste y no debe utilizarse como sustituto de schedulerConfig.

Valores

0

No hay próximo riego calculado.

Timestamp futuro

Próximo riego previsto.

⸻

Proyección de la API de la aplicación

status

Tipo

string

Fuente de verdad

No.

Valores

DISABLED
READY
RAIN_DELAY
INVALID_CONFIG
ERROR

Descripción

Estado visible del programador.

Es una proyección para la interfaz de la aplicación.

La decisión funcional debe basarse en schedulerConfig.

⸻

Proyección interna futura

lastDecisionTs

Tipo

number

Fuente de verdad

No.

Descripción

Última vez que el Scheduler evaluó la configuración.

Sirve para diagnóstico.

No participa en la ejecución del motor.

⸻

Proyección de la API de la aplicación

message

Tipo

string

Fuente de verdad

No.

Descripción

Último mensaje informativo del programador o del Scheduler.

No debe contener estado funcional imprescindible.

⸻

7. Estado del motor

Durante un riego válido deben cumplirse simultáneamente:

State = RUNNING
ActiveSector = 1..6
StartTimestamp > 0
EndTimestamp > StartTimestamp

Cuando el motor está parado:

State = IDLE
ActiveSector = 0
EndTimestamp = 0

⸻

8. Restricciones

Nunca debe existir:

* más de un sector activo;
* más de un evento con el mismo id;
* un elemento de cola sin sector;
* un histórico sin timestamp;
* una configuración de programador con sectores fuera de 1..6;
* una configuración de programador con duración negativa;
* una configuración de programador con intervalDays menor que 1;
* una configuración de programador inválida que genere cola.

⸻

9. Compatibilidad futura

Las estructuras podrán ampliarse únicamente añadiendo nuevos campos.

Nunca deberán eliminarse ni cambiar el significado de los campos existentes.

Esto garantiza la compatibilidad entre:

* versiones del motor;
* histórico;
* scheduler;
* futuras aplicaciones Homey.

⸻

10. Convenciones

Tiempo

Todos los tiempos internos se representan mediante:

Unix Timestamp

en milisegundos.

⸻

Duraciones

Siempre en:

minutos

Para programación automática, una duración de 0 minutos significa sector excluido.

Para Irrigation.Queue, la duración mínima sigue siendo 1 minuto.

⸻

Volumen

Siempre en:

litros

⸻

Sectores

Numeración fija

1
2
3
4
5
6

Nunca utilizar índices base 0.

⸻

JSON

Toda comunicación estructurada entre scripts debe utilizar JSON serializado almacenado en Variables Logic.

La solicitud de la aplicación hacia Irrigation.js es la excepción explícita: utiliza JSON serializado como token de texto de un Flow Trigger y se entrega mediante la tarjeta HomeyScript con argumento.

Contrato de la solicitud:

{
  "version": 1,
  "requestId": "5b53a50c-1e6a-4ca0-9b04-3a1a20e6f15c",
  "requestedAt": 1751196000000,
  "source": "SCHEDULER",
  "queue": [
    { "sector": 1, "duration": 8 },
    { "sector": 2, "duration": 6 }
  ]
}

Reglas:

* requestId es único por solicitud;
* requestedAt es un timestamp UNIX en milisegundos;
* queue contiene entre 1 y 6 elementos;
* cada sector aparece como máximo una vez;
* sector está entre 1 y 6;
* duration es un número entero entre 1 y 30 minutos;
* Irrigation.js debe validar de nuevo la solicitud antes de modificar Irrigation.Queue.

No almacenar objetos JavaScript directamente.

⸻

11. Principios

El modelo de datos constituye el contrato del sistema.

Cualquier modificación del modelo deberá:

* mantener compatibilidad hacia atrás;
* actualizar esta documentación;
* validar que Irrigation.js, IrrigationHistory.js y el Scheduler de la aplicación continúan interpretando correctamente las estructuras definidas.
