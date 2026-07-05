PROJECT_STATUS.md

Sistema de Riego ESP32 + Homey

Estado del proyecto

Última actualización: 3 de julio de 2026

⸻

Resumen ejecutivo

El proyecto dispone actualmente de un motor de riego completamente funcional basado en Homey y un controlador ESP32 con ESPHome.

La arquitectura principal está consolidada y se considera estable.

Los próximos desarrollos se centrarán en nuevas funcionalidades, no en cambios estructurales del núcleo.

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
Aplicación Homey nativa	✅ Finalizada
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

Homey Scripts

Irrigation.js

Estado:

✅ Estable

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

Aplicación Homey nativa

Estado:

✅ Instalada, validada y estable

Responsabilidad:

* ofrecer la interfaz de configuración;
* persistir la configuración del programador;
* calcular el próximo riego;
* aplicar y cancelar Rain Delay;
* solicitar programas mediante el evento program_requested.

La aplicación no controla relés ni modifica el estado o la cola del motor.

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
* Variables Logic como fuente de verdad.

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
* ejecutar el puente App -> Flow -> Irrigation.js -> ESPHome.

⸻

Funcionalidades pendientes

No quedan funcionalidades pendientes de prioridad alta para el programa único actual.

La configuración real del horario y de las duraciones corresponde al usuario y permanece deshabilitada hasta que se complete desde la app.

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

El siguiente objetivo es la estabilización operativa:

* introducir la configuración real del jardín;
* observar las primeras ejecuciones automáticas;
* confirmar próximo riego, histórico y recuperación tras reinicio;
* mantener la configuración deshabilitada hasta completar estas comprobaciones.

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
