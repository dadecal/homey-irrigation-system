Sistema de Riego ESP32 + Homey

ESPHome.md

Objetivo

Este documento describe el diseño hardware y firmware del controlador físico de riego basado en ESP32 y ESPHome.

Debe mantenerse sincronizado con el fichero riego.yaml.

El objetivo es que cualquier desarrollador pueda comprender la arquitectura hardware, modificar el firmware con seguridad y mantener la compatibilidad con Homey.

⸻

1. Arquitectura

El sistema está dividido en dos niveles claramente diferenciados.

Nivel Hardware

Implementado mediante un ESP32 ejecutando ESPHome.

Responsabilidades:

* Controlar las electroválvulas.
* Leer los sensores.
* Publicar entidades mediante la API nativa de ESPHome.

El ESP32 no implementa ninguna lógica de negocio.

⸻

Nivel Software

Implementado mediante Homey.

Responsabilidades:

* Motor de riego.
* Programación.
* Histórico.
* Estado.
* Automatizaciones.
* Interfaz de usuario.

El firmware nunca decide cuándo debe comenzar o finalizar un riego.

⸻

2. Plataforma hardware

Controlador

ESP32 NodeMCU DevKitC V2

Microcontrolador:

ESP32-WROOM

Comunicación utilizada:

* WiFi
* API nativa ESPHome

No se utilizan:

* Bluetooth
* MQTT
* Web Server

⸻

3. Alimentación

El sistema está alimentado mediante una fuente de 5V.

Elementos alimentados:

* ESP32
* Módulo de relés
* Sensores Hall
* DHT20

Los sensores Hall trabajan a 5V.
El DHT20 se alimenta desde 3.3V para mantener el bus I2C en niveles seguros
para el ESP32. La masa es común con la fuente de 5V.

⸻

4. Electroválvulas

Número de sectores:

6

Cada sector dispone de un relé independiente.

El ESP32 permite activar cualquier combinación de relés.

La restricción de mantener un único sector activo simultáneamente pertenece exclusivamente al motor implementado en Homey (Irrigation.js).

⸻

5. Mapa de GPIO

Relés

Sector	Función	GPIO
S1	Relé sector 1	GPIO16
S2	Relé sector 2	GPIO17
S3	Relé sector 3	GPIO18
S4	Relé sector 4	GPIO19
S5	Relé sector 5	GPIO23
S6	Relé sector 6	GPIO13

⸻

Sensores de caudal

Sector	Función	GPIO
S1	Sensor Hall	GPIO14
S2	Sensor Hall	GPIO25
S3	Sensor Hall	GPIO26
S4	Sensor Hall	GPIO27
S5	Sensor Hall	GPIO32
S6	Sensor Hall	GPIO33

⸻

Sensor ambiental

Sensor	Función	GPIO
DHT20	Temperatura y humedad ambiente	I2C: SDA GPIO21, SCL GPIO22

⸻

Recomendaciones

Los GPIO utilizados han sido seleccionados para evitar conflictos con el proceso de arranque del ESP32.

No modificar la asignación salvo necesidad justificada.

Cualquier cambio deberá reflejarse simultáneamente en:

* riego.yaml
* documentación
* scripts Homey que dependan de dichas entidades

⸻

6. Sensores de caudal

Cada sector dispone de un sensor Hall independiente.

Modelo utilizado:

SWAWIS G3/4”

ESPHome utiliza el componente:

pulse_counter

Cada sensor publica:

* Caudal instantáneo (L/min)
* Litros acumulados durante el ciclo de riego

Los litros del ciclo constituyen la fuente de información utilizada posteriormente por IrrigationHistory.js.

Desde firmware `1.0.2`, `pulse_counter` publica cada `1s` para que los ciclos
manuales cortos usados en calibracion no pierdan pulsos por quedar dentro de
una ventana de actualizacion de 10 segundos. Al cerrar una linea, el firmware
espera `1200ms` antes de calcular el volumen final del ciclo, dejando margen
para que el contador publique el ultimo tramo.

⸻

7. Calibración

Calibración utilizada:

Sector	Calibración
S1	990 pulsos/L
S2	396 pulsos/L
S3	396 pulsos/L
S4	396 pulsos/L
S5	396 pulsos/L
S6	396 pulsos/L

S1 usa una calibración provisional desde firmware `1.0.1`, tras observar una
lectura de `72.76 L` en 5 minutos claramente superior al consumo físico
esperado. El valor `990 pulsos/L` equivale a dividir por 2.5 la lectura previa
basada en `396 pulsos/L`.

Fórmula de ajuste:

factor_nuevo = factor_actual * litros_reportados / litros_reales

Toda modificación del modelo de sensor o de la hidráulica requerirá
recalibración.

⸻

8. Sensor ambiental

El controlador incorpora un DHT20 de AZ-Delivery conectado por I2C.

Publica:

* Temperatura ambiente
* Humedad relativa

La temperatura ambiente se usa además para estimar la temperatura del chip
mediante `Temperatura Riego + temp_box_offset_c`. Esa estimación dispara la
protección térmica local del ESP32. La humedad tiene función informativa.

Conexión:

* VCC a 3.3V.
* GND a masa común.
* SDA a GPIO21.
* SCL a GPIO22.

En ESPHome se integra como `platform: aht10` con `variant: AHT20` y dirección
I2C `0x38`.

⸻

9. Temperatura del ESP32

ESPHome publica la temperatura interna del microcontrolador.

Se utiliza para:

* monitorización
* diagnóstico
* detección de posibles problemas térmicos

No genera ninguna acción automática.

⸻

10. Watchdog y supervisión

ESPHome publica:

* Estado de conexión
* Watchdog
* Estado del firmware
* Versión del firmware
* Contrato hardware publicado

Homey únicamente refleja dicha información.

Las acciones de recuperación pertenecen al motor Irrigation.js.

⸻

11. Detección de fugas

ESPHome detecta flujo cuando ningún relé está activo.

Publica:

Fuga detectada

Actualmente Homey únicamente informa del evento.

En versiones futuras podrá:

* generar alarmas
* enviar notificaciones
* bloquear nuevos riegos

⸻

12. Integración con Homey

La comunicación utiliza la integración oficial de ESPHome.

No existe código específico de comunicación.

El dispositivo aparece automáticamente en Homey como:

Riego

Este dispositivo representa exclusivamente el hardware.

⸻

13. Entidades publicadas

El dispositivo ESPHome publica:

Relés

* Sector 1
* Sector 2
* Sector 3
* Sector 4
* Sector 5
* Sector 6

⸻

Sensores de caudal

* Litros ciclo S1
* Litros ciclo S2
* Litros ciclo S3
* Litros ciclo S4
* Litros ciclo S5
* Litros ciclo S6

⸻

Sensores ambientales

* Temperatura ambiente
* Humedad ambiente
* Temperatura ESP32

⸻

Estado

* Conectividad
* Watchdog
* Fuga detectada
* ESP Firmware Version
* ESP Hardware Contract

⸻

14. Utilización desde Homey

Irrigation.js

Puede:

* activar relés
* desactivar relés
* leer litros del ciclo

No debe acceder al resto de sensores.

⸻

IrrigationStatus.js

Lee:

* temperatura
* humedad
* watchdog
* fuga
* estado conexión
* temperatura ESP32

Nunca modifica ninguna entidad del ESP32.

⸻

IrrigationHistory.js

Normalmente trabaja exclusivamente con los eventos persistidos.

Sólo utiliza los litros del ciclo como mecanismo de respaldo cuando un evento histórico no contiene dicha información.

⸻

15. Restricciones de diseño

El firmware ESPHome debe permanecer completamente libre de lógica de negocio.

No implementar:

* programación horaria
* secuencias
* colas
* histórico
* planificación
* decisiones automáticas

Toda la inteligencia del sistema pertenece a Homey.

⸻

16. Compatibilidad

Antes de modificar riego.yaml comprobar siempre:

* que no cambian los nombres de las entidades;
* que las Device Capabilities siguen siendo válidas;
* que Irrigation.js continúa encontrando los relés;
* que IrrigationStatus.js sigue leyendo correctamente los sensores;
* que IrrigationHistory.js continúa encontrando los litros por ciclo.

Si cambia cualquier identificador publicado por ESPHome deberán actualizarse simultáneamente los scripts Homey.

El firmware publica `ESP Hardware Contract` en formato
`irrigation-hw-api@<version>`. La app Homey y los HomeyScripts deben comprobar
ese contrato por rango de compatibilidad. No se debe exigir que la versión del
firmware coincida con la versión de la app o de los scripts.

⸻

17. Principios de diseño

El firmware actúa exclusivamente como controlador de hardware.

Homey actúa como controlador del sistema.

La separación entre ambos niveles constituye una decisión arquitectónica deliberada y no debe romperse.

Nunca trasladar lógica del motor al firmware.

Nunca duplicar decisiones entre ESPHome y Homey.

El firmware debe permanecer simple, determinista y fácilmente sustituible por otro controlador físico sin modificar la lógica de negocio del sistema.
