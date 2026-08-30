# Test: Publicación de Convoy - Manejo de Errores

**Fecha**: 30/08/2026  
**Versión**: 0.3.9  
**Cambios realizados**: Frontend (swarm-publish.js, tauri-bridge.js) + i18n + devtools

---

## Archivos Modificados

| Archivo | Cambios |
|---------|---------|
| `src-tauri/tauri.conf.json` | `devtools: true` (habilitado para debug) |
| `src/js/native/tauri-bridge.js` | Logs de debug en `swarmPublish` |
| `src/js/swarm-publish.js` | Pre-validación nickname + errores específicos |
| `src/locales/es.json` | 2 nuevas claves i18n |
| `src/locales/en.json` | 2 nuevas claves i18n |
| `src/locales/pt.json` | 2 nuevas claves i18n |

---

## Pruebas a Realizar

### 1. Pre-validación de Nickname (sin backend)

**Setup**: Ir a Settings → borrar nickname → dejar vacío

**Acción**: Abrir wizard de publicación → llenar campos → Publicar

**Esperado**: 
- Mensaje de error "Definí un nickname en Settings antes de publicar"
- NO debe llegar al backend (mirar consola: no debe aparecer `[BRIDGE] publish_convoy IPC call:`)

---

### 2. Nickname muy largo

**Setup**: Ir a Settings → poner nickname de >32 caracteres (ej: "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567")

**Acción**: Abrir wizard → llenar campos → Publicar

**Esperado**: 
- Mensaje: "El nickname no puede tener más de 32 caracteres"
- NO debe llegar al backend

---

### 3. Canal inexistente

**Setup**: Seleccionar un canal que no existe en el dropdown (o escribir uno nuevo)

**Acción**: Publicar convoy

**Esperado**:
- Mensaje: "El canal no existe. Elegí otro canal"
- En consola: `[SWARM-PUBLISH] Parsed error message: Channel does not exist`

---

### 4. Contraseña de canal incorrecta

**Setup**: Seleccionar canal protegido → escribir contraseña incorrecta

**Acción**: Publicar convoy

**Esperado**:
- Mensaje: "Contraseña de canal incorrecta"
- En consola: `[SWARM-PUBLISH] Parsed error message: Wrong channel password`

---

### 5. Rate limiting (cooldown)

**Setup**: Publicar un convoy → inmediatamente intentar publicar otro

**Acción**: Publicar segundo convoy

**Esperado**:
- Mensaje con tiempo restante (ej: "Debés esperar 45 segundos...")
- En consola: `[SWARM-PUBLISH] Parsed error message: Debés esperar...`

---

### 6. P2P no inicializado

**Setup**: Desconectar internet → reiniciar app → intentar publicar

**Acción**: Publicar convoy sin conexión

**Esperado**:
- Mensaje: "P2P no inicializado. Verificá tu conexión a internet"
- En consola: `[SWARM-PUBLISH] Parsed error message: P2P not initialized`

---

### 7. Verificar logs de debug

**Acción**: Publicar cualquier convoy (con internet y nickname válido)

**Esperado en consola**:
```
[BRIDGE] publish_convoy IPC call: {hasEvent: true, hasSchedule: true, hasFlyer: false, channel: "general", hasPassword: false}
```

---

### 8. Evento fuera de ventana (3 meses)

**Acción**: Poner fecha >3 meses en el futuro → publicar

**Esperado**:
- Mensaje: "Solo se pueden publicar convoys hasta 3 meses adelante"
- Validación ocurre ANTES del IPC (pre-validation frontend)

---

## Consola a Monitorear

Abrir DevTools (F12) → pestaña Console

**Tags importantes**:
- `[BRIDGE]` = tauri-bridge.js
- `[SWARM-PUBLISH]` = swarm-publish.js
- `Backend publish_convoy failed:` = error del backend
- `Parsed error message:` = mensaje parseado para debug

---

## Notas

- El frontend ahora valida nickname ANTES de llamar al backend (evita IPC innecesario)
- Todos los errores del backend tienen mensajes localizados en es/en/pt
- Los logs de debug ayudan a identificar exactamente qué falla
