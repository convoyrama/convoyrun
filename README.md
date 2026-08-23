<p align="center">
  <img src="src/images/branding/logotext.png" alt="ConvoyRun" width="320">
</p>

<p align="center">
  Generador de flyers y red comunitaria para <strong>American Truck Simulator</strong> y <strong>Euro Truck Simulator 2</strong>.
</p>

---

**ConvoyRun** arma el flyer de tu convoy, te da el texto listo para Discord y TMP, y publica tu evento en una red P2P donde otros conductores pueden verlo, votar y organizarse — todo desde tu escritorio, sin servidores.

## Qué incluye

### Generador de Flyers

- **Canvas editable** de 1280×720 con mapa arrastrable/zoom, círculos de partida/destino, waypoint opcional, imagen de detalle, logo de tu VTC.
- **Orientación horizontal/vertical** — toggle para cambiar entre 16:9 y 9:16, ideal para mapas de rutas verticales.
- **27 estilos de texto** — fuego, hielo, arcoíris, neón y más — con degradés y sombras.
- **3 indicadores de velocidad** arrastrables, incluido uno de texto libre (para carteles tipo "FUGA").
- **Horarios multi-zona** con las 418 zonas horarias IANA reales del sistema (no una lista fija), corregidos país por país.
- **Selector de husos horarios personalizado** — buscador con todas las zonas IANA, botones de "agregar región completa", lista 100% editable.
- **Exportación en tres resoluciones** (1280×720, 1600×900, 1920×1080), con PNG recomprimido sin pérdida.
- **Copiar para Discord y para TMP** con un clic — timestamps `<t:...>` para Discord, Markdown con horarios agrupados para TMP.
- **Recargar un flyer viejo** — leer metadata PNG de un flyer generado antes y rellenar el formulario.

### Red P2P (Swarm)

- **Auto-discovery vía Mainline DHT** — los clientes se encuentran automáticamente al abrir la app, sin configuración ni servidores.
- **Publicación de convoys** con firma criptográfica ed25519.
- **Sistema de votos** (positivo/negativo) propagado por gossip epidémico.
- **Canales temáticos** con password opcional para organizar eventos por tema.
- **Eliminación de convoys** por el autor con firma verificable.
- **Listas negras públicas** — publicar, seguir y explorar blocklists comunitarias.
- **Sistema de amigos** — agregar/quitar por peer ID, ver amigos mutuos.
- **Bloqueo directo** desde el detalle de cada evento del Swarm.

### Moderación y Seguridad

- **Identidad P2P** con clave ed25519 persistente.
- **Backup de identidad** exportable/importable con encriptación AES-256-GCM + Argon2id.
- **Firma criptográfica** en todos los mensajes: convoys, votos, deletes, canales.
- **Filtro de autores bloqueados** — los mensajes de autores bloqueados se descartan antes de procesar.

### Gestión de Tiempo

- **Calendario de Slots (CTS)** — 16 slots de 90 minutos, timeline horizontal, horarios en 19 zonas.
- **Semáforo de verificación** — 3 puntos (rojo/amarillo/verde) que confirman conectividad y hora del sistema.
- **Reloj en vivo** con hora local + hora in-game ATS/ETS2 e ícono día/noche.

### Configuración

- **Settings modal** con 3 tabs: Profile (peer ID, nickname, backup), Blacklist (block/unblock, blacklists públicas), Friends.
- **Disponible en español, inglés y portugués** (176 keys de traducción con paridad total).

## Descargar

Buscá la última versión en [Releases](https://github.com/convoyrama/convoyrun/releases) — hay un ejecutable único para Windows y otro para Linux, sin instaladores.

## Cómo funciona la red P2P

ConvoyRun no necesita servidores. Los clientes se encuentran entre sí usando la **Mainline DHT de BitTorrent** (la misma red que usa el protocolo de archivos torrent). Al abrir la app:

1. Se publica el endpoint en la DHT
2. Se leen records de otros clientes que usen el mismo topic
3. Se establecen conexiones QUIC directas (con fallback a relays públicos de iroh)
4. Los eventos se propagan por gossip epidémico

**Requisitos**: conexión a internet con UDP habilitada. Sin internet, la app funciona en modo local (localStorage).

## Comunidad

ConvoyRun es un proyecto de **CONVOYRAMA**.

- Discord: https://discord.gg/hjJcyREthH
- Sitio web: https://convoyrama.github.io

## Para desarrolladores

Si querés compilar ConvoyRun vos mismo:

```bash
npm install
npm run tauri dev      # build de desarrollo con hot reload
npm run tauri build    # build de release (binario único, sin instalador)
```

Requiere Rust (stable) y Node.js. En Linux hacen falta los paquetes de desarrollo de WebKitGTK/GTK — ver `.github/workflows/release.yml` para la lista exacta de `apt` que usa CI.

### Stack técnico

- **Backend**: Rust + Tauri v2 (shell nativo, no empaqueta Chromium)
- **Frontend**: HTML/CSS/JS vanilla sin bundler
- **P2P**: iroh 1.0 (gossip + blobs + relays) + distributed-topic-tracker (auto-discovery vía DHT)
- **Crypto**: ed25519 (firmas) + AES-256-GCM + Argon2id (backup)
- **Tiempo**: Luxon (husos horarios)

## Licencia

[AGPL-3.0](https://github.com/convoyrama/convoyrun#AGPL-3.0-1-ov-file)
