# Changelog

## [0.3.0] - 2026-05-31

- Fix clockwise polygon winding road offsets and slow down simulation speeds

## [0.2.9] - 2026-05-31

- Add smooth solar shadow animation with interactive Play/Pause control
- Update time format logic to support fine float step values

## [0.2.8] - 2026-05-31

- Implement realistic procedural mixed-use storefront ground floors and entrance doors
- Prevent door rendering on upper floors by using vertical non-repeating building facade textures

## [0.2.7] - 2026-05-31

- Implement procedural roof styles (Hipped, Gable, Mansard, Flat) in Web 3D Cockpit and PodiumTower integration

## [0.2.6] - 2026-05-30

- Re-bump cache-buster tags in index.html to v0.2.6

## [0.2.5] - 2026-05-30

- Implement batch sync payload matching for QGIS and move field creation before startEditing()

## [0.2.4] - 2026-05-30

- Update cache-busting query parameters in index.html to v0.2.4

## [0.2.3] - 2026-05-30

- Fix TypeError on raycast hover by traversing up parent nodes to find parcelItem

## [0.2.2] - 2026-05-30

- Add missing OutputShader.js required by OutputPass.js

## [0.2.1] - 2026-05-30

- Implement ThreadingHTTPServer to prevent loading screen hang and auto-project geographic coordinates to EPSG:3857 in Web UI

## [0.2.0] - 2026-05-30

- Instantiate HTTPServer synchronously in main thread to propagate port binding errors

## [0.1.9] - 2026-05-30

- Prevent browser caching with strict headers and version query parameters, and add visual error logger

## [0.1.8] - 2026-05-30

- Fix case-insensitive path mismatch for static file security check on Windows

## [0.1.7] - 2026-05-30

- Correct QgsJsonExporter to destination CRS (meters) and handle empty QGIS layers gracefully

## [0.1.6] - 2026-05-30

- Fix QgsMessageLog logMessage level constant to Qgis.Warning

## [0.1.5] - 2026-05-30

- Perfecting procedural engine with memory cleanup, CRS validation, and hover effects

## [0.1.4] - 2026-05-30

- Premium visual enhancements, day/night cycle, solar orbits, animated traffic, compliance linear gauges, and screenshot exporter

## [0.1.4] - 2026-05-30

- Premium visual enhancements, day/night cycle, solar orbits, animated traffic, compliance linear gauges, and screenshot exporter

## [0.1.4] - 2026-05-30

- Test

## [0.1.3] - 2026-05-30

- Implement advanced typologies, solar orbit arc, sidewalk/courtyard trees, and night window glow

All notable changes to **PlanX Urban Procedural 3D** are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · versioning: [SemVer](https://semver.org/).

## [0.1.3] - 2026-05-30

- Established a unique, professional PlanX branding identity across all user interfaces, descriptions, and code files.
- Added Sunlight Time-of-Day orbit rotation system for solar shadow analysis.
- Implemented Night Mode transition (dims environments, activates window emissions, and headlight/taillight systems on cars).
- Added vertical streetlights casting glowing yellow spotlight cones on streets at night.
- Generated hipped slanted tiled roofs for Residential typologies.
- Generated circular helipads with warning beacons on Commercial roofs.
- Created animated low-poly car traffic driving along sidewalk curb routes.
- Upgraded compliance dashboard to feature styled linear bar gauges for BCR/FAR.
- Added a high-resolution viewport screenshot exporter.

## [0.1.1] - 2026-05-30

- Translated all user interface text and labels to English-only.
- Added a custom premium dark QSS theme stylesheet to the PyQt dialog.
- Configured local directory asset routing mapping in server.py.
- Implemented canvas-drawn procedural window grids and doors for facade textures.
- Added rooftop detail assets (penthouse, HVAC boxes, slanted solar panels).
- Added 3D wireframe Zoning Envelopes with real-time glowing violation checks on BCR/FAR/Height breaches.
- Added concrete sidewalk frames around parcel footprints.

## [0.1.0] - 2026-05-30

- Initial release.
