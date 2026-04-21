"use client";
// src/app/dashboard/export-produccion/entrada-desprese/page.tsx
import FilterList from "@/components/export-produccion/FilterList";

export default function EntradaDesPresePage() {
  return (
    <FilterList
      modulo="entrada-desprese"
      basePath="/dashboard/export-produccion/entrada-desprese"
      hasDetail
    />
  );
}
