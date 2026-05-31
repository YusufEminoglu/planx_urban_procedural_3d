# -*- coding: utf-8 -*-
"""Multi-tab QDialog with layer picker, server options, and release-ready styling.
"""
from __future__ import annotations

from qgis.PyQt.QtCore import pyqtSignal
from qgis.PyQt.QtWidgets import (
    QCheckBox,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QHBoxLayout,
    QLabel,
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

    def __init__(self, iface, parent=None):
        super().__init__(parent)
        self.iface = iface
        self.setWindowTitle("PlanX Urban Procedural 3D")
        self.resize(540, 430)
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
        QLineEdit, QSpinBox, QComboBox {
            background-color: #ffffff;
            color: #0f172a;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 6px 10px;
            min-height: 20px;
        }
        QLineEdit:focus, QSpinBox:focus, QComboBox:focus {
            border: 1px solid #0d9488;
            background-color: #f8fafc;
        }
        QCheckBox {
            color: #334155;
            spacing: 8px;
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
            padding: 8px 18px;
            font-weight: bold;
            font-size: 12px;
        }
        QPushButton:hover {
            background-color: #0d9488;
        }
        QPushButton:pressed {
            background-color: #115e59;
        }
        """
        self.setStyleSheet(qss)

    def _build_ui(self) -> None:
        root = QVBoxLayout(self)
        root.setContentsMargins(15, 15, 15, 15)
        root.setSpacing(12)

        header = QLabel("PLANX URBAN PROCEDURAL 3D")
        header.setStyleSheet("""
            background-color: #0f766e;
            color: #ffffff;
            font-family: 'Inter', 'Segoe UI', Helvetica, sans-serif;
            font-size: 14px;
            font-weight: bold;
            padding: 12px;
            border-radius: 6px;
            border: 1px solid #0d9488;
        """)
        root.addWidget(header)

        subtitle = QLabel(
            "Select a polygon layer, launch the local 3D planning cockpit, "
            "and sync edited planning metrics back to QGIS."
        )
        subtitle.setWordWrap(True)
        subtitle.setStyleSheet("color: #475569; line-height: 1.35; padding: 0 2px;")
        root.addWidget(subtitle)

        self.tabs = QTabWidget()
        self.tabs.addTab(self._build_inputs_tab(), "Input Layer")
        self.tabs.addTab(self._build_options_tab(), "Server Options")
        self.tabs.addTab(self._build_about_tab(), "About")
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
        form.setSpacing(12)

        self.input_layer = QgsMapLayerComboBox()
        self.input_layer.setFilters(QgsMapLayerProxyModel.VectorLayer)
        form.addRow("Polygon layer:", self.input_layer)

        info_lbl = QLabel(
            "<p style='color: #475569; font-size: 11px; line-height: 1.5;'>"
            "Choose a vector polygon layer representing parcels, blocks, or study sites. "
            "A projected CRS in meters is recommended for accurate setbacks, areas, and height envelopes. "
            "Browser edits are written back to this layer when you use Sync to QGIS."
            "</p>"
        )
        info_lbl.setWordWrap(True)
        form.addRow(info_lbl)

        return w

    def _build_options_tab(self) -> QWidget:
        w = QWidget()
        form = QFormLayout(w)
        form.setContentsMargins(10, 10, 10, 10)
        form.setSpacing(12)

        self.port = QSpinBox()
        self.port.setRange(1024, 65535)
        self.port.setValue(8090)
        form.addRow("Local server port:", self.port)

        self.launch_browser = QCheckBox("Open browser automatically")
        self.launch_browser.setChecked(True)
        form.addRow(self.launch_browser)

        return w

    def _build_about_tab(self) -> QWidget:
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(10, 10, 10, 10)
        
        desc = QLabel(
            "<h3>PlanX Urban Procedural 3D</h3>"
            "<p style='color: #475569; line-height: 1.5;'>Parametric 3D urban design and procedural planning toolbox with real-time BCR/FAR compliance feedback.</p>"
            "<p style='color: #475569; line-height: 1.5;'>Built for global QGIS planning workflows: review parcels, generate massing options, test zoning limits, and return clean metrics to the project layer.</p>"
            "<p style='color: #0f172a;'>Report issues: "
            "<a href='https://github.com/YusufEminoglu/planx_urban_procedural_3d/issues' style='color: #0f766e;'>GitHub Issues</a></p>"
        )
        desc.setOpenExternalLinks(True)
        layout.addWidget(desc)
        layout.addStretch(1)
        return w

    def _emit_run(self) -> None:
        layer = self.input_layer.currentLayer()
        if not layer:
            self.set_status("Please select a valid active layer.", error=True)
            return

        params = {
            "layer": layer,
            "port": self.port.value(),
            "launch_browser": self.launch_browser.isChecked(),
        }
        self.runRequested.emit(params)

    def set_status(self, text: str, *, error: bool = False) -> None:
        color = "#dc2626" if error else "#0f766e"
        self.status.setStyleSheet(f"color: {color}; padding: 4px; font-weight: bold; font-family: monospace;")
        self.status.setText(text)
