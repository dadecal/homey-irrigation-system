PROJECT_STATUS.md

Sistema de Riego ESP32 + Homey

Estado del proyecto

Última actualización: 25 de agosto de 2026

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
Firmware ESPHome	✅ Finalizado
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
Aplicación Homey nativa Rama 2	✅ Activa v2.0.11
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

✅ Instalada desde artefacto release v2.0.11

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
