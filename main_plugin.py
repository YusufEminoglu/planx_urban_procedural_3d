# -*- coding: utf-8 -*-
"""PlanX Urban Procedural 3D main plugin class."""
from __future__ import annotations

from contextlib import suppress
import json
import os
import threading
import webbrowser
from qgis.PyQt.QtCore import QObject, QCoreApplication, QThread, pyqtSignal, pyqtSlot
from qgis.PyQt.QtGui import QColor, QIcon
from qgis.PyQt.QtWidgets import QMessageBox

try:  # Qt5: QAction lives in QtWidgets
    from qgis.PyQt.QtWidgets import QAction
except ImportError:  # Qt6 / QGIS 4: QAction moved to QtGui
    from qgis.PyQt.QtGui import QAction
from qgis.core import (
    QgsCategorizedSymbolRenderer,
    QgsCoordinateReferenceSystem,
    QgsCoordinateTransform,
    QgsFeature,
    QgsFillSymbol,
    QgsGeometry,
    QgsJsonExporter,
    QgsPointXY,
    QgsProject,
    QgsRendererCategory,
    QgsVectorLayer,
)

from .dialog import PluginDialog
from .server import PlanXProceduralServer


def _make_field(name: str, kind: str):
    """Create a QgsField across QGIS 3/4 (QMetaType first, QVariant fallback)."""
    from qgis.core import QgsField
    try:
        from qgis.PyQt.QtCore import QMetaType
        meta = {
            "double": QMetaType.Type.Double,
            "integer": QMetaType.Type.Int,
            "string": QMetaType.Type.QString,
        }
        return QgsField(name, meta[kind])
    except Exception:
        from qgis.PyQt.QtCore import QVariant
        legacy = {
            "double": QVariant.Double,
            "integer": QVariant.Int,
            "string": QVariant.String,
        }
        return QgsField(name, legacy[kind])


class _SyncBridge(QObject):
    """Marshal HTTP sync and refresh requests from the server thread to QGIS' main thread."""

    request = pyqtSignal(object, object)
    refreshRequest = pyqtSignal(object)

    def __init__(self, plugin):
        super().__init__()
        self.plugin = plugin
        self.request.connect(self._handle_request)
        self.refreshRequest.connect(self._handle_refresh)

    @pyqtSlot(object, object)
    def _handle_request(self, data, token):
        try:
            token["result"] = self.plugin._sync_to_qgis(data)
        except Exception as exc:
            token["result"] = (False, f"Sync failed: {exc}")
        finally:
            token["event"].set()

    @pyqtSlot(object)
    def _handle_refresh(self, token):
        try:
            token["result"] = self.plugin._export_active_layer_geojson()
        except Exception:
            token["result"] = None
        finally:
            token["event"].set()


class PlanXUrbanProcedural3D:
    MENU_NAME = "&PlanX Urban Procedural 3D"
    FOOTPRINTS_LAYER_NAME = "PlanX 3D Building Footprints"

    def __init__(self, iface):
        self.iface = iface
        self.plugin_dir = os.path.dirname(__file__)
        self.icon_path = os.path.join(self.plugin_dir, "icons", "icon.png")
        self.action: QAction | None = None
        self.dialog = None
        self.server = None
        self.active_layer = None
        self.crs_transformed = False
        self.export_crs = None
        self.selected_only = True
        self.create_footprints_layer = True
        self.style_footprints_layer = True
        self.overwrite_parcel_geometry = False
        self.sync_bridge = _SyncBridge(self)

    def initGui(self) -> None:
        self.action = QAction(QIcon(self.icon_path), "PlanX Urban Procedural 3D", self.iface.mainWindow())
        self.action.setStatusTip("Parametric 3D urban design and procedural planning toolbox")
        self.action.triggered.connect(self.show_dialog)
        self.iface.addToolBarIcon(self.action)
        self.iface.addPluginToMenu(self.MENU_NAME, self.action)

    def unload(self) -> None:
        if self.action:
            self.iface.removePluginMenu(self.MENU_NAME, self.action)
            self.iface.removeToolBarIcon(self.action)
            self.action = None
        if self.dialog:
            self.dialog.close()
            self.dialog = None
        if self.server:
            self.server.stop()
            self.server = None

    def show_dialog(self) -> None:
        if self.dialog is None:
            self.dialog = PluginDialog(self.iface, self.iface.mainWindow())
            self.dialog.runRequested.connect(self.run_action)
            self.dialog.sampleLayerRequested.connect(self.create_sample_urban_layer)
            self.dialog.stopServerRequested.connect(self.stop_server)
        self.dialog.show()
        self.dialog.raise_()
        self.dialog.activateWindow()

    def stop_server(self) -> None:
        if self.server:
            port = self.server.port
            self.server.stop()
            self.server = None
            if self.dialog:
                self.dialog.set_server_running(None)
                self.dialog.set_status(f"Local server on port {port} stopped.")
            self.iface.messageBar().pushInfo("PlanX Urban Procedural 3D", f"Stopped local server on port {port}.")

    def create_sample_urban_layer(self) -> QgsVectorLayer | None:
        """Create a 12-parcel metric urban design study layer in QGIS."""
        layer = QgsVectorLayer("Polygon?crs=EPSG:3857", "PlanX Sample Urban Parcels", "memory")
        pr = layer.dataProvider()
        schema = [
            _make_field("parcel_no", "integer"),
            _make_field("block_name", "string"),
            _make_field("usage", "string"),
            _make_field("typology", "string"),
            _make_field("roof_style", "string"),
            _make_field("floors", "integer"),
            _make_field("floor_h", "double"),
            _make_field("setback", "double"),
            _make_field("max_bcr", "double"),
            _make_field("max_far", "double"),
            _make_field("max_height", "double"),
        ]
        pr.addAttributes(schema)
        layer.updateFields()

        # Base origin in EPSG:3857 (Izmir Bay metric coordinates)
        ox, oy = 3025000.0, 4640000.0
        # 4 urban blocks separated by a 24m central boulevard (X) and 18m avenue (Y),
        # subdivided into 12 parcels with varied geometries and zoning attributes.
        specs = [
            # South-West Block (3 parcels)
            (-115, -95, -65, -15, 101, "SW-Block", "MixedUse", "PodiumTower", "Mansard", 9, 3.2, 3.0, 0.55, 4.2, 36.0),
            (-65, -95, -12, -55, 102, "SW-Block", "Commercial", "SteppedTower", "Flat", 11, 3.4, 3.0, 0.60, 4.8, 45.0),
            (-65, -55, -12, -15, 103, "SW-Block", "Residential", "Courtyard", "Hipped", 6, 3.0, 3.0, 0.45, 2.6, 22.0),
            # South-East Block (3 parcels)
            (12, -95, 64, -15, 201, "SE-Block", "MultiBuildingBlock", "MultiBuildingBlock", "Mansard", 7, 3.1, 3.5, 0.50, 3.2, 28.0),
            (64, -95, 115, -55, 202, "SE-Block", "Residential", "LShape", "Hipped", 5, 3.0, 3.0, 0.45, 2.2, 18.0),
            (64, -55, 115, -15, 203, "SE-Block", "Civic", "UShape", "Gable", 4, 3.5, 4.0, 0.40, 1.8, 18.0),
            # North-West Block (3 parcels)
            (-115, 15, -62, 60, 301, "NW-Block", "Residential", "Slab", "Gable", 6, 3.0, 3.0, 0.45, 2.5, 21.0),
            (-115, 60, -62, 100, 302, "NW-Block", "Residential", "Tower", "Hipped", 8, 3.0, 3.5, 0.40, 2.8, 27.0),
            (-62, 15, -12, 100, 303, "NW-Block", "Park", "Tower", "Hipped", 1, 3.0, 2.0, 0.10, 0.10, 4.0),
            # North-East Block (3 parcels)
            (12, 15, 65, 60, 401, "NE-Block", "MixedUse", "Courtyard", "Mansard", 7, 3.2, 3.0, 0.50, 3.4, 26.0),
            (65, 15, 115, 60, 402, "NE-Block", "Commercial", "Tower", "Flat", 10, 3.3, 3.5, 0.55, 4.5, 38.0),
            (12, 60, 115, 100, 403, "NE-Block", "Residential", "MultiBuildingBlock", "Hipped", 6, 3.0, 3.5, 0.45, 2.8, 24.0),
        ]

        feats = []
        for x0, y0, x1, y1, pno, blk, usage, typo, roof, fl, fh, sb, mbcr, mfar, mh in specs:
            actual_usage = "MixedUse" if usage == "MultiBuildingBlock" else usage
            ring = [
                QgsPointXY(ox + x0, oy + y0),
                QgsPointXY(ox + x1, oy + y0),
                QgsPointXY(ox + x1, oy + y1),
                QgsPointXY(ox + x0, oy + y1),
                QgsPointXY(ox + x0, oy + y0),
            ]
            f = QgsFeature(layer.fields())
            f.setGeometry(QgsGeometry.fromPolygonXY([ring]))
            f.setAttributes([pno, blk, actual_usage, typo, roof, fl, fh, sb, mbcr, mfar, mh])
            feats.append(f)

        pr.addFeatures(feats)
        layer.updateExtents()
        QgsProject.instance().addMapLayer(layer)
        self._apply_landuse_symbology(layer, is_footprint=False)

        with suppress(Exception):
            canvas = self.iface.mapCanvas()
            if canvas:
                canvas.setExtent(layer.extent())
                canvas.refresh()

        if self.dialog:
            self.dialog.input_layer.setLayer(layer)
            self.dialog._update_layer_stats()
            self.dialog.set_status("Created 'PlanX Sample Urban Parcels' (12 metric parcels in EPSG:3857).")

        self.iface.messageBar().pushSuccess(
            "PlanX Urban Procedural 3D",
            "Generated 'PlanX Sample Urban Parcels' with 12 urban blocks and zoning rules."
        )
        return layer

    def _export_active_layer_geojson(self) -> str:
        """Export the active QGIS layer (or selection) to a GeoJSON string with deterministic IDs."""
        layer = self.active_layer
        if not isinstance(layer, QgsVectorLayer):
            return "{}"

        crs = layer.crs()
        crs_is_geographic = crs.isGeographic()
        if crs_is_geographic:
            self.export_crs = QgsCoordinateReferenceSystem("EPSG:3857")
            self.crs_transformed = True
        else:
            self.export_crs = crs
            self.crs_transformed = False

        exporter = QgsJsonExporter(layer)
        exporter.setPrecision(6)
        exporter.setIncludeAttributes(True)
        exporter.setDestinationCrs(self.export_crs)

        if self.selected_only and layer.selectedFeatureCount() > 0:
            features = list(layer.selectedFeatures())
        else:
            features = list(layer.getFeatures())

        geojson_str = exporter.exportFeatures(features)
        try:
            geojson_dict = json.loads(geojson_str)
            geojson_dict["crs_is_geographic"] = crs_is_geographic
            geojson_dict["layer_name"] = layer.name()
            raw_feats = geojson_dict.get("features", [])
            for idx, feat_obj in enumerate(raw_feats):
                if idx < len(features):
                    qgs_fid = int(features[idx].id())
                    feat_obj["id"] = qgs_fid
                    props = feat_obj.setdefault("properties", {})
                    props["_planx_fid"] = qgs_fid
            geojson_str = json.dumps(geojson_dict)
        except Exception as json_err:
            from qgis.core import QgsMessageLog, Qgis
            QgsMessageLog.logMessage(f"Failed to enrich GeoJSON metadata: {json_err}", "PlanX", Qgis.Warning)

        return geojson_str

    def refresh_callback(self) -> str:
        """Server-thread callback for GET /data.geojson?refresh=1."""
        app = QCoreApplication.instance()
        if app is None or QThread.currentThread() == app.thread():
            return self._export_active_layer_geojson()

        token = {"event": threading.Event(), "result": None}
        self.sync_bridge.refreshRequest.emit(token)
        if not token["event"].wait(15):
            return self.server.geojson_data if self.server else "{}"
        return token["result"] or (self.server.geojson_data if self.server else "{}")

    def run_action(self, params: dict) -> None:
        layer = params["layer"]
        port = params["port"]
        launch = params["launch_browser"]
        self.selected_only = bool(params.get("selected_only", True))
        self.create_footprints_layer = bool(params.get("create_footprints_layer", True))
        self.style_footprints_layer = bool(params.get("style_footprints_layer", True))
        self.overwrite_parcel_geometry = bool(params.get("overwrite_parcel_geometry", False))

        if not isinstance(layer, QgsVectorLayer):
            self._error("Error", "Active layer must be a valid vector layer.")
            return

        self.active_layer = layer
        crs_is_geographic = layer.crs().isGeographic()
        if crs_is_geographic:
            self.iface.messageBar().pushWarning(
                "PlanX Urban Procedural 3D",
                "Active layer uses geographic coordinates (degrees). "
                "Geometries are automatically projected to Web Mercator (meters) for local 3D rendering."
            )

        web_dir = os.path.join(self.plugin_dir, "web")
        if not os.path.exists(web_dir):
            os.makedirs(web_dir, exist_ok=True)

        # 1. Start Server
        try:
            if self.server:
                self.server.stop()
            self.server = PlanXProceduralServer(
                port,
                web_dir,
                sync_callback=self.sync_callback,
                refresh_callback=self.refresh_callback,
            )
            self.server.start()
        except Exception as e:
            self._error("Server Error", f"Could not start local server on port {port}:\n{e}")
            return

        if self.server.port != port:
            self.iface.messageBar().pushInfo(
                "PlanX Urban Procedural 3D",
                f"Port {port} was busy; the cockpit is served on port {self.server.port} instead."
            )
        port = self.server.port

        # 2. Export GeoJSON
        try:
            geojson_str = self._export_active_layer_geojson()
            self.server.update_geojson(geojson_str)
        except Exception as e:
            self._error("Data Export Error", f"Could not convert layer features to GeoJSON format:\n{e}")
            return

        msg = f"Server active on http://127.0.0.1:{port} — loaded '{layer.name()}'."
        if crs_is_geographic:
            msg += " (Geographic CRS auto-projected to EPSG:3857)."
            self.iface.messageBar().pushWarning("PlanX Urban Procedural 3D", msg)
        else:
            self.iface.messageBar().pushSuccess("PlanX Urban Procedural 3D", msg)

        if self.dialog:
            self.dialog.set_server_running(port)
            self.dialog.set_status(msg, error=False)

        # 3. Open Browser
        if launch:
            webbrowser.open(f"http://127.0.0.1:{port}/index.html")

    def sync_callback(self, data: dict) -> tuple[bool, str]:
        """Server-thread callback for POST /sync."""
        app = QCoreApplication.instance()
        if app is None or QThread.currentThread() == app.thread():
            return self._sync_to_qgis(data)

        token = {"event": threading.Event(), "result": None}
        self.sync_bridge.request.emit(data, token)
        if not token["event"].wait(30):
            return False, "Sync timed out while waiting for QGIS main thread"
        return token["result"] or (False, "Sync failed without a result")

    def _sync_to_qgis(self, data: dict) -> tuple[bool, str]:
        """Apply browser-side design updates to the active QGIS layer and optional 3D footprints layer."""
        if not self.active_layer:
            return False, "QGIS active layer is not set"

        was_editing = self.active_layer.isEditable()
        edit_command_started = False

        try:
            updates = data.get("updates", [])
            if not updates:
                return True, "No updates provided"

            overwrite_geom = bool(data.get("overwrite_parcel_geometry", self.overwrite_parcel_geometry))
            build_footprints = bool(data.get("create_footprints_layer", self.create_footprints_layer))

            fields_to_add = {
                "far": "double",
                "bcr": "double",
                "gfa": "double",
                "setback": "double",
                "scale_x": "double",
                "scale_y": "double",
                "floors": "integer",
                "usage": "string",
                "floor_h": "double",
                "typology": "string",
                "max_bcr": "double",
                "max_far": "double",
                "max_height": "double",
                "roof_style": "string",
                "stepback_i": "integer",
                "stepback_d": "double",
                "plan_score": "double",
                "const_load": "double",
                "height_m": "double",
                "z_base": "double",
                "z_top": "double",
                "pop_est": "integer",
                "carbon": "double",
                "runoff": "double",
                "open_space": "double",
            }

            existing_fields = [f.name() for f in self.active_layer.fields()]
            fields_to_create = [
                _make_field(name, ftype)
                for name, ftype in fields_to_add.items()
                if name not in existing_fields
            ]

            if fields_to_create and was_editing:
                for field in fields_to_create:
                    if not self.active_layer.addAttribute(field):
                        return False, f"Could not add field '{field.name()}' to editable layer"
                self.active_layer.updateFields()
            elif fields_to_create:
                if not self.active_layer.dataProvider().addAttributes(fields_to_create):
                    return False, "Could not add required PlanX fields to the layer"
                self.active_layer.updateFields()

            if not self.active_layer.isEditable() and not self.active_layer.startEditing():
                return False, "Could not start an edit session for the active layer"

            self.active_layer.beginEditCommand("PlanX Urban Procedural 3D sync")
            edit_command_started = True

            field_indices = {
                name: self.active_layer.fields().indexOf(name)
                for name in fields_to_add
            }
            missing_fields = [name for name, idx in field_indices.items() if idx < 0]
            if missing_fields:
                raise RuntimeError(f"Missing required fields after update: {', '.join(missing_fields)}")

            for item in updates:
                try:
                    fid = int(item.get("id"))
                except (TypeError, ValueError):
                    raise RuntimeError(f"Invalid feature id in sync payload: {item.get('id')!r}")

                far_val = float(item.get("far", 0))
                bcr_val = float(item.get("bcr", 0))
                gfa_val = float(item.get("gfa", 0))
                setback_val = float(item.get("setback", 0))
                scale_x_val = float(item.get("scale_x", 1))
                scale_y_val = float(item.get("scale_y", 1))
                floors_val = int(item.get("floors", 1))
                usage_val = str(item.get("usage", "Residential"))
                floor_h_val = float(item.get("floor_h", 3.0))
                typology_val = str(item.get("typology", "Tower"))
                max_bcr_val = float(item.get("max_bcr", 0.45))
                max_far_val = float(item.get("max_far", 2.5))
                max_height_val = float(item.get("max_height", 18.0))
                roof_style_val = str(item.get("roof_style", "Flat"))
                stepback_i_val = int(item.get("stepback_i", 4))
                stepback_d_val = float(item.get("stepback_d", 1.5))
                plan_score_val = float(item.get("plan_score", 0))
                const_load_val = float(item.get("const_load", 0))
                height_m_val = float(item.get("height_m", 0))
                z_base_val = float(item.get("z_base", 0))
                z_top_val = float(item.get("z_top", height_m_val))
                pop_est_val = int(item.get("pop_est", 0))
                carbon_val = float(item.get("carbon", 0))
                runoff_val = float(item.get("runoff", 0))
                open_space_val = float(item.get("open_space", 0))
                coords = item.get("coordinates", [])

                values = {
                    "far": far_val,
                    "bcr": bcr_val,
                    "gfa": gfa_val,
                    "setback": setback_val,
                    "scale_x": scale_x_val,
                    "scale_y": scale_y_val,
                    "floors": floors_val,
                    "usage": usage_val,
                    "floor_h": floor_h_val,
                    "typology": typology_val,
                    "max_bcr": max_bcr_val,
                    "max_far": max_far_val,
                    "max_height": max_height_val,
                    "roof_style": roof_style_val,
                    "stepback_i": stepback_i_val,
                    "stepback_d": stepback_d_val,
                    "plan_score": plan_score_val,
                    "const_load": const_load_val,
                    "height_m": height_m_val,
                    "z_base": z_base_val,
                    "z_top": z_top_val,
                    "pop_est": pop_est_val,
                    "carbon": carbon_val,
                    "runoff": runoff_val,
                    "open_space": open_space_val,
                }
                for name, value in values.items():
                    if not self.active_layer.changeAttributeValue(fid, field_indices[name], value):
                        raise RuntimeError(f"Could not update '{name}' for feature {fid}")

                # Only overwrite source parcel geometry if explicitly requested
                if overwrite_geom and coords and len(coords) >= 3:
                    pts = [QgsPointXY(float(pt[0]), float(pt[1])) for pt in coords]
                    if pts[0] != pts[-1]:
                        pts.append(pts[0])
                    poly_geom = QgsGeometry.fromPolygonXY([pts])

                    if self.crs_transformed:
                        xform = QgsCoordinateTransform(
                            QgsCoordinateReferenceSystem("EPSG:3857"),
                            self.active_layer.crs(),
                            QgsProject.instance(),
                        )
                        poly_geom.transform(xform)

                    if not self.active_layer.changeGeometry(fid, poly_geom):
                        raise RuntimeError(f"Could not update geometry for feature {fid}")

            self.active_layer.endEditCommand()
            edit_command_started = False

            if not was_editing and not self.active_layer.commitChanges():
                errors = "; ".join(self.active_layer.commitErrors())
                self.active_layer.rollBack()
                return False, f"Could not commit layer changes: {errors or 'unknown error'}"

            footprints_count = 0
            if build_footprints:
                with suppress(Exception):
                    footprints_count = self._update_building_footprints_layer(updates)

            # Also refresh the cached GeoJSON on the server so subsequent reloads reflect synced values
            with suppress(Exception):
                if self.server:
                    self.server.update_geojson(self._export_active_layer_geojson())

            self.active_layer.triggerRepaint()
            if self.iface.mapCanvas():
                self.iface.mapCanvas().refresh()

            footprint_note = (
                f" + {footprints_count} building footprint(s) in '{self.FOOTPRINTS_LAYER_NAME}'"
                if footprints_count > 0
                else ""
            )
            if was_editing:
                summary = f"Synced {len(updates)} parcel(s) into active edit session{footprint_note}"
            else:
                summary = f"Successfully synced {len(updates)} parcel(s) to QGIS{footprint_note}"

            if self.dialog:
                self.dialog.set_status(summary)
            return True, summary
        except Exception as e:
            if edit_command_started:
                self.active_layer.destroyEditCommand()
            if not was_editing and self.active_layer and self.active_layer.isEditable():
                self.active_layer.rollBack()
            if self.dialog:
                self.dialog.set_status(f"Sync failed: {e}", error=True)
            return False, f"Sync failed: {e}"

    def _update_building_footprints_layer(self, updates: list[dict]) -> int:
        """Create or update a dedicated 3D Building Footprints layer in the QGIS project."""
        if not self.active_layer:
            return 0

        project = QgsProject.instance()
        target_crs = self.active_layer.crs()
        authid = target_crs.authid() or "EPSG:3857"

        fp_layer = None
        for lyr in project.mapLayers().values():
            if isinstance(lyr, QgsVectorLayer) and lyr.name() == self.FOOTPRINTS_LAYER_NAME:
                fp_layer = lyr
                break

        created_new = False
        if fp_layer is None:
            fp_layer = QgsVectorLayer(f"Polygon?crs={authid}", self.FOOTPRINTS_LAYER_NAME, "memory")
            pr = fp_layer.dataProvider()
            pr.addAttributes([
                _make_field("parcel_fid", "integer"),
                _make_field("part_role", "string"),
                _make_field("usage", "string"),
                _make_field("typology", "string"),
                _make_field("roof_style", "string"),
                _make_field("floors", "integer"),
                _make_field("floor_h", "double"),
                _make_field("height_m", "double"),
                _make_field("z_base", "double"),
                _make_field("z_top", "double"),
                _make_field("gfa", "double"),
                _make_field("far", "double"),
                _make_field("bcr", "double"),
                _make_field("plan_score", "double"),
                _make_field("pop_est", "integer"),
            ])
            fp_layer.updateFields()
            created_new = True

        pr = fp_layer.dataProvider()
        updated_parcel_ids = {int(u.get("id")) for u in updates if u.get("id") is not None}

        # Remove previous footprint features belonging to the updated parcels
        to_delete = []
        p_idx = fp_layer.fields().indexOf("parcel_fid")
        if p_idx >= 0:
            for existing_f in fp_layer.getFeatures():
                with suppress(Exception):
                    if int(existing_f.attribute(p_idx)) in updated_parcel_ids:
                        to_delete.append(existing_f.id())
        if to_delete:
            pr.deleteFeatures(to_delete)

        xform = None
        if self.crs_transformed:
            xform = QgsCoordinateTransform(
                QgsCoordinateReferenceSystem("EPSG:3857"),
                target_crs,
                project,
            )

        new_features = []
        for item in updates:
            fid = int(item.get("id", 0))
            usage_val = str(item.get("usage", "Residential"))
            if usage_val == "Park":
                continue

            typology_val = str(item.get("typology", "Tower"))
            roof_style_val = str(item.get("roof_style", "Flat"))
            floors_val = int(item.get("floors", 1))
            floor_h_val = float(item.get("floor_h", 3.0))
            height_m_val = float(item.get("height_m", floors_val * floor_h_val))
            gfa_val = float(item.get("gfa", 0))
            far_val = float(item.get("far", 0))
            bcr_val = float(item.get("bcr", 0))
            plan_score_val = float(item.get("plan_score", 0))
            pop_est_val = int(item.get("pop_est", 0))

            footprints = item.get("building_footprints") or []
            if not footprints:
                coords = item.get("coordinates") or []
                if len(coords) >= 3:
                    footprints = [{
                        "role": typology_val,
                        "outer": coords,
                        "holes": [],
                        "floors": floors_val,
                        "height_m": height_m_val,
                        "z_base": 0.0,
                        "z_top": height_m_val,
                    }]

            for fp in footprints:
                outer = fp.get("outer") or []
                if len(outer) < 3:
                    continue
                outer_pts = [QgsPointXY(float(pt[0]), float(pt[1])) for pt in outer]
                if outer_pts[0] != outer_pts[-1]:
                    outer_pts.append(outer_pts[0])
                rings = [outer_pts]

                for hole in fp.get("holes") or []:
                    if len(hole) >= 3:
                        hole_pts = [QgsPointXY(float(pt[0]), float(pt[1])) for pt in hole]
                        if hole_pts[0] != hole_pts[-1]:
                            hole_pts.append(hole_pts[0])
                        rings.append(hole_pts)

                geom = QgsGeometry.fromPolygonXY(rings)
                if xform is not None:
                    geom.transform(xform)

                part_floors = int(fp.get("floors", floors_val))
                part_h = float(fp.get("height_m", height_m_val))
                part_z_base = float(fp.get("z_base", 0.0))
                part_z_top = float(fp.get("z_top", part_z_base + part_h))
                part_role = str(fp.get("role", typology_val))

                feat = QgsFeature(fp_layer.fields())
                feat.setGeometry(geom)
                feat.setAttributes([
                    fid,
                    part_role,
                    usage_val,
                    typology_val,
                    roof_style_val,
                    part_floors,
                    floor_h_val,
                    part_h,
                    part_z_base,
                    part_z_top,
                    gfa_val,
                    far_val,
                    bcr_val,
                    plan_score_val,
                    pop_est_val,
                ])
                new_features.append(feat)

        if new_features:
            pr.addFeatures(new_features)
        fp_layer.updateExtents()

        if created_new:
            project.addMapLayer(fp_layer)

        if self.style_footprints_layer:
            self._apply_landuse_symbology(fp_layer, is_footprint=True)

        fp_layer.triggerRepaint()
        return len(new_features)

    def _apply_landuse_symbology(self, layer: QgsVectorLayer, *, is_footprint: bool = True) -> None:
        """Apply clean land-use categorized colors and optional 3D extrusion renderer."""
        with suppress(Exception):
            palette = [
                ("Residential", "#d97706", "#78350f", "Residential"),
                ("MixedUse", "#0d9488", "#115e59", "Mixed-Use"),
                ("Commercial", "#2563eb", "#1e3a8a", "Commercial"),
                ("Civic", "#64748b", "#334155", "Civic / Institutional"),
                ("Park", "#16a34a", "#14532d", "Public Park"),
            ]
            categories = []
            for val, fill_hex, stroke_hex, label in palette:
                sym = QgsFillSymbol.createSimple({
                    "color": fill_hex if is_footprint else f"{fill_hex}55",
                    "outline_color": stroke_hex,
                    "outline_width": "0.45" if is_footprint else "0.6",
                })
                categories.append(QgsRendererCategory(val, sym, label))

            renderer = QgsCategorizedSymbolRenderer("usage", categories)
            layer.setRenderer(renderer)

        if is_footprint:
            with suppress(Exception):
                from qgis._3d import QgsPolygon3DSymbol, QgsVectorLayer3DRenderer
                sym3d = QgsPolygon3DSymbol()
                sym3d.setExtrusionHeight(12.0)
                with suppress(Exception):
                    from qgis.core import QgsProperty
                    prop = sym3d.dataDefinedProperties()
                    prop.setProperty(QgsPolygon3DSymbol.Property.ExtrusionHeight, QgsProperty.fromField("height_m"))
                    sym3d.setDataDefinedProperties(prop)
                r3d = QgsVectorLayer3DRenderer(sym3d)
                layer.setRenderer3D(r3d)

    def _error(self, title: str, text: str) -> None:
        QMessageBox.critical(self.iface.mainWindow(), title, text)
