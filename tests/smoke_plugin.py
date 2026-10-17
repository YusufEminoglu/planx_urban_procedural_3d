"""Lifecycle smoke test for planx_urban_procedural_3d.

The cheapest test that still catches real defects: the plugin imports, its
metadata is well formed, and a full initGui() -> unload() cycle against a stub
iface leaves no toolbar, menu entry or dock behind. That last assertion is not
theoretical — it is how the orphan-toolbar bug in ParcelFlux was found.

Run from the directory that *contains* the plugin folder:

    python-qgis-ltr.bat -m planx_urban_procedural_3d.tests.smoke_plugin    # QGIS 3 LTR
    python-qgis.bat     -m planx_urban_procedural_3d.tests.smoke_plugin    # QGIS 4
"""
from __future__ import annotations

import configparser
import os
import re
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

PLUGIN_DIR = Path(__file__).resolve().parent.parent
if str(PLUGIN_DIR.parent) not in sys.path:
    sys.path.insert(0, str(PLUGIN_DIR.parent))

from qgis.PyQt.QtCore import QObject, pyqtSignal  # noqa: E402
from qgis.PyQt.QtWidgets import QMainWindow, QToolBar  # noqa: E402
from qgis.core import QgsApplication  # noqa: E402
from qgis.gui import QgsMapCanvas  # noqa: E402

PACKAGE = "planx_urban_procedural_3d"


def _ok(name, condition, detail=""):
    tag = "PASS" if condition else "FAIL"
    print(f"  [{tag}] {name}" + (f" - {detail}" if detail else ""))
    return bool(condition)


class _MessageBar:
    def pushMessage(self, *args, **kwargs):
        return None

    pushInfo = pushWarning = pushCritical = pushSuccess = pushMessage


class _Iface(QObject):
    """The slice of QgisInterface a plugin touches during load and unload."""

    currentLayerChanged = pyqtSignal(object)

    def __init__(self):
        super().__init__()
        self._window = QMainWindow()
        self._canvas = QgsMapCanvas(self._window)
        self._window.setCentralWidget(self._canvas)
        self._message_bar = _MessageBar()
        self.menu_entries = []
        self.toolbar_icons = []
        self.docks = []

    def mainWindow(self):
        return self._window

    def mapCanvas(self):
        return self._canvas

    def messageBar(self):
        return self._message_bar

    def activeLayer(self):
        return None

    def layerTreeView(self):
        return None

    def addToolBar(self, toolbar):
        if isinstance(toolbar, str):
            bar = QToolBar(toolbar, self._window)
            self._window.addToolBar(bar)
            return bar
        self._window.addToolBar(toolbar)
        return toolbar

    def removeToolBar(self, toolbar):
        self._window.removeToolBar(toolbar)

    def addToolBarIcon(self, action):
        self.toolbar_icons.append(action)

    def removeToolBarIcon(self, action):
        if action in self.toolbar_icons:
            self.toolbar_icons.remove(action)

    def addPluginToMenu(self, menu, action):
        self.menu_entries.append((menu, action))

    def removePluginMenu(self, menu, action):
        self.menu_entries = [e for e in self.menu_entries if e[1] is not action]

    addPluginToVectorMenu = addPluginToMenu
    removePluginVectorMenu = removePluginMenu
    addPluginToRasterMenu = addPluginToMenu
    removePluginRasterMenu = removePluginMenu

    def addDockWidget(self, area, dock):
        self.docks.append(dock)
        self._window.addDockWidget(area, dock)

    def removeDockWidget(self, dock):
        if dock in self.docks:
            self.docks.remove(dock)
        self._window.removeDockWidget(dock)


def read_metadata():
    raw = (PLUGIN_DIR / "metadata.txt").read_text(encoding="utf-8-sig", errors="replace")
    if not re.search(r"^\s*\[general\]", raw, re.M):
        raw = "[general]\n" + raw
    parser = configparser.ConfigParser(interpolation=None)
    parser.read_string(raw)
    # configparser lower-cases option names; metadata uses camelCase keys.
    return {k.lower(): v for k, v in parser["general"].items()}


def test_metadata():
    meta = read_metadata()
    required = ("name", "version", "qgisminimumversion", "description", "author", "email")
    missing = [f for f in required if not meta.get(f, "").strip()]
    semver = re.match(r"^\d+\.\d+\.\d+", meta.get("version", ""))
    return _ok(
        "metadata has the required fields and a semver version",
        not missing and bool(semver),
        f"missing={missing}" if missing else f"version={meta.get('version')}",
    )


def test_no_percent_in_metadata():
    """A literal % breaks the Hub upload through configparser interpolation."""
    raw = (PLUGIN_DIR / "metadata.txt").read_text(encoding="utf-8-sig", errors="replace")
    return _ok("metadata has no literal % (breaks Hub upload)", "%" not in raw)


def test_icon_exists():
    icon = read_metadata().get("icon", "").strip()
    if not icon:
        return _ok("declared icon exists", True, "no icon declared")
    return _ok("declared icon exists", (PLUGIN_DIR / icon).exists(), icon)


def test_class_factory():
    module = __import__(PACKAGE)
    return _ok("package imports and exposes classFactory",
               hasattr(module, "classFactory"), PACKAGE)


def test_lifecycle(iface):
    module = __import__(PACKAGE)
    plugin = module.classFactory(iface)
    if plugin is None:
        return _ok("initGui / unload cycle", False, "classFactory returned None")

    toolbars_before = {tb.objectName() for tb in iface.mainWindow().findChildren(QToolBar)}
    plugin.initGui()
    app = QgsApplication.instance()
    app.processEvents()

    plugin.unload()
    # unload() usually relies on deleteLater, which needs the event queue drained.
    app.sendPostedEvents()
    app.processEvents()

    toolbars_after = {tb.objectName() for tb in iface.mainWindow().findChildren(QToolBar)}
    leaked = toolbars_after - toolbars_before
    return _ok(
        "initGui / unload leaves no toolbar, menu entry or dock behind",
        not leaked and not iface.menu_entries and not iface.toolbar_icons
        and not iface.docks,
        f"toolbars={sorted(leaked)} menu={len(iface.menu_entries)} "
        f"icons={len(iface.toolbar_icons)} docks={len(iface.docks)}",
    )


def test_sample_layer_and_non_destructive_sync(iface):
    import json
    from qgis.core import QgsProject
    from planx_urban_procedural_3d.main_plugin import PlanXUrbanProcedural3D
    from planx_urban_procedural_3d.dialog import PluginDialog

    QgsProject.instance().removeAllMapLayers()
    plugin = PlanXUrbanProcedural3D(iface)
    plugin.dialog = PluginDialog(iface, iface.mainWindow())

    layer = plugin.create_sample_urban_layer()
    plugin.active_layer = layer
    iface.activeLayer = lambda: layer

    if layer is None or layer.featureCount() != 12 or layer.crs().isGeographic():
        return _ok("sample urban block layer created (12 metric parcels)", False, f"layer={layer}")

    first_feat = next(layer.getFeatures())
    orig_fid = int(first_feat.id())
    orig_area = float(first_feat.geometry().area())

    raw_geojson = plugin._export_active_layer_geojson()
    parsed = json.loads(raw_geojson)
    feats = parsed.get("features", [])
    exported_fids = [f.get("properties", {}).get("_planx_fid") for f in feats]
    if len(feats) != 12 or orig_fid not in exported_fids:
        return _ok("GeoJSON export preserves deterministic _planx_fid", False, f"fids={exported_fids}")

    # Sync with shrunken coordinates and a Courtyard footprint with an inner hole
    payload = {
        "updates": [
            {
                "id": orig_fid,
                "far": 2.4,
                "bcr": 0.42,
                "gfa": 6400,
                "setback": 4.0,
                "scale_x": 1.0,
                "scale_y": 1.0,
                "floors": 6,
                "floor_h": 3.2,
                "typology": "Courtyard",
                "usage": "MixedUse",
                "max_bcr": 0.55,
                "max_far": 2.8,
                "max_height": 24.0,
                "roof_style": "Flat",
                "stepback_i": 4,
                "stepback_d": 1.5,
                "plan_score": 88,
                "const_load": 0.85,
                "height_m": 19.2,
                "z_base": 0.0,
                "z_top": 19.2,
                "pop_est": 150,
                "carbon": 352.0,
                "runoff": 0.465,
                "open_space": 1400.0,
                "coordinates": [
                    [3015005.0, 4640005.0],
                    [3015055.0, 4640005.0],
                    [3015055.0, 4640035.0],
                    [3015005.0, 4640035.0],
                ],
                "building_footprints": [
                    {
                        "outer": [
                            [3015005.0, 4640005.0],
                            [3015055.0, 4640005.0],
                            [3015055.0, 4640035.0],
                            [3015005.0, 4640035.0],
                        ],
                        "holes": [
                            [
                                [3015015.0, 4640012.0],
                                [3015045.0, 4640012.0],
                                [3015045.0, 4640028.0],
                                [3015015.0, 4640028.0],
                            ]
                        ],
                        "floors": 6,
                        "height_m": 19.2,
                    }
                ],
            }
        ]
    }
    plugin._sync_to_qgis(payload)

    updated_feat = layer.getFeature(orig_fid)
    after_area = float(updated_feat.geometry().area())
    geom_preserved = abs(after_area - orig_area) < 0.01
    attrs_updated = (
        int(updated_feat["floors"]) == 6
        and str(updated_feat["typology"]) == "Courtyard"
        and int(updated_feat["plan_score"]) == 88
    )

    fp_layers = QgsProject.instance().mapLayersByName("PlanX 3D Building Footprints")
    fp_ok = False
    if fp_layers:
        fp_layer = fp_layers[0]
        if fp_layer.featureCount() == 1:
            fp_feat = next(fp_layer.getFeatures())
            fp_poly = fp_feat.geometry().asPolygon()
            fp_ok = len(fp_poly) == 2 and abs(float(fp_feat["height_m"]) - 19.2) < 0.01

    plugin.dialog.close()
    QgsProject.instance().removeAllMapLayers()
    return _ok(
        "sample block, non-destructive parcel sync & 3D footprints layer",
        geom_preserved and attrs_updated and fp_ok,
        f"geom_preserved={geom_preserved} attrs_updated={attrs_updated} fp_ok={fp_ok}",
    )


def run_all(iface):
    print("=" * 60)
    print(" planx_urban_procedural_3d - lifecycle smoke")
    print("=" * 60)
    results = [
        test_metadata(),
        test_no_percent_in_metadata(),
        test_icon_exists(),
        test_class_factory(),
        test_lifecycle(iface),
        test_sample_layer_and_non_destructive_sync(iface),
    ]
    passed = sum(1 for r in results if r)
    print("-" * 60)
    print(f"  {passed}/{len(results)} passed")
    return passed == len(results)


def main():
    app = QgsApplication.instance()
    owns_app = app is None
    profile = None
    if owns_app:
        profile = tempfile.TemporaryDirectory(prefix="planx_urban_procedural_3d-smoke-")
        app = QgsApplication([], True, profile.name, "external")
        app.initQgis()
    iface = _Iface()
    try:
        return run_all(iface)
    finally:
        iface.mainWindow().close()
        if owns_app:
            app.exitQgis()
            profile.cleanup()


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
else:
    main()
