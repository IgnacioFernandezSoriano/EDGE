# Documentación del ETL del Informe RFID

**Autor:** Manus AI
**Fecha:** 13 de marzo de 2026

Este documento describe la arquitectura, funcionamiento y modo de integración del nuevo proceso ETL para el informe RFID del proyecto EDGE.

---

## Respuestas a las preguntas de integración

A continuación se responden las cuatro preguntas clave sobre cómo integrar el nuevo ETL con el frontend del panel de administración.

### 1. ¿Cómo se invoca el pipeline?

El pipeline **no se invoca con `run_audit_pipeline.py`**. Tiene su propio script de entrada autocontenido:

```bash
/home/ubuntu/EDGE/scripts/process_rfid_etl.py
```

Este script de Python gestiona todo el ciclo de vida del ETL del informe RFID. No tiene ninguna dependencia con el pipeline de auditoría de `tracking_events`.

Actualmente, **no existe un scheduler configurado**. La ejecución es manual y se realiza directamente en el servidor donde reside el código. Para automatizarlo, se necesitaría configurar un `cron job` en el servidor que ejecute el script con la frecuencia deseada (ej. cada hora, cada día, etc.).

### 2. ¿Dónde corre el proceso?

El proceso corre en el **mismo servidor/contenedor que el frontend**. El análisis del `package.json` y del `server/index.ts` revela que el proyecto usa un servidor Node.js/Express para servir los archivos estáticos de React en producción, pero no hay un backend de API separado para lógica de negocio. Los scripts de Python como `process_rfid_etl.py` se ejecutan en el mismo entorno que el servidor Node.js.

Por tanto, el script **tiene acceso al sistema de archivos** y puede leer y escribir en directorios como `/home/ubuntu/edge_analysis/` si fuera necesario, aunque actualmente no lo usa.

### 3. ¿Cómo se expone el trigger manual?

Actualmente, **no existe un endpoint HTTP para disparar el proceso manualmente**. La ejecución es exclusivamente por línea de comandos (CLI) en el servidor.

Para exponer un trigger manual, la mejor opción sería añadir un nuevo endpoint al servidor Express existente en `server/index.ts`. Este endpoint usaría la función `spawn` o `exec` del módulo `child_process` de Node.js para invocar el script de Python.

**Ejemplo de implementación en `server/index.ts`:**

```typescript
import { spawn } from 'child_process';

// ... dentro de la función startServer()

app.post('/api/etl/rfid/run', (req, res) => {
  console.log('Disparando ETL del informe RFID...');

  const pythonProcess = spawn('python3.11', [
    '/home/ubuntu/EDGE/scripts/process_rfid_etl.py',
    '--mode',
    'incremental' // o el modo que se necesite
  ]);

  pythonProcess.stdout.on('data', (data) => {
    console.log(`[ETL stdout]: ${data}`);
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`[ETL stderr]: ${data}`);
  });

  pythonProcess.on('close', (code) => {
    if (code === 0) {
      console.log('ETL completado con éxito.');
      res.status(200).json({ message: 'ETL completado con éxito' });
    } else {
      console.error(`ETL finalizado con código de error: ${code}`);
      res.status(500).json({ message: `ETL finalizado con código de error: ${code}` });
    }
  });
});
```

### 4. ¿Autenticación del endpoint?

El endpoint propuesto en el punto anterior **no tiene autenticación por defecto**. Dado que el panel de administración ya tiene un sistema de autenticación de usuarios (gestionado por Supabase Auth), la forma más segura de proteger este endpoint sería:

1.  **Enviar el token de sesión del usuario** desde el frontend en la cabecera `Authorization` de la petición `POST`.
2.  **Validar el token en el backend** usando la función `supabase.auth.getUser(token)` de Supabase. Si el token es válido y el usuario es un administrador, se procede a ejecutar el ETL.

**Ejemplo de protección del endpoint en `server/index.ts`:**

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// ...

app.post('/api/etl/rfid/run', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: 'No se ha proporcionado token de autenticación' });
  }

  const token = authHeader.split(' ')[1];
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ message: 'Token inválido o caducado' });
  }

  // Aquí se podría añadir una comprobación de si el usuario es admin
  // if (user.app_metadata.role !== 'admin') {
  //   return res.status(403).json({ message: 'Acceso denegado' });
  // }

  // ... (código para ejecutar el spawn del proceso Python)
});
```

---

## Documentación completa del ETL

El script `process_rfid_etl.py` está completamente documentado en su *docstring*. Incluye una descripción de su propósito, las 6 fases del proceso y las instrucciones de uso desde la línea de comandos.

| Fase | Descripción |
| :--- | :--- |
| **1. Extracción** | Carga datos brutos en `staging_rfid_events` desde la tabla `RFID` (modo `backfill`), desde un CSV (modo `csv`) o asume que ya están cargados (modo `incremental`). |
| **2. Transformación** | Enriquece cada evento usando `rfid_readers_master` y lo clasifica como `ORIGIN`, `DESTINATION` o `INTERMEDIATE`. |
| **3. Logging** | Registra cualquier incongruencia detectada (ej. lectores no encontrados en el maestro) en la tabla `log_rfid_inconsistencies` para revisión del administrador. |
| **4. Carga** | Actualiza la tabla `RFID` con los datos enriquecidos (`event_type`, `impc_code_corrected`, etc.) usando un `upsert` por lotes para máxima eficiencia. |
| **5. Sincronización** | Asegura que la tabla `postal_centers` contenga todos los IMPCs presentes en `rfid_readers_master`, garantizando la compatibilidad con el informe de Benchmark existente. |
| **6. Limpieza** | Vacía la tabla `staging_rfid_events` para liberar recursos y dejar el sistema listo para el siguiente ciclo. |

El código fuente completo y los scripts SQL se encuentran en el repositorio de GitHub en las siguientes rutas:

- **Script ETL:** `scripts/process_rfid_etl.py`
- **Scripts SQL:** `sql/`
