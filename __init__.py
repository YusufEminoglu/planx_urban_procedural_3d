"""QGIS plugin entry point."""
from .main_plugin import PlanXUrbanProcedural3D


def classFactory(iface):
    return PlanXUrbanProcedural3D(iface)
