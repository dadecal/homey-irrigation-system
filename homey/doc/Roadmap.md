FASE 1 (terminada)
✔ Motor
✔ Estado
✔ Histórico

FASE 2 (terminada para programa único)
✔ Aplicación Homey nativa
✔ Programador
✔ Scheduler
✔ Rain Delay
✔ Integración App -> Flow -> Irrigation.js
□ Programas múltiples

RAMA 2 (nueva generación: app nativa completa)
✔ RecoveryService en app nativa
✔ Plan Rama 2 documentado en AppMigrationPlan.md
✔ Separación de generaciones documentada en release/generations.json
✔ App v2 separada en homey/app-v2
✔ Decidido storage interno Rama 2 en lugar de Variables Logic como fuente de verdad
✔ AppStateStore v2 creado
✔ Programador v2 activado en ACTIVE_COMPAT
✔ Flow program_requested v2 conectado a Irrigation.js
✔ Scheduler Rama 1 desactivado
✔ HealthService v2 en modo sombra
✔ ACTIVE_COMPAT para HealthService con appStateV2 y Flow Trigger nativo
✔ Sustitución completa de IrrigationHealth.js
✔ StatusSyncService v2 en modo sombra
✔ Sustitución completa de IrrigationStatus.js
✔ HistoryService v2 en modo sombra
✔ Precheck de migración y bloqueo seguro de cutover
✔ ACTIVE_COMPAT para HistoryService implementado con appStateV2
✔ Sustitución completa de IrrigationHistory.js
✔ ACTIVE_COMPAT para StatusSyncService activado
✔ Activar StatusSyncService y retirar Flow status sync
✔ ACTIVE_COMPAT para HealthService con appStateV2 y Flow Trigger nativo
✔ Activar HealthService y retirar Flow health
✔ Crear evento/notificación nativa para Health
✔ Migrar Health/History a appStateV2
✔ Migrar condiciones de avisos de sector a app v2
✔ Portar RecoveryService a app v2 en modo sombra
✔ Activar RecoveryService v2 y retirar Recovery de Rama 1
✔ Devices nativos de sistema/manual/histórico
✔ Driver nativo Sistema de Riego v2 implementado
✔ Emparejar y validar Sistema de Riego v2
✔ Recuperacion/pairing idempotente de Sistema de Riego v2
✔ Device nativo Histórico de Riego
✔ Device nativo Riego Manual
✔ Validación física de Riego Manual v2
✔ Limpieza/control de Flows y legacy antes de motor
◐ Fase 6 de migración de Irrigation.js planificada
✔ Fase 6.0 contrato base del motor probado
✔ Implementar motor nativo en modo sombra
✔ Verificar `/engine/check` en Homey real
✔ Implementar adaptadores de motor en dry-run transaccional
✔ Preparar entradas nativas manual/scheduler sin cutover
✔ Preparar runbook de cutover controlado del motor
✔ Implementar Fase 6.4A/6.4B: ejecucion real tras compuerta engine=ACTIVE_COMPAT
✔ Implementar precheck inteligente para habilitar engine=ACTIVE_COMPAT
✔ Reinstalar y verificar en Homey el readiness final readyToActivateEngine/safeToDisableTechnicalFlows
⚠ Intento Fase 6.4C abortado con rollback seguro por `Missing Scopes` al activar tick nativo
◐ Rediseñar motor nativo para no depender de escrituras Logic
✔ Crear `appStateV2.engine` y backend appState en `EnginePlanExecutor`
✔ Hacer que `IrrigationEngineService` lea/escriba `appStateV2.engine` en modo activo
✔ Migrar Health/Recovery/SystemDevice/History a `appStateV2.engine` cuando engine este activo
✔ Habilitar soporte `ACTIVE_COMPAT` del motor tras precheck final
✔ Repetir Fase 6.4C: activacion controlada y prueba fisica
✔ Migrar avisos de inicio/fin de sector a Flow Cards nativas v2
✔ Release formal Rama 2 v2.0.1 con artefacto versionado
✔ Preflight Scheduler v2 y diagnostico persistente
□ Monitorizar primer riego programado completo con motor nativo

FASE 3
□ Meteorología
□ Optimización

FASE 4
□ IA
□ Predicción
