PROJECT_STATUS.md

Sistema de Riego ESP32 + Homey

Estado del proyecto

Última actualización: 29 de agosto de 2026

⸻

Resumen ejecutivo

El proyecto dispone actualmente de un sistema Rama 2 operativo basado en una
app Homey nativa completa y un controlador ESP32 con ESPHome.

La Rama 1 basada en HomeyScripts queda congelada como rollback. La Rama 2 es la
generacion activa y usa ManagerSettings como fuente de verdad interna.

⸻

Estado general

Módulo	Estado
Arquitectura	✅ Finalizada
Firmware ESPHome	✅ Finalizado v1.0.6
Integración ESPHome ↔ Homey	✅ Finalizada
Motor de riego	✅ Finalizado
Cola de riego	✅ Finalizada
Recuperación de estado	✅ Finalizada
Watchdog	✅ Finalizado
Dispositivo “Sistema de Riego”	✅ Finalizado
Dispositivo “Riego Manual”	✅ Finalizado
Histórico de riego	✅ Finalizado
Sincronización sensores	✅ Finalizada
Persistencia	✅ Finalizada
Aplicación Homey nativa Rama 2	✅ Activa v2.0.16
Scheduler	✅ Finalizado
Programador	✅ Finalizado
Rain Delay	✅ Finalizado
Meteorología	📋 Futuro
IA de optimización	📋 Futuro

⸻

Componentes existentes

Actualmente existen los siguientes componentes principales.

Firmware

ESP32 + ESPHome

Responsabilidad:

Hardware.

Estado:

✅ Firmware `1.0.6` instalado por OTA desde `dist/releases/v2.0.21`.

La versión `1.0.1` introduce calibración de caudal por sector. S1 queda
provisionalmente en `990 pulsos/L` tras observar `72.76 L` en 5 minutos con el
factor anterior `396 pulsos/L`. S2-S6 conservan `396 pulsos/L` hasta medición
física propia. El contrato hardware sigue siendo `irrigation-hw-api@1.0.0`.

La versión `1.0.2` reduce la ventana de `pulse_counter` de `10s` a `1s` y
espera `1200ms` al cerrar una linea antes de calcular litros de ciclo. Esto
permite pruebas de calibracion cortas con recipientes pequenos sin perder
pulsos por quedar dentro de una ventana de publicacion demasiado larga.

La versión `1.0.3` calibra S3 a `286 pulsos/L` tras una prueba fisica con
`11 L` reales y `7.952 L` reportados con el factor anterior `396 pulsos/L`.

La versión `1.0.4` corrige la barrera local de tiempo maximo de rele activo:
el temporizador de seguridad pasa a ser un script cancelable/reiniciable por
linea. Asi una prueba manual corta no puede ser interrumpida por un temporizador
antiguo heredado de una activacion previa.

La versión `1.0.5` aplica provisionalmente la calibracion de S1
(`990 pulsos/L`) a los seis sectores y reduce falsos positivos de fuga
ignorando la deteccion durante `60s` despues del cierre de cualquier rele.

La versión `1.0.6` anade una barrera local de volumen maximo por sector: si un
riego supera `300 L` en una misma linea, el ESP32 registra
`irrigation.safety` y fuerza el cierre del rele como fuga probable.

⸻

Homey Scripts Rama 1

Irrigation.js

Estado:

✅ Estable / rollback

Responsabilidad:

Motor del sistema.

⸻

IrrigationStatus.js

Estado:

✅ Estable

Responsabilidad:

Sincronización de sensores.

⸻

IrrigationHistory.js

Estado:

✅ Estable

Responsabilidad:

Proyección del histórico.

⸻

Aplicación Homey nativa Rama 2

Estado:

✅ Instalada desde artefacto release v2.0.17

Release activa:

`v2.0.11` mantiene la separacion tecnica de Rama 2 respecto a Rama 1. La app ya
no referencia codigo, artefactos ni Variables Logic V1 como fallback: el motor
nativo, Health, History, Recovery, el device manual v2 y la proyeccion de
sistema usan `appStateV2` y devices nativos. `StatusSyncService` queda retirado.
La release corrige la recuperacion ante perdida de ESPHome Controller/RAW
durante un riego: conserva la cola pendiente, deja el motor en recuperacion
asistida y permite reanudar o cancelar desde la pagina de configuracion.
Tambien envia notificaciones Homey para incidencias accionables de salud,
ademas del trigger `health_transition`. La release incluye de nuevo el binario
ESP32 compatible
`riego-esp32-1.0.0.ota.bin`, sin cambios de firmware. Los devices V1
`Riego manual`, `Sistema de Riego` e `Historico de Riego` ya fueron eliminados
de Homey; los Flows V1/deshabilitados de riego tambien han sido eliminados.
Permanecen solo los tres devices v2 en la zona `Riego` y los cuatro Flows v2
activos de notificacion. Homey Pro confirma `com.dadecal.irrigation.v2`
`version=2.0.11`, `enabled=true`, `state=running`.

`v2.0.12` corrige el caso observado el 25 de agosto de 2026 en el que ESPHome
Controller estaba disponible para lectura pero rechazaba comandos con
`Cannot send command: client not connected` justo al iniciar el programa. El
motor vuelve a `IDLE` sin marcar la fecha como regada, el scheduler aplaza el
arranque, notifica la incidencia y solicita a `RecoveryService` un reinicio
seguro de ESPHome Controller con motor en reposo y reles apagados. Release
generada e instalada desde `dist/releases/v2.0.12`, con artefacto Homey v2.0.12
y binario ESP32 compatible sin cambios. Homey Pro confirma
`com.dadecal.irrigation.v2` `version=2.0.12`, `enabled=true`, `state=running`;
tras la instalacion el motor queda `IDLE`, sector `0`, cola `0`, sin
interrupcion y sin reles activos.

`v2.0.14` corrige la captura de litros al cerrar un sector. ESPHome publica el
total final de `Litros ciclo actual` en `on_turn_off`; por tanto, el motor
nativo apaga primero el rele, espera la publicacion final y solo despues lee
litros, persiste historico y emite el evento de fin de sector. Esta release
repara el caso observado el 26 de agosto de 2026: S1 manual de 5 minutos habia
regado correctamente y el RAW mostraba `72.76 L`, pero el historico se habia
guardado con `0 L` por leer antes del cierre efectivo. Tambien reconcilia las
capacidades acumuladas del historico nativo desde la ultima proyeccion
persistida en `appStateV2`, evitando que una reparacion parcial deje litros,
conteo o duracion acumulada desfasados.

`v2.0.15` es una release de sistema sin cambios de app: mantiene
`homeyAppV2@2.0.14` e instala firmware ESP32 `1.0.1`. La OTA se completa
correctamente contra `192.168.2.7`; Homey confirma el dispositivo RAW `Riego`
disponible, firmware `1.0.1`, contrato `irrigation-hw-api@1.0.0` y seis reles
apagados.

`v2.0.16` instala `homeyAppV2@2.0.15` y firmware ESP32 `1.0.2`. La app solicita
`RecoveryService` tambien ante fallos de arranque manual por
`CONTROLLER_COMMAND_UNAVAILABLE`, siempre con motor en reposo y reles apagados,
y espera `2000ms` tras apagar el rele antes de leer litros finales. El firmware
publica pulsos cada `1s` y espera `1200ms` antes de calcular litros en
`on_turn_off`. Release generada en `dist/releases/v2.0.16`; app instalada desde
artefacto exacto y OTA aplicada desde el binario registrado. ESPHome logs
confirman build `2026-08-27 20:23:46 +0200` y reinicio por `esphome.ota`;
Homey confirma RAW disponible, contrato hardware correcto y seis reles apagados.

`v2.0.17` instala `homeyAppV2@2.0.16` y mantiene firmware ESP32 `1.0.2`. Corrige
la carrera observada en pruebas cortas de calibracion: despues de apagar el
rele, si la primera lectura de litros finales sigue siendo `0`, el motor
reintenta durante una ventana corta antes de persistir historico y emitir el
evento de fin de sector. El firmware ya publicaba correctamente el consumo; la
app podia leer antes de que Homey expusiera la actualizacion recibida desde
ESPHome Controller.

`v2.0.18` mantiene `homeyAppV2@2.0.16` e instala firmware ESP32 `1.0.3`. El
unico cambio funcional es la calibracion de S3 a `286 pulsos/L`, calculada con
la medida fisica `11 L reales / 7.952 L reportados`.

`v2.0.19` mantiene `homeyAppV2@2.0.16` e instala firmware ESP32 `1.0.4`.
Corrige falsos disparos `irrigation.safety` durante pruebas manuales cortas:
la proteccion local de `35 min` se cancela al apagar el rele y se reinicia en
cada nuevo encendido.

`v2.0.20` mantiene `homeyAppV2@2.0.16` e instala firmware ESP32 `1.0.5`.
Aplica `990 pulsos/L` a S1-S6 y anade una ventana de gracia global de `60s`
tras cerrar cualquier rele antes de considerar fuga por caudal residual. Release
generada en `dist/releases/v2.0.20`; OTA instalada y validada en Homey.

`v2.0.21` mantiene `homeyAppV2@2.0.16` e instala firmware ESP32 `1.0.6`.
Anade un watchdog local de volumen por linea: mientras el rele esta activo,
el ESP32 calcula los litros del ciclo desde pulsos acumulados y fuerza el cierre
si se superan `300 L`, registrando una incidencia `irrigation.safety`.

Responsabilidad:

* ofrecer la interfaz de configuración;
* persistir la configuración del programador;
* calcular el próximo riego;
* aplicar y cancelar Rain Delay;
* ejecutar Scheduler, Health, History, Recovery y motor nativo;
* mantener `StatusSyncService` retirado sin timer ni lecturas duplicadas;
* controlar relés exclusivamente desde `IrrigationEngineService` cuando
  `engine=ACTIVE_COMPAT`;
* registrar diagnostico operativo en `appStateV2`.

Estado activo: todos los servicios Rama 2 estan en `ACTIVE_COMPAT`.

⸻

Estado de la arquitectura

La arquitectura actual se considera cerrada.

No deben realizarse cambios estructurales salvo petición explícita.

Principios ya consolidados:

* Un único propietario del hardware.
* Persistencia antes que interfaz.
* Comunicación mediante eventos.
* Scripts desacoplados.
* Flows sin lógica.
* Variables Logic como compatibilidad/observabilidad legacy.
* ManagerSettings `appStateV2` como fuente de verdad interna de Rama 2.

⸻

Funcionalidades disponibles

Actualmente el sistema permite:

* iniciar un riego manual;
* detener un riego;
* controlar una cola de riego;
* registrar el consumo de agua;
* mantener un histórico persistente;
* monitorizar sensores;
* recuperar el estado del motor;
* detectar inconsistencias mediante watchdog;
* configurar hora, intervalo y duración de seis sectores;
* aplicar Rain Delay de 24, 48 o 72 horas y cancelarlo;
* calcular y mostrar el próximo riego;
* generar solicitudes versionadas de programa;
* ejecutar riegos desde el motor nativo Rama 2;
* bloquear arranques programados inseguros mediante preflight;
* diagnosticar decisiones con `/diagnostics/status`.

⸻

Funcionalidades pendientes

Queda pendiente monitorizar el primer riego programado completo tras la release
Rama 2 v2.0.2.

⸻

Mejoras futuras

No forman parte de la versión actual.

* Integración meteorológica.
* Ajuste automático de duración.
* Optimización estacional.
* IA de planificación.
* Predicción de consumo.
* Dashboard avanzado.
* Exportación de históricos.

⸻

Problemas conocidos

Tick del motor

El motor utiliza un tick periódico de un minuto.

Consecuencia:

Los riegos manuales de un minuto pueden reflejar su finalización en la interfaz con un retraso máximo aproximado de un minuto.

Esta limitación es conocida y aceptada.

No afecta al funcionamiento interno ni a la generación del histórico.

⸻

Device Capabilities

Los identificadores internos de Device Capabilities pueden cambiar al recrear un campo.

No asumir que son permanentes.

⸻

Próximo objetivo

El siguiente objetivo es la estabilización operativa de Rama 2:

* observar las primeras ejecuciones automáticas;
* confirmar próximo riego, histórico y recuperación tras reinicio;
* confirmar que el preflight no bloquea falsos positivos y registra los
  bloqueos reales.

Los programas múltiples y las integraciones meteorológicas permanecen como evoluciones futuras.

⸻

Antes de comenzar cualquier modificación

Leer obligatoriamente:

1. AGENTS.md
2. Architecture.md
3. DeveloperGuide.md
4. DataModel.md

⸻

Criterio de estabilidad

Se considera que el núcleo del sistema está estabilizado.

Las futuras modificaciones deben orientarse a ampliar funcionalidades manteniendo la arquitectura existente.

Cualquier propuesta que implique modificar el modelo de comunicación entre componentes deberá justificarse previamente y ser aprobada antes de su implementación.
