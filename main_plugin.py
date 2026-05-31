# -*- coding: utf-8 -*-
"""PlanX Urban Procedural 3D main plugin class.
"""
from __future__ import annotations

import os
import threading
import webbrowser
from qgis.PyQt.QtCore import QObject, QCoreApplication, QThread, pyqtSignal, pyqtSlot
from qgis.PyQt.QtGui import QIcon
from qgis.PyQt.QtWidgets import QAction, QMessageBox
from qgis.core import (
    QgsVectorLayer,
    QgsJsonExporter,
    QgsGeometry,
    QgsPointXY,
)

from .dialog import PluginDialog
from .server import PlanXProceduralServer


class _SyncBridge(QObject):
    """Marshal HTTP sync requests from the server thread to QGIS' main thread."""

    request = pyqtSignal(object, object)

    def __init__(self, plugin):
        super().__init__()
        self.plugin = plugin
        self.request.connect(self._handle_request)

    @pyqtSlot(object, object)
    def _handle_request(self, data, token):
        try:
            token["result"] = self.plugin._sync_to_qgis(data)
        except Exception as exc:
            token["result"] = (False, f"Sync failed: {exc}")
        finally:
            token["event"].set()


class PlanXUrbanProcedural3D:
    MENU_NAME = "&PlanX Urban Procedural 3D"

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
        self.dialog.show()
        self.dialog.raise_()
        self.dialog.activateWindow()

    def run_action(self, params: dict) -> None:
        layer = params["layer"]
        port = params["port"]
        launch = params["launch_browser"]

        if not isinstance(layer, QgsVectorLayer):
            self._error("Error", "Active layer must be a valid vector layer.")
            return

        self.active_layer = layer

        # Check Coordinate Reference System (CRS) unit type
        crs = layer.crs()
        crs_is_geographic = crs.isGeographic()

        from qgis.core import QgsCoordinateReferenceSystem
        if crs_is_geographic:
            self.export_crs = QgsCoordinateReferenceSystem("EPSG:3857")  # Web Mercator (meters)
            self.crs_transformed = True
            self.iface.messageBar().pushWarning(
                "PlanX Urban Procedural 3D",
                "Active layer uses geographic coordinates (degrees). "
                "Geometries are automatically projected to Web Mercator (meters) for local 3D rendering."
            )
        else:
            self.export_crs = crs
            self.crs_transformed = False

        # Prepare directory paths
        web_dir = os.path.join(self.plugin_dir, "web")

        # Verify web directory exists
        if not os.path.exists(web_dir):
            os.makedirs(web_dir, exist_ok=True)

        # 1. Start Server
        try:
            if self.server:
                self.server.stop()
            self.server = PlanXProceduralServer(port, web_dir, self.sync_callback)
            self.server.start()
        except Exception as e:
            self._error("Server Error", f"Could not start local server on port {port}:\n{e}")
            return

        # 2. Export GeoJSON
        try:
            exporter = QgsJsonExporter(layer)
            # Enable coordinate precision and include ID
            exporter.setPrecision(6)
            exporter.setIncludeAttributes(True)
            exporter.setDestinationCrs(self.export_crs)  # Export in export CRS (meters if layer is geographic)

            features = list(layer.getFeatures())
            geojson_str = exporter.exportFeatures(features)

            # Inject CRS information so Web UI knows if it is geographic
            try:
                import json
                geojson_dict = json.loads(geojson_str)
                geojson_dict["crs_is_geographic"] = crs_is_geographic
                geojson_str = json.dumps(geojson_dict)
            except Exception as json_err:
                from qgis.core import QgsMessageLog, Qgis
                QgsMessageLog.logMessage(f"Failed to inject CRS info: {json_err}", "PlanX", Qgis.Warning)

            self.server.update_geojson(geojson_str)
        except Exception as e:
            self._error("Data Export Error", f"Could not convert layer features to GeoJSON format:\n{e}")
            return

        msg = f"Server started on port {port}. Layer features loaded successfully."
        if crs_is_geographic:
            msg += " WARNING: Geographic CRS detected (degrees)."
            self.iface.messageBar().pushWarning("PlanX Urban Procedural 3D", msg)
            if self.dialog:
                self.dialog.set_status(msg, error=True)
        else:
            self.iface.messageBar().pushSuccess("PlanX Urban Procedural 3D", msg)
            if self.dialog:
                self.dialog.set_status(msg)

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
        """Apply browser-side design updates to the active QGIS layer."""
        if not self.active_layer:
            return False, "QGIS active layer is not set"

        was_editing = self.active_layer.isEditable()
        edit_command_started = False

        try:
            updates = data.get("updates", [])
            if not updates:
                return True, "No updates provided"

            # Check if fields exist, create them if not
            fields_to_add = {
                "far": "double",
                "bcr": "double",
                "gfa": "double",
                "setback": "double",
                "floors": "integer",
                "usage": "string",
                "floor_h": "double",
                "typology": "string",
                "max_bcr": "double",
                "max_far": "double",
                "max_height": "double",
                "roof_style": "string",
                "stepback_i": "integer",
                "stepback_d": "double"
            }

            # Check if fields exist, create them if not (before starting edit session)
            existing_fields = [f.name() for f in self.active_layer.fields()]

            from qgis.PyQt.QtCore import QVariant
            fields_to_create = []
            for name, ftype in fields_to_add.items():
                if name not in existing_fields:
                    from qgis.core import QgsField
                    if ftype == "double":
                        fields_to_create.append(QgsField(name, QVariant.Double))
                    elif ftype == "integer":
                        fields_to_create.append(QgsField(name, QVariant.Int))
                    else:
                        fields_to_create.append(QgsField(name, QVariant.String))

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
                coords = item.get("coordinates", [])

                # Update attributes
                values = {
                    "far": far_val,
                    "bcr": bcr_val,
                    "gfa": gfa_val,
                    "setback": setback_val,
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
                }
                for name, value in values.items():
                    if not self.active_layer.changeAttributeValue(fid, field_indices[name], value):
                        raise RuntimeError(f"Could not update '{name}' for feature {fid}")

                # Optional: Update geometry if coords are sent back (setback footprint)
                if coords and len(coords) >= 3:
                    pts = [QgsPointXY(float(pt[0]), float(pt[1])) for pt in coords]
                    # close the ring if not closed
                    if pts[0] != pts[-1]:
                        pts.append(pts[0])
                    poly_geom = QgsGeometry.fromPolygonXY([pts])

                    # Re-project back to geographic CRS if we exported in EPSG:3857
                    if self.crs_transformed:
                        from qgis.core import QgsCoordinateTransform, QgsProject, QgsCoordinateReferenceSystem
                        xform = QgsCoordinateTransform(
                            QgsCoordinateReferenceSystem("EPSG:3857"),
                            self.active_layer.crs(),
                            QgsProject.instance()
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

            # Trigger canvas redraw
            self.active_layer.triggerRepaint()
            self.iface.mapCanvas().refresh()

            if was_editing:
                return True, f"Synced {len(updates)} features into the active edit session"
            return True, f"Successfully synced {len(updates)} features back to QGIS"
        except Exception as e:
            if edit_command_started:
                self.active_layer.destroyEditCommand()
            if not was_editing and self.active_layer and self.active_layer.isEditable():
                self.active_layer.rollBack()
            return False, f"Sync failed: {e}"

    def _error(self, title: str, text: str) -> None:
        QMessageBox.critical(self.iface.mainWindow(), title, text)
