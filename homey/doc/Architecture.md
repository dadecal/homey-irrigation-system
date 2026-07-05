Sistema de Riego ESP32 + ESPHome + Homey

Documento de Arquitectura

1. Objetivo del proyecto

El objetivo de este proyecto es desarrollar un sistema de riego doméstico inteligente basado en Homey como plataforma de automatización y un ESP32 ejecutando ESPHome como controlador físico de las electroválvulas y sensores.

El sistema debe permitir:

* Ejecución manual de riegos.
* Ejecución automática mediante programación.
* Registro histórico de todos los riegos.
* Supervisión permanente del estado del sistema.
* Integración futura con meteorología, sensores y algoritmos inteligentes de optimización del riego.

El diseño busca desacoplar completamente la lógica de negocio del hardware y de la interfaz de usuario.

⸻

2. Arquitectura general

La arquitectura está dividida en cuatro capas claramente diferenciadas.

                  Homey
        ┌──────────────────────┐
        │  Device Capabilities │
        │  (Interfaz usuario)  │
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │   Homey Scripts      │
        │ (Lógica de negocio)  │
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ Logic Variables       │
        │ Estado persistente    │
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ ESPHome + ESP32       │
        │ Hardware físico       │
        └──────────────────────┘

Cada capa tiene una responsabilidad única.

⸻

3. Integración con ESPHome

El ESP32 ejecuta ESPHome y está integrado con Homey mediante la integración oficial de ESPHome.

ESPHome expone al ecosistema Homey un único dispositivo denominado Riego.

Este dispositivo representa exclusivamente el hardware.

Incluye:

* 6 relés correspondientes a las 6 electroválvulas.
* 6 sensores de caudal (litros del ciclo).
* Sensor de temperatura del ESP32.
* Sensores de estado del hardware.
* Watchdog.
* Detección de fugas.

ESPHome no implementa ninguna lógica de negocio.

Nunca decide cuándo comenzar o terminar un riego.

Su única responsabilidad es:

* ejecutar órdenes recibidas desde Homey;
* exponer sensores;
* informar del estado del hardware.

⸻

4. Dispositivos virtuales Homey

Además del dispositivo físico ESPHome existen varios dispositivos virtuales.

Riego Manual

Interfaz utilizada por el usuario para iniciar un riego manual.

No contiene lógica.

Campos principales:

* Sector
* Duración
* ON/OFF
* Información
* Tiempo restante

⸻

Sistema de Riego

Representa el estado interno del motor.

Campos:

* Estado
* Sector activo
* Tiempo restante
* Cola pendiente
* Programa activo
* Último mensaje
* Trigger técnico de histórico

No controla hardware.

Es una representación del estado interno.

⸻

Histórico de Riego

Representa el histórico agregado del sistema.

Contiene:

* Último riego
* Último riego por sector
* Consumos acumulados
* Número de riegos
* Tiempo acumulado

Toda la información procede del motor.

Nunca genera datos propios.

⸻

Programador de Riego (pendiente)

Será una aplicación Homey nativa utilizada como interfaz de configuración del riego automático.

No ejecutará directamente ningún riego.

Su responsabilidad será:

* configurar hora de inicio;
* configurar intervalo de días;
* configurar duración de los sectores;
* configurar Rain Delay;
* mostrar el próximo riego;
* mostrar el estado del programador;
* persistir la configuración privada en ManagerSettings;
* construir la solicitud de riego cuando corresponda;
* emitir un Flow Trigger con la solicitud serializada.

El Programador de Riego no sustituye al motor.

No modifica relés.

No modifica directamente la cola de riego.

El Scheduler residirá dentro de la aplicación y nunca controlará hardware.

La comunicación con Irrigation.js se realizará mediante un Flow Trigger de la aplicación y la tarjeta HomeyScript "Ejecutar un script con un argumento". Irrigation.js seguirá siendo el único componente autorizado para validar y persistir la cola y arrancar el motor.

⸻

5. Homey Scripts

Actualmente existen cinco scripts principales.

Irrigation.js

Es el núcleo del sistema.

Responsabilidades:

* Control del estado del motor.
* Gestión de cola de riego.
* Activación de relés.
* Parada de relés.
* Watchdog.
* Persistencia del estado.
* Generación de eventos de histórico.

Es el único componente autorizado para modificar el dispositivo físico ESPHome.

Ningún otro script puede activar o desactivar relés.

⸻

IrrigationStatus.js

Responsabilidad:

Sincronizar información procedente de ESPHome con el dispositivo virtual “Sistema de Riego”.

Ejemplos:

* temperatura ambiente;
* temperatura ESP32;
* watchdog;
* fuga detectada;
* estado de conexión.

Nunca modifica el motor.

⸻

IrrigationHistory.js

Responsabilidad:

Actualizar el dispositivo “Histórico de Riego”.

Lee los eventos persistidos por Irrigation.js.

No consulta directamente el hardware salvo como mecanismo de respaldo.

Su ejecución es idempotente.

⸻

IrrigationRecovery.js

Responsabilidad:

* supervisar exclusivamente la disponibilidad de la integración ESPHome
  Controller;
* reiniciar esa aplicación tras fallos consecutivos y con límites de
  frecuencia;
* persistir y notificar el resultado de cada recuperación.

Nunca controla relés, motor ni cola. Es una medida provisional frente a
bloqueos de reconexión de la integración y no sustituye las protecciones del
ESP32.

⸻

6. Variables Logic

Las Variables Logic constituyen el almacenamiento persistente del sistema.

Actualmente almacenan:

* Estado del motor.
* Cola de riego.
* Histórico de eventos.
* Configuración del programador.
* Sector activo.
* Hora de inicio.
* Hora prevista de fin.
* Origen.
* Motivo de parada.

Las Variables Logic son la fuente de verdad del sistema.

Los dispositivos virtuales son únicamente representaciones visuales.

⸻

7. Flows

Los Flows únicamente coordinan eventos.

No contienen lógica de negocio.

Actualmente existen Flows para:

* Tick del motor.
* Sincronización de sensores.
* Actualización del histórico.
* Arranque manual.

Toda decisión se toma dentro de Homey Scripts.

⸻

8. Principios de diseño

El proyecto sigue los siguientes principios.

Una única autoridad

Sólo Irrigation.js puede modificar el hardware.

⸻

Arquitectura orientada a eventos

Los componentes no se llaman entre sí.

La comunicación se realiza mediante:

* Variables Logic
* Device Capabilities
* Flows

⸻

Persistencia antes que interfaz

Todo evento se almacena primero.

Después se actualiza la interfaz.

⸻

Idempotencia

La ejecución repetida de un mismo script nunca debe producir efectos secundarios.

⸻

Desacoplamiento

La interfaz de usuario nunca contiene lógica.

El hardware nunca contiene lógica.

Toda la lógica reside en Homey Scripts.

⸻

9. Evolución prevista

Próximos módulos:

* Scheduler
* Rain Delay
* Programas múltiples
* Ajuste automático por meteorología
* Optimización inteligente de duración por estación
* Detección avanzada de anomalías
* Predicción de consumo de agua
* Integración con servicios meteorológicos

Todos estos módulos deberán reutilizar el motor existente sin modificar su arquitectura.
