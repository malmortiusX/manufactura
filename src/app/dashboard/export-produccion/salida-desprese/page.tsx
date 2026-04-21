"use client";
// src/app/dashboard/export-produccion/salida-desprese/page.tsx
import FilterList from "@/components/export-produccion/FilterList";

export default function SalidaDesPresePage() {
  return (
    <FilterList
      modulo="salida-desprese"
      basePath="/dashboard/export-produccion/salida-desprese"
      hasDetail
    />
  );
}
