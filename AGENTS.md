# Instrucciones para agentes IA

## Objetivo

Antes de modificar código, todo agente debe leer obligatoriamente:

1. `homey/doc/Architecture.md`
2. `homey/doc/DeveloperGuide.md`
3. `homey/doc/DataModel.md`
4. `homey/doc/Testing.md`

Este documento no sustituye la documentación técnica; define las normas de
trabajo.

## 1. Principios generales

La arquitectura es deliberadamente modular. No modificarla salvo petición
explícita. Si una funcionalidad puede implementarse sin romperla, esa solución
será siempre preferible.

## 2. Separación de responsabilidades

### ESPHome

Responsable únicamente del hardware. Nunca introducir lógica de negocio,
programación, históricos o decisiones automáticas.

### Irrigation.js

Es el único propietario del motor. Solo este script puede abrir o cerrar relés
y modificar el estado o la cola del motor.

### IrrigationStatus.js

Únicamente sincroniza información desde ESPHome hacia “Sistema de Riego”.
Nunca controla relés ni modifica el motor o la cola.

### IrrigationHistory.js

Responsable únicamente de proyectar el histórico persistido. Nunca genera
eventos propios ni modifica el motor.

### Scheduler

Construye una solicitud de programa. Nunca controla directamente el hardware.

### IrrigationHealth.js

Supervisa y proyecta incidencias. Nunca controla relés ni modifica motor o
cola.

### IrrigationRecovery.js

Supervisa y recupera exclusivamente la integración ESPHome Controller. Nunca
controla relés ni modifica motor o cola.

## 3. Comunicación entre componentes

Los scripts nunca deben llamarse entre sí. La comunicación se realiza mediante
Variables Logic, Device Capabilities y Flows. No utilizar la ejecución de otro
HomeyScript como mecanismo habitual de comunicación.

## 4. Variables Logic

Son la fuente de verdad. Los dispositivos virtuales representan información.
Nunca almacenar estado únicamente en Device Capabilities.

## 5. Device Capabilities

Son interfaz de usuario, no lógica de negocio. No asumir que los identificadores
internos `devicecapabilities_xxx` son permanentes. Referirse a los campos por su
significado funcional siempre que sea posible.

## 6. Persistencia

Todo evento importante debe seguir este orden:

```text
Persistencia
↓
Trigger
↓
Actualización UI
```

## 7. Idempotencia

Siempre que sea posible, ejecutar varias veces un script no debe producir
efectos secundarios, especialmente en `IrrigationHistory.js` e
`IrrigationStatus.js`.

## 8. Flows

Solo deben contener disparadores, condiciones simples y ejecución de scripts.
Toda la lógica debe residir en los HomeyScripts.

## 9. Rendimiento

Evitar escrituras repetidas de Variables Logic o Device Capabilities y lecturas
innecesarias de ESPHome. Comprobar si un valor ha cambiado antes de escribirlo.

## 10. Compatibilidad

Antes de modificar el modelo de datos, comprobar el impacto en todos los
componentes. Las estructuras de `DataModel.md` son un contrato; evitar cambios
incompatibles.

## 11. Modificaciones de ESPHome

Antes de modificar el YAML, verificar nombres de entidades, GPIO y
compatibilidad con Homey. No cambiar nombres publicados sin actualizar
simultáneamente los scripts Homey.

## 12. Pruebas obligatorias

Tras cualquier modificación ejecutar, como mínimo, las pruebas aplicables de
arranque manual, parada manual, finalización automática, histórico y
sincronización ESPHome. Consultar `Testing.md`.

## 13. Cambios de arquitectura

No modificar la arquitectura general salvo petición explícita. Las alternativas
deben proponerse y justificarse antes de implementarse.

## 14. Prioridades

1. Fiabilidad.
2. Simplicidad.
3. Mantenibilidad.
4. Rendimiento.
5. Nuevas funcionalidades.

## 15. Convenciones

- Mantener nombres descriptivos.
- Evitar duplicación.
- Documentar decisiones importantes.
- Mantener scripts pequeños y cohesionados.
- No introducir dependencias innecesarias.
- Crear un script nuevo cuando una responsabilidad crezca significativamente.

## 16. Relación con el propietario

Priorizar arquitecturas limpias, separación estricta de responsabilidades,
documentación actualizada y soluciones robustas. Antes de cambios
significativos, explicar brevemente la propuesta y su impacto.
