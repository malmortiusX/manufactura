"use client";
// src/app/dashboard/export-produccion/beneficio/page.tsx
import FilterList from "@/components/export-produccion/FilterList";

export default function BeneficioPage() {
  return (
    <FilterList
      modulo="beneficio"
      basePath="/dashboard/export-produccion/beneficio"
      hasDetail
    />
  );
}
