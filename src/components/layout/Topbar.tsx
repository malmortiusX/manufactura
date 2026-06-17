"use client";
// src/components/layout/Topbar.tsx
import { useSession } from "@/lib/auth-client";
import { usePathname } from "next/navigation";

const pageTitles: Record<string, string> = {
  "/dashboard":                                          "Dashboard",
  "/dashboard/employees":                                "Empleados",
  "/dashboard/users":                                    "Usuarios",
  "/dashboard/reports":                                  "Reportes",
  "/dashboard/settings":                                 "Configuración",
  "/dashboard/export-produccion/entrada-desprese":       "Entrada Desprese",
  "/dashboard/export-produccion/salida-desprese":        "Salida Desprese",
  "/dashboard/export-produccion/entrada-beneficio":      "Entrada Beneficio",
  "/dashboard/export-produccion/salida-beneficio":       "Salida Beneficio",
  "/dashboard/export-produccion/beneficio":              "Beneficio",
  "/dashboard/export-produccion/produccion-cpp":         "Con Prod. en Proceso",
  "/dashboard/export-produccion/produccion-spp":         "Sin Prod. en Proceso",
  "/dashboard/export-produccion/historial-baches":       "Historial de baches",
};

function resolveTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (pathname.startsWith("/dashboard/export-produccion/salida-desprese/"))  return "Salida Desprese";
  if (pathname.startsWith("/dashboard/export-produccion/entrada-desprese/"))  return "Entrada Desprese";
  if (pathname.startsWith("/dashboard/export-produccion/salida-beneficio/"))  return "Salida Beneficio";
  if (pathname.startsWith("/dashboard/export-produccion/entrada-beneficio/")) return "Entrada Beneficio";
  if (pathname.startsWith("/dashboard/export-produccion/beneficio/"))         return "Beneficio";
  if (pathname.startsWith("/dashboard/export-produccion/produccion-cpp/"))    return "Con Prod. en Proceso";
  if (pathname.startsWith("/dashboard/export-produccion/produccion-spp/"))    return "Sin Prod. en Proceso";
  return "Dashboard";
}

export default function Topbar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const user = session?.user;
  const title = resolveTitle(pathname);

  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "U";

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        <button className="relative p-2 rounded-lg hover:bg-slate-100 transition-colors text-slate-500">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
        </button>

        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-[#f89520] flex items-center justify-center text-white text-sm font-semibold">
            {initials}
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-slate-800 leading-none">{user?.name ?? "Usuario"}</p>
            <p className="text-xs text-slate-500 mt-0.5">{user?.email}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
