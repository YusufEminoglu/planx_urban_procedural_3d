# PlanX Urban Procedural 3D

PlanX Urban Procedural 3D is a lightweight, fast, parametric urban design and procedural planning toolbox for QGIS 3 & 4 with Modelur-style feedback loops. 

It enables urban planners to select vector parcel/block polygons, run a local Python HTTP server directly from QGIS, and open an interactive 3D Web UI cockpit (Three.js) to dynamically adjust parameters (setbacks, height/floors, building typology, and usage) while viewing real-time compliance metrics (FAR, BCR, and GFA) on a live dashboard.

## Features

- **Interactive 3D Web Cockpit**: Live rendering of building envelopes, setbacks, and parcel footprints using Three.js.
- **Parametric Generation**: Instantly switch building typologies (Tower, Slab, Courtyard) and adjust floors, floor heights, and setbacks using simple sliders.
- **Two-Way Synchronization**: Clicking "Sync to QGIS" sends design choices and recalculated footprint geometries back to QGIS, updating layers in real-time.
- **Zoning Compliance**: Real-time evaluation of BCR (T.A.K.S) and FAR (K.A.K.S) against zoning rules, flagging limits immediately.
- **Lightweight Architecture**: No heavy external dependencies, allowing fast loading times and ensuring the plugin ZIP is extremely compact.

## Project Structure

```text
planx_urban_procedural_3d/
  __init__.py          # QGIS plugin classFactory entry point
  metadata.txt         # QGIS metadata declaration
  main_plugin.py       # Core QGIS actions and sync receiver
  dialog.py            # Vector layer picker and port options dialog
  server.py            # Local HTTP API and file server
  LICENSE              # GPL-3.0 LICENSE
  CHANGELOG.md         # Keep a Changelog
  icons/
    icon.png           # Plugin toolbar icon
  web/
    assets/            # Shared Three.js and vendor assets
    src/
      index.html       # Layout structure for the 3D cockpit UI
      style.css        # Glassmorphic dark-mode interface styling
      app.js           # Core Three.js render engine and parametric math
```

## License

This plugin is licensed under the GPL-3.0-or-later License.
