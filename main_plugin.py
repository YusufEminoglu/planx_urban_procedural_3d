# -*- coding: utf-8 -*-
"""PlanX Urban Procedural 3D — main plugin class.
"""
from __future__ import annotations

import os
import webbrowser
from qgis.PyQt.QtGui import QIcon
from qgis.PyQt.QtWidgets import QAction, QMessageBox
from qgis.core import (
    QgsProject,
    QgsVectorLayer,
    QgsJsonExporter,
    QgsFeature,
    QgsGeometry,
    QgsPoint,
    QgsPolygon,
    QgsLineString,
    QgsMessageLog
)

from .dialog import PluginDialog
from .server import PlanXProceduralServer

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
            self.export_crs = QgsCoordinateReferenceSystem("EPSG:3857") # Web Mercator (meters)
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
            exporter.setDestinationCrs(self.export_crs) # Export in export CRS (meters if layer is geographic)
            
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
        """Callback executed by the server thread when POST /sync is received."""
        if not self.active_layer:
            return False, "QGIS active layer is not set"

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
                "max_height": "double"
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
            
            if fields_to_create:
                self.active_layer.dataProvider().addAttributes(fields_to_create)
                self.active_layer.updateFields()
            
            # Start editing
            self.active_layer.startEditing()

            for item in updates:
                fid = int(item.get("id"))
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
                coords = item.get("coordinates", [])

                # Update attributes
                self.active_layer.changeAttributeValue(fid, self.active_layer.fields().indexOf("far"), far_val)
                self.active_layer.changeAttributeValue(fid, self.active_layer.fields().indexOf("bcr"), bcr_val)
                self.active_layer.changeAttributeValue(fid, self.active_layer.fields().indexOf("gfa"), gfa_val)
                self.active_layer.changeAttributeValue(fid, self.active_layer.fields().indexOf("setback"), setback_val)
                self.active_layer.changeAttributeValue(fid, self.active_layer.fields().indexOf("floors"), floors_val)
                self.active_layer.changeAttributeValue(fid, self.active_layer.fields().indexOf("usage"), usage_val)
                self.active_layer.changeAttributeValue(fid, self.active_layer.fields().indexOf("floor_h"), floor_h_val)
                self.active_layer.changeAttributeValue(fid, self.active_layer.fields().indexOf("typology"), typology_val)
                self.active_layer.changeAttributeValue(fid, self.active_layer.fields().indexOf("max_bcr"), max_bcr_val)
                self.active_layer.changeAttributeValue(fid, self.active_layer.fields().indexOf("max_far"), max_far_val)
                self.active_layer.changeAttributeValue(fid, self.active_layer.fields().indexOf("max_height"), max_height_val)

                # Optional: Update geometry if coords are sent back (setback footprint)
                if coords and len(coords) >= 3:
                    pts = [QgsPoint(pt[0], pt[1]) for pt in coords]
                    # close the ring if not closed
                    if pts[0] != pts[-1]:
                        pts.append(pts[0])
                    ring = QgsLineString(pts)
                    poly_geom = QgsGeometry(QgsPolygon(ring))
                    
                    # Re-project back to geographic CRS if we exported in EPSG:3857
                    if self.crs_transformed:
                        from qgis.core import QgsCoordinateTransform, QgsProject, QgsCoordinateReferenceSystem
                        xform = QgsCoordinateTransform(
                            QgsCoordinateReferenceSystem("EPSG:3857"),
                            self.active_layer.crs(),
                            QgsProject.instance()
                        )
                        poly_geom.transform(xform)
                        
                    self.active_layer.changeGeometry(fid, poly_geom)

            # Commit changes
            self.active_layer.commitChanges()
            # Trigger canvas redraw
            self.active_layer.triggerRepaint()
            self.iface.mapCanvas().refresh()
            
            return True, f"Successfully synced {len(updates)} features back to QGIS"
        except Exception as e:
            self.active_layer.rollBack()
            return False, f"Sync failed: {e}"

    def _error(self, title: str, text: str) -> None:
        QMessageBox.critical(self.iface.mainWindow(), title, text)
