# -*- coding: utf-8 -*-
"""Multi-tab QDialog with layer picker and server options.
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
        self.resize(500, 360)
        self._build_ui()

    def _build_ui(self) -> None:
        root = QVBoxLayout(self)

        self.tabs = QTabWidget()
        self.tabs.addTab(self._build_inputs_tab(), "Girdi Katmanı")
        self.tabs.addTab(self._build_options_tab(), "Sunucu Seçenekleri")
        self.tabs.addTab(self._build_about_tab(), "Hakkında")
        root.addWidget(self.tabs, 1)

        self.status = QLabel("Hazır")
        self.status.setStyleSheet("color: #64748b; padding: 4px; font-weight: bold;")
        root.addWidget(self.status)

        buttons = QDialogButtonBox()
        self.run_btn = buttons.addButton("Çalıştır", QDialogButtonBox.ButtonRole.AcceptRole)
        buttons.addButton(QDialogButtonBox.StandardButton.Close)
        buttons.accepted.connect(self._emit_run)
        buttons.rejected.connect(self.close)
        root.addWidget(buttons)

    def _build_inputs_tab(self) -> QWidget:
        w = QWidget()
        form = QFormLayout(w)

        self.input_layer = QgsMapLayerComboBox()
        self.input_layer.setFilters(QgsMapLayerProxyModel.VectorLayer)
        form.addRow("Çalışma Katmanı:", self.input_layer)

        info_lbl = QLabel(
            "<p style='color: #475569; font-size: 11px;'>"
            "Seçilen poligon katmanı (örneğin parseller veya yapı adaları), "
            "tarayıcı tabanlı interaktif 3D editöre aktarılacak ve oradaki değişiklikler "
            "doğrudan bu katmana geri yazılacaktır."
            "</p>"
        )
        info_lbl.setWordWrap(True)
        form.addRow(info_lbl)

        return w

    def _build_options_tab(self) -> QWidget:
        w = QWidget()
        form = QFormLayout(w)

        self.port = QSpinBox()
        self.port.setRange(1024, 65535)
        self.port.setValue(8090)
        form.addRow("Lokal Port:", self.port)

        self.launch_browser = QCheckBox("Tarayıcıyı Otomatik Aç")
        self.launch_browser.setChecked(True)
        form.addRow(self.launch_browser)

        return w

    def _build_about_tab(self) -> QWidget:
        w = QWidget()
        layout = QVBoxLayout(w)
        layout.addWidget(QLabel(
            "<h3>PlanX Urban Procedural 3D</h3>"
            "<p>Parametric 3D urban design and procedural planning toolbox with Modelur-style feedback loops.</p>"
            "<p>Developed for classroom and professional planning workflows at Dokuz Eylul University.</p>"
            "<p>Sorun bildirimi: "
            "<a href='https://github.com/YusufEminoglu/planx_urban_procedural_3d/issues'>GitHub Issues</a></p>"
        ))
        layout.addStretch(1)
        return w

    def _emit_run(self) -> None:
        layer = self.input_layer.currentLayer()
        if not layer:
            self.set_status("Lütfen geçerli bir çalışma katmanı seçin.", error=True)
            return

        params = {
            "layer": layer,
            "port": self.port.value(),
            "launch_browser": self.launch_browser.isChecked(),
        }
        self.runRequested.emit(params)

    def set_status(self, text: str, *, error: bool = False) -> None:
        color = "#e11d48" if error else "#0f766e"
        self.status.setStyleSheet(f"color: {color}; padding: 4px; font-weight: bold;")
        self.status.setText(text)
