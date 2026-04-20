"use client";
// src/app/dashboard/layout.tsx
import Sidebar from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";
import { usePathname } from "next/navigation";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dashboard/employees": "Empleados",
  "/dashboard/users": "Usuarios",
  "/dashboard/reports": "Reportes",
  "/dashboard/export-production": "Exportar Salida Desprese",
  "/dashboard/export-entrada":    "Exportar Entrada Desprese",
  "/dashboard/settings": "Configuración",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const title = pageTitles[pathname]
    ?? (pathname.startsWith("/dashboard/export-production/") ? "Exportar Salida Desprese"
      : pathname.startsWith("/dashboard/export-entrada/")   ? "Exportar Entrada Desprese"
      : "Dashboard");

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col ml-64 overflow-hidden">
        <Topbar title={title} />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
