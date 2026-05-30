# -*- coding: utf-8 -*-
"""Multi-tab QDialog with layer picker, server options, and premium dark styling.
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
        self.resize(500, 380)
        self._apply_theme()
        self._build_ui()

    def _apply_theme(self) -> None:
        qss = """
        QDialog {
            background-color: #0b0f19;
            color: #f8fafc;
        }
        QTabWidget::pane {
            border: 1px solid #1e293b;
            background: #0f172a;
            border-radius: 8px;
            padding: 10px;
        }
        QTabBar::tab {
            background: #1e293b;
            color: #94a3b8;
            padding: 10px 16px;
            border-top-left-radius: 6px;
            border-top-right-radius: 6px;
            margin-right: 3px;
            font-weight: 500;
        }
        QTabBar::tab:selected {
            background: #0f766e;
            color: #f8fafc;
            border-bottom: 2px solid #0d9488;
            font-weight: bold;
        }
        QTabBar::tab:hover:!selected {
            background: #27272a;
            color: #f8fafc;
        }
        QLabel {
            color: #e2e8f0;
            font-family: "Inter", "Segoe UI", Helvetica, sans-serif;
            font-size: 12px;
        }
        QLineEdit, QSpinBox, QComboBox {
            background-color: #1e293b;
            color: #f8fafc;
            border: 1px solid #475569;
            border-radius: 6px;
            padding: 6px 10px;
            min-height: 20px;
        }
        QLineEdit:focus, QSpinBox:focus, QComboBox:focus {
            border: 1px solid #0d9488;
            background-color: #0f172a;
        }
        QCheckBox {
            color: #e2e8f0;
            spacing: 8px;
        }
        QCheckBox::indicator {
            width: 16px;
            height: 16px;
            background-color: #1e293b;
            border: 1px solid #475569;
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

        # Branded Header Card
        header = QLabel(" PLANX SYSTEM  |  URBAN PROCEDURAL 3D")
        header.setStyleSheet("""
            background-color: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 #0f766e, stop:1 #0f172a);
            color: #f8fafc;
            font-family: 'Inter', 'Segoe UI', Helvetica, sans-serif;
            font-size: 13px;
            font-weight: bold;
            padding: 12px;
            border-radius: 6px;
            border: 1px solid rgba(20, 184, 166, 0.2);
        """)
        root.addWidget(header)

        self.tabs = QTabWidget()
        self.tabs.addTab(self._build_inputs_tab(), "Input Layer")
        self.tabs.addTab(self._build_options_tab(), "Server Options")
        self.tabs.addTab(self._build_about_tab(), "About")
        root.addWidget(self.tabs, 1)

        self.status = QLabel("Ready")
        self.status.setStyleSheet("color: #64748b; padding: 4px; font-weight: bold; font-family: monospace;")
        root.addWidget(self.status)

        buttons = QDialogButtonBox()
        self.run_btn = buttons.addButton("Run", QDialogButtonBox.ButtonRole.AcceptRole)
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
        form.addRow("Active Layer:", self.input_layer)

        info_lbl = QLabel(
            "<p style='color: #94a3b8; font-size: 11px; line-height: 1.4;'>"
            "The selected vector polygon layer (representing parcels or building blocks) "
            "will be exported to the interactive 3D Web Cockpit. Parametric changes "
            "adjusted in the browser will sync directly back to this QGIS layer."
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
        form.addRow("Local Port:", self.port)

        self.launch_browser = QCheckBox("Auto-Launch Browser")
        self.launch_browser.setChecked(True)
        form.addRow(self.launch_browser)

        return w

    def _build_about_tab(self) -> QWidget:
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.setContentsMargins(10, 10, 10, 10)
        
        desc = QLabel(
            "<h3>PlanX Urban Procedural 3D</h3>"
            "<p style='color: #94a3b8;'>Parametric 3D urban design and procedural planning toolbox with real-time compliance feedback loops.</p>"
            "<p style='color: #94a3b8;'>Developed for education and classroom workflows at Dokuz Eylul University, Department of City and Regional Planning.</p>"
            "<p style='color: #e2e8f0;'>Report issues: "
            "<a href='https://github.com/YusufEminoglu/planx_urban_procedural_3d/issues' style='color: #38bdf8;'>GitHub Issues</a></p>"
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
        color = "#f43f5e" if error else "#14b8a6"
        self.status.setStyleSheet(f"color: {color}; padding: 4px; font-weight: bold; font-family: monospace;")
        self.status.setText(text)
