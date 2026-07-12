<p align="center">
  <img src="src/images/branding/logotext.png" alt="ConvoyRun" width="320">
</p>

<p align="center">
  Generador de flyers para convoyes de <strong>American Truck Simulator</strong> y <strong>Euro Truck Simulator 2</strong>.
</p>

---

**ConvoyRun** arma el flyer de tu convoy y te da el texto listo para Discord y TMP, todo desde tu escritorio.

## Qué incluye

- **Canvas editable** de 1280x720: mapa arrastrable y con zoom, círculos de partida/destino y waypoint opcional, imagen de detalle, logo de tu VTC.
- **27 estilos de texto** — fuego, hielo, arcoíris, neón y más — con degradés y sombras.
- **Indicadores de velocidad** arrastrables, incluido uno de texto libre (para carteles tipo "FUGA").
- **Horarios multi-zona** con las 418 zonas horarias reales del sistema (no una lista fija), corregidos país por país.
- **Exportación en tres resoluciones** (1280x720 hasta 1920x1080), con el PNG recomprimido sin pérdida antes de guardarlo.
- **Copiar para Discord y para TMP** con un clic — nada de retipear horarios a mano.
- **Recargar un flyer viejo** para reutilizar los datos si cambia la ruta o el mapa.
- Disponible en **español, inglés y portugués**.

## Descargar

Buscá la última versión en [Releases](https://github.com/convoyrama/convoyrun/releases) — hay un ejecutable único para Windows y otro para Linux, sin instaladores.

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

## Licencia

[AGPL-3.0](https://github.com/convoyrama/convoyrun#AGPL-3.0-1-ov-file)
