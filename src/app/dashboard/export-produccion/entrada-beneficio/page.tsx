"use client";
// src/app/dashboard/export-produccion/entrada-beneficio/page.tsx
import FilterList from "@/components/export-produccion/FilterList";

export default function EntradaBeneficioPage() {
  return (
    <FilterList
      modulo="entrada-beneficio"
      basePath="/dashboard/export-produccion/entrada-beneficio"
      hasDetail
    />
  );
}
