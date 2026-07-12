<p align="center">
  <img src="src/images/branding/logotext.png" alt="ConvoyRun" width="320">
</p>

<p align="center">
  Generador de flyers para convoyes de <strong>American Truck Simulator</strong> y <strong>Euro Truck Simulator 2</strong>.
</p>

---

Armar un flyer de convoy a mano es siempre lo mismo: mapa recortado, círculos de partida y destino alineados a ojo, horarios convertidos a mano para cada país, y después retipear todo para Discord y para TMP. **ConvoyRun** hace esa parte por vos.

Cargás el mapa, marcás partida y destino, elegís los estilos, y la app arma el flyer y te da el texto ya formateado — timestamps de Discord que cada quien ve en su propia hora, y el resumen para TruckersMP agrupado por zona horaria. Todo corre en tu máquina, sin subir nada a ningún lado.

## Qué incluye

- **Canvas editable** de 1280x720: mapa arrastrable y con zoom, círculos de partida/destino y waypoint opcional, imagen de detalle, logo de tu VTC, fondo propio, watermark de CONVOYRAMA.
- **27 estilos de texto** — fuego, hielo, arcoíris, neón y más — con degradés y sombras.
- **Indicadores de velocidad** arrastrables, incluido uno de texto libre (para carteles tipo "FUGA").
- **Horarios multi-zona** con las 418 zonas horarias reales del sistema (no una lista fija), corregidos país por país, y un semáforo que confirma que tu hora local está sincronizada antes de generar los timestamps.
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
