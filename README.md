<p align="center">
  <img src="src/images/branding/logotext.png" alt="ConvoyRun" width="320">
</p>

<p align="center">
  App de escritorio para organizar convoys de <strong>ATS</strong> y <strong>ETS2</strong>.<br>
  Arma el flyer, publica en la red P2P, listo.
</p>

---

## Qué hace

- **Genera flyers** con canvas editable, 27 estilos de texto, orientación horizontal/vertical, exportación en múltiples resoluciones.
- **Copia el texto** listo para Discord (con timestamps) y TruckersMP.
- **Publica eventos** en una red P2P descentralizada — sin servidores, los clientes se encuentran solos vía DHT.
- **Sistema de canales** — canales públicos (#general, #ats, #ets, #convoy, #tmp) y canales privados para VTCs via Patreon.
- **Votos, blacklists, moderación comunitaria** — todo firmado criptográficamente.
- **Calendario de slots** con 16 franjas de 90 minutos y conversión automática de husos horarios.
- **System tray** — se minimiza al cerrar, sigue corriendo como nodo P2P.
- **Tres idiomas**: español, inglés, portugués.

## Descargar

[Releases](https://github.com/convoyrama/convoyrun/releases):
- **Windows**: instalador `.exe`
- **Linux**: binario ejecutable (~23 MB)

## Cómo funciona

No hay servidor. Los clientes se encuentran usando la **Mainline DHT de BitTorrent** (la misma red de los torrents). Al abrir la app:

1. Publica tu endpoint en la DHT
2. Descubre otros clientes en el mismo topic
3. Conexión QUIC directa (fallback a relays públicos de iroh)
4. Eventos propagados por gossip epidémico

**Requisito**: internet con UDP. Sin internet funciona en modo local.

## Canales

La app tiene 5 canales públicos por defecto: `#general`, `#ats`, `#ets`, `#convoy`, `#tmp`.

Los supporters de Patreon pueden activar su propio canal privado con una key firmada. Ellos definen el nombre para mostrar y la contraseña. Solo el owner puede cambiar la contraseña o eliminar su canal.

## Stack

- **Tauri v2** — shell nativo en Rust, usa el WebView del sistema
- **Frontend vanilla** — HTML/CSS/JS sin bundler
- **P2P**: iroh 1.0 + distributed-topic-tracker (DHT)
- **Crypto**: ed25519, AES-256-GCM, Argon2id, blake3
- **Image hosting**: Catbox.moe (gratuito, 10 MB máx)

## Compilar

```bash
npm install
npm run tauri dev      # desarrollo
npm run tauri build    # release
```

Requiere Rust stable + Node.js. En Linux: paquetes de WebKitGTK/GTK (ver `.github/workflows/release.yml`).

## Comunidad

- Discord: https://discord.gg/hjJcyREthH
- Web: https://convoyrama.github.io

## Licencia

[AGPL-3.0](LICENSE)
