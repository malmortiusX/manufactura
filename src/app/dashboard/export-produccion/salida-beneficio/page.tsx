"use client";
// src/app/dashboard/export-produccion/salida-beneficio/page.tsx
import FilterList from "@/components/export-produccion/FilterList";

export default function SalidaBeneficioPage() {
  return (
    <FilterList
      modulo="salida-beneficio"
      basePath="/dashboard/export-produccion/salida-beneficio"
      hasDetail
    />
  );
}
