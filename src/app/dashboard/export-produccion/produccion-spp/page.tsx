"use client";
// src/app/dashboard/export-produccion/produccion-spp/page.tsx
import FilterList from "@/components/export-produccion/FilterList";

export default function ProduccionSppPage() {
  return (
    <FilterList
      modulo="produccion-spp"
      basePath="/dashboard/export-produccion/produccion-spp"
      hasDetail
    />
  );
}
