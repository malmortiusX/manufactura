"use client";
// src/app/dashboard/export-produccion/desprese/page.tsx
import FilterList from "@/components/export-produccion/FilterList";

export default function DesPresePage() {
  return (
    <FilterList
      modulo="desprese"
      basePath="/dashboard/export-produccion/desprese"
      hasDetail
    />
  );
}
