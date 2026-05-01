"use client";
// src/app/dashboard/export-produccion/produccion-cpp/page.tsx
import FilterList from "@/components/export-produccion/FilterList";

export default function ProduccionCppPage() {
  return (
    <FilterList
      modulo="produccion-cpp"
      basePath="/dashboard/export-produccion/produccion-cpp"
      hasDetail
    />
  );
}
