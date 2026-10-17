# -*- coding: utf-8 -*-
"""Multi-tab QDialog with layer picker, sample city generator, sync options, and server log."""
from __future__ import annotations

import datetime
import webbrowser
from qgis.PyQt.QtCore import pyqtSignal
from qgis.PyQt.QtWidgets import (
    QCheckBox,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QPlainTextEdit,
    QPushButton,
    QSpinBox,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)
from qgis.core import QgsMapLayerProxyModel
from qgis.gui import QgsMapLayerComboBox


class PluginDialog(QDialog):
    runRequested = pyqtSignal(dict)
    sampleLayerRequested = pyqtSignal()
    stopServerRequested = pyqtSignal()

    def __init__(self, iface, parent=None):
        super().__init__(parent)
        self.iface = iface
        self.active_server_port: int | None = None
        self.setWindowTitle("PlanX Urban Procedural 3D")
        self.resize(580, 520)
        self._apply_theme()
        self._build_ui()

    def _apply_theme(self) -> None:
        qss = """
        QDialog {
            background-color: #f8fafc;
            color: #0f172a;
        }
        QTabWidget::pane {
            border: 1px solid #cbd5e1;
            background: #ffffff;
            border-radius: 8px;
            padding: 10px;
        }
        QTabBar::tab {
            background: #e2e8f0;
            color: #475569;
            padding: 10px 16px;
            border-top-left-radius: 6px;
            border-top-right-radius: 6px;
            margin-right: 3px;
            font-weight: 500;
        }
        QTabBar::tab:selected {
            background: #0f766e;
            color: #ffffff;
            border-bottom: 2px solid #0d9488;
            font-weight: bold;
        }
        QTabBar::tab:hover:!selected {
            background: #cbd5e1;
            color: #0f172a;
        }
        QLabel {
            color: #0f172a;
            font-family: "Inter", "Segoe UI", Helvetica, sans-serif;
            font-size: 12px;
        }
        QLineEdit, QSpinBox, QComboBox, QPlainTextEdit {
            background-color: #ffffff;
            color: #0f172a;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 6px 10px;
            min-height: 20px;
        }
        QLineEdit:focus, QSpinBox:focus, QComboBox:focus, QPlainTextEdit:focus {
            border: 1px solid #0d9488;
            background-color: #f8fafc;
        }
        QCheckBox {
            color: #334155;
            spacing: 8px;
            font-size: 12px;
        }
        QCheckBox::indicator {
            width: 16px;
            height: 16px;
            background-color: #ffffff;
            border: 1px solid #94a3b8;
            border-radius: 4px;
        }
        QCheckBox::indicator:checked {
            background-color: #0d9488;
            border-color: #14b8a6;
        }
        QPushButton {
            background-color: #0f766e;
            color: #ffffff;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            padding: 8px 16px;
            font-weight: bold;
            font-size: 12px;
        }
        QPushButton:hover {
            background-color: #0d9488;
        }
        QPushButton:pressed {
            background-color: #115e59;
        }
        QPushButton:disabled {
            background-color: #94a3b8;
            color: #f1f5f9;
        }
        """
        self.setStyleSheet(qss)

    def _build_ui(self) -> None:
        root = QVBoxLayout(self)
        root.setContentsMargins(15, 15, 15, 15)
        root.setSpacing(10)

        header = QLabel("PLANX URBAN PROCEDURAL 3D — PARAMETRIC ZONING STUDIO")
        header.setStyleSheet("""
            background-color: #0f766e;
            color: #ffffff;
            font-family: 'Inter', 'Segoe UI', Helvetica, sans-serif;
            font-size: 13px;
            font-weight: bold;
            padding: 12px;
            border-radius: 6px;
            border: 1px solid #0d9488;
        """)
        root.addWidget(header)

        subtitle = QLabel(
            "Select a parcel/block polygon layer (or generate a sample study district), "
            "launch the interactive Three.js 3D cockpit, and sync compliance metrics & 3D footprints back to QGIS."
        )
        subtitle.setWordWrap(True)
        subtitle.setStyleSheet("color: #475569; line-height: 1.35; padding: 0 2px;")
        root.addWidget(subtitle)

        self.tabs = QTabWidget()
        self.tabs.addTab(self._build_inputs_tab(), "Workspace && Layer")
        self.tabs.addTab(self._build_options_tab(), "Server && Sync Log")
        self.tabs.addTab(self._build_about_tab(), "About && Guide")
        root.addWidget(self.tabs, 1)

        self.status = QLabel("Ready to launch")
        self.status.setStyleSheet("color: #0f766e; padding: 4px; font-weight: bold; font-family: monospace;")
        root.addWidget(self.status)

        buttons = QDialogButtonBox()
        self.run_btn = buttons.addButton("Launch 3D Cockpit", QDialogButtonBox.ButtonRole.AcceptRole)
        buttons.addButton(QDialogButtonBox.StandardButton.Close)
        buttons.accepted.connect(self._emit_run)
        buttons.rejected.connect(self.close)
        root.addWidget(buttons)

    def _build_inputs_tab(self) -> QWidget:
        w = QWidget()
        form = QFormLayout(w)
        form.setContentsMargins(10, 10, 10, 10)
        form.setSpacing(10)

        self.input_layer = QgsMapLayerComboBox()
        try:  # QGIS 4 / Qt6 scoped enum
            poly_filter = QgsMapLayerProxyModel.Filter.PolygonLayer
        except AttributeError:  # QGIS 3 flat enum
            poly_filter = QgsMapLayerProxyModel.PolygonLayer
        self.input_layer.setFilters(poly_filter)
        form.addRow("Parcel / block layer:", self.input_layer)

        sample_row = QHBoxLayout()
        self.stats_lbl = QLabel("")
        self.stats_lbl.setStyleSheet("color: #0f766e; font-weight: bold; font-size: 11px;")
        sample_row.addWidget(self.stats_lbl, 1)

        self.sample_btn = QPushButton("Generate Sample Urban Block (12 Parcels)")
        self.sample_btn.setStyleSheet(
            "QPushButton { background-color: #0284c7; padding: 5px 12px; font-size: 11px; }"
            "QPushButton:hover { background-color: #0369a1; }"
        )
        self.sample_btn.setToolTip(
            "Creates a ready-to-use metric parcel layer (EPSG:3857) with 12 urban parcels, "
            "varied land uses, and realistic zoning limits."
        )
        self.sample_btn.clicked.connect(self.sampleLayerRequested.emit)
        sample_row.addWidget(self.sample_btn)
        form.addRow("", sample_row)

        self.input_layer.layerChanged.connect(self._update_layer_stats)

        self.selected_only = QCheckBox("Export only selected features when a selection exists")
        self.selected_only.setChecked(True)
        form.addRow(self.selected_only)

        self.create_footprints_layer = QCheckBox(
            "Create/update dedicated 'PlanX 3D Building Footprints' layer on Sync"
        )
        self.create_footprints_layer.setChecked(True)
        self.create_footprints_layer.setToolTip(
            "Generates a dedicated polygon layer with exact building footprints (Courtyard, Slab, "
            "L/U-Shape, Podium/Tower, Multi-Building Block) and preserves your original parcel boundaries."
        )
        form.addRow(self.create_footprints_layer)

        self.style_footprints_layer = QCheckBox(
            "Apply 2.5D / 3D land-use extrusion styling to Building Footprints layer"
        )
        self.style_footprints_layer.setChecked(True)
        form.addRow(self.style_footprints_layer)

        self.overwrite_parcel_geometry = QCheckBox(
            "Overwrite source parcel geometry with inset setback ring (not recommended)"
        )
        self.overwrite_parcel_geometry.setChecked(False)
        self.overwrite_parcel_geometry.setToolTip(
            "When unchecked (recommended), original cadastral parcel boundaries are kept intact and "
            "only planning attributes are updated on the source layer."
        )
        form.addRow(self.overwrite_parcel_geometry)

        info_lbl = QLabel(
            "<p style='color: #475569; font-size: 11px; line-height: 1.45;'>"
            "<b>Tip:</b> Keep <i>Overwrite source parcel geometry</i> unchecked so your cadastral parcel "
            "polygons stay intact while <b>PlanX 3D Building Footprints</b> receives the generated 3D building "
            "polygons, heights (<code>height_m</code>), and land-use symbology."
            "</p>"
        )
        info_lbl.setWordWrap(True)
        form.addRow(info_lbl)

        return w

    def _build_options_tab(self) -> QWidget:
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(10, 10, 10, 10)
        layout.setSpacing(10)

        form = QFormLayout()
        form.setSpacing(10)

        self.port = QSpinBox()
        self.port.setRange(1024, 65535)
        self.port.setValue(8090)
        form.addRow("Local server port:", self.port)

        self.launch_browser = QCheckBox("Open browser automatically on launch")
        self.launch_browser.setChecked(True)
        form.addRow(self.launch_browser)
        layout.addLayout(form)

        ctrl_row = QHBoxLayout()
        self.open_browser_btn = QPushButton("Open Active Cockpit in Browser")
        self.open_browser_btn.setEnabled(False)
        self.open_browser_btn.clicked.connect(self._open_active_browser)
        ctrl_row.addWidget(self.open_browser_btn)

        self.stop_server_btn = QPushButton("Stop Local Server")
        self.stop_server_btn.setEnabled(False)
        self.stop_server_btn.setStyleSheet(
            "QPushButton { background-color: #dc2626; }"
            "QPushButton:hover { background-color: #b91c1c; }"
            "QPushButton:disabled { background-color: #94a3b8; }"
        )
        self.stop_server_btn.clicked.connect(self.stopServerRequested.emit)
        ctrl_row.addWidget(self.stop_server_btn)
        layout.addLayout(ctrl_row)

        log_lbl = QLabel("<b>Live Server & Bidirectional Sync Log:</b>")
        layout.addWidget(log_lbl)

        self.sync_log = QPlainTextEdit()
        self.sync_log.setReadOnly(True)
        self.sync_log.setPlaceholderText("Server and browser synchronization events will appear here...")
        self.sync_log.setStyleSheet(
            "font-family: Consolas, monospace; font-size: 11px; background-color: #f8fafc; color: #0f172a;"
        )
        layout.addWidget(self.sync_log, 1)

        return w

    def _build_about_tab(self) -> QWidget:
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(10, 10, 10, 10)

        desc = QLabel(
            "<h3>PlanX Urban Procedural 3D</h3>"
            "<p style='color: #475569; line-height: 1.5;'>"
            "Interactive parametric 3D urban design and zoning compliance studio for QGIS."
            "</p>"
            "<ul style='color: #334155; font-size: 11px; line-height: 1.55;'>"
            "<li><b>8 Procedural Typologies:</b> Tower, Slab/Row, Courtyard, L-Shape, U-Shape, Podium Tower, Stepped Tower, Multi-Building Block.</li>"
            "<li><b>Multi-Parcel & Undo/Redo Studio:</b> Shift+Click multi-parcel editing, 30-step Undo/Redo history, and A/B Baseline Delta Scorecard.</li>"
            "<li><b>6 Thematic Heatmaps + 3D Tinting:</b> Score, Compliance, FAR Utilization, Density, Carbon, and Land Use.</li>"
            "<li><b>Non-Destructive QGIS Sync & 3D OBJ Export:</b> Syncs 25+ planning fields to parcels, builds a dedicated 2.5D/3D Building Footprints layer, and exports Wavefront <code>.obj</code> models.</li>"
            "</ul>"
            "<p style='color: #0f172a;'>"
            "Documentation: <a href='https://geophilo.com/planx_urban_procedural_3d/' style='color: #0f766e;'>Online Reference Manual</a> | "
            "Issues: <a href='https://gitlab.com/geophilo1/planx_urban_procedural_3d/-/issues' style='color: #0f766e;'>GitLab Issue Tracker</a>"
            "</p>"
        )
        desc.setWordWrap(True)
        desc.setOpenExternalLinks(True)
        layout.addWidget(desc)
        layout.addStretch(1)
        return w

    def _emit_run(self) -> None:
        layer = self.input_layer.currentLayer()
        if not layer:
            self.set_status("Please select a polygon layer or click 'Generate Sample Urban Block'.", error=True)
            return

        params = {
            "layer": layer,
            "port": self.port.value(),
            "launch_browser": self.launch_browser.isChecked(),
            "selected_only": self.selected_only.isChecked(),
            "create_footprints_layer": self.create_footprints_layer.isChecked(),
            "style_footprints_layer": self.style_footprints_layer.isChecked(),
            "overwrite_parcel_geometry": self.overwrite_parcel_geometry.isChecked(),
        }
        self.runRequested.emit(params)

    def _open_active_browser(self) -> None:
        if self.active_server_port:
            webbrowser.open(f"http://127.0.0.1:{self.active_server_port}/index.html")

    def set_server_running(self, port: int | None) -> None:
        self.active_server_port = port
        running = port is not None
        if hasattr(self, "open_browser_btn"):
            self.open_browser_btn.setEnabled(running)
        if hasattr(self, "stop_server_btn"):
            self.stop_server_btn.setEnabled(running)

    def append_log(self, message: str) -> None:
        if hasattr(self, "sync_log"):
            ts = datetime.datetime.now().strftime("%H:%M:%S")
            self.sync_log.appendPlainText(f"[{ts}] {message}")

    def set_status(self, text: str, *, error: bool = False) -> None:
        color = "#dc2626" if error else "#0f766e"
        self.status.setStyleSheet(f"color: {color}; padding: 4px; font-weight: bold; font-family: monospace;")
        self.status.setText(text)
        self.append_log(text)

    def _update_layer_stats(self) -> None:
        layer = self.input_layer.currentLayer()
        if not layer:
            if hasattr(self, "stats_lbl"):
                self.stats_lbl.setText("No layer selected. Click 'Generate Sample Urban Block' to start immediately.")
            return
        total = layer.featureCount()
        selected = layer.selectedFeatureCount()
        crs_auth = layer.crs().authid() or "Unknown CRS"
        unit_tag = "geographic (auto-projected)" if layer.crs().isGeographic() else "metric"
        if hasattr(self, "stats_lbl"):
            if selected > 0:
                self.stats_lbl.setText(f"{total} parcels ({selected} selected) · {crs_auth} ({unit_tag})")
            else:
                self.stats_lbl.setText(f"{total} parcels (all exported) · {crs_auth} ({unit_tag})")

    def showEvent(self, event) -> None:
        super().showEvent(event)
        self._update_layer_stats()
