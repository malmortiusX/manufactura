"use client";
// src/components/layout/Sidebar.tsx
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useState } from "react";

const navItems = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    ),
  },
  {
    label: "Usuarios",
    href: "/dashboard/users",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
];

const exportGroups = [
  {
    key: "export-produccion",
    label: "Exportar Producción",
    basePath: "/dashboard/export-produccion",
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    children: [
      { label: "Beneficio",            href: "/dashboard/export-produccion/beneficio" },
      { label: "Con Prod. en Proceso", href: "/dashboard/export-produccion/produccion-cpp" },
      { label: "Historial de baches",  href: "/dashboard/export-produccion/historial-baches" },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const defaultOpen = exportGroups.reduce<Record<string, boolean>>((acc, g) => {
    acc[g.key] = g.children.some(
      (c) => pathname === c.href || pathname.startsWith(c.href + "/")
    );
    return acc;
  }, {});

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(defaultOpen);

  function toggleGroup(key: string) {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-white border-r border-slate-200 flex flex-col z-50">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-100">
        <Image src="/icon.png" alt="Logo" width={40} height={40} unoptimized className="flex-shrink-0" />
        <div>
          <p className="text-slate-800 font-semibold text-sm leading-none">
            {process.env.NEXT_PUBLIC_APP_NAME ?? "Mi Dashboard"}
          </p>
          <p className="text-slate-400 text-xs mt-0.5">Sistema de gestión</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider px-3 mb-3">
          Menú principal
        </p>

        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                isActive
                  ? "bg-[#f89520] text-white font-semibold"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-800"
              )}
            >
              <span>{item.icon}</span>
              {item.label}
              {isActive && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary-500" />
              )}
            </Link>
          );
        })}

        {exportGroups.map((group) => {
          const isOpen        = !!openGroups[group.key];
          const groupIsActive = group.children.some(
            (c) => pathname === c.href || pathname.startsWith(c.href + "/")
          );

          return (
            <div key={group.key}>
              <button
                onClick={() => toggleGroup(group.key)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                  groupIsActive
                    ? "bg-[#f89520] text-white font-semibold"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-800"
                )}
              >
                <span>{group.icon}</span>
                <span className="flex-1 text-left">{group.label}</span>
                <svg
                  className={cn(
                    "w-3.5 h-3.5 transition-transform duration-200",
                    isOpen ? "rotate-180" : "rotate-0"
                  )}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {isOpen && (
                <div className="mt-0.5 ml-3 pl-3 border-l border-slate-200 space-y-0.5">
                  {group.children.map((child) => {
                    const childActive = pathname === child.href || pathname.startsWith(child.href + "/");
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150",
                          childActive
                            ? "bg-[#f89520] text-white font-semibold"
                            : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        )}
                      >
                        <span className={cn(
                          "w-1 h-1 rounded-full flex-shrink-0",
                          childActive ? "bg-[#f89520]" : "bg-slate-300"
                        )} />
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Sign out */}
      <div className="px-3 py-4 border-t border-slate-100">
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-500 hover:bg-red-50 hover:text-red-500 transition-all duration-150"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
