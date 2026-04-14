"use client";
// src/app/dashboard/page.tsx
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const chartData = [
  { mes: "Ene", valor: 4200 }, { mes: "Feb", valor: 3800 }, { mes: "Mar", valor: 5100 },
  { mes: "Abr", valor: 4700 }, { mes: "May", valor: 5300 }, { mes: "Jun", valor: 6200 },
  { mes: "Jul", valor: 5800 }, { mes: "Ago", valor: 6800 }, { mes: "Sep", valor: 7200 },
  { mes: "Oct", valor: 6900 }, { mes: "Nov", valor: 7800 }, { mes: "Dic", valor: 8500 },
];

const stats = [
  {
    label: "Empleados activos",
    value: "248",
    change: "+12%",
    positive: true,
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    color: "text-blue-500",
    bg: "bg-blue-50",
  },
  {
    label: "Usuarios del sistema",
    value: "34",
    change: "+3",
    positive: true,
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
    color: "text-purple-500",
    bg: "bg-purple-50",
  },
  {
    label: "Departamentos",
    value: "12",
    change: "Sin cambios",
    positive: null,
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
    color: "text-emerald-500",
    bg: "bg-emerald-50",
  },
  {
    label: "Registros este mes",
    value: "1,284",
    change: "+8.2%",
    positive: true,
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    color: "text-amber-500",
    bg: "bg-amber-50",
  },
];

const recentActivity = [
  { user: "Carlos Medina", action: "Creó nuevo empleado", time: "Hace 5 min", avatar: "CM" },
  { user: "Sandra Ospina", action: "Actualizó reporte mensual", time: "Hace 23 min", avatar: "SO" },
  { user: "Andrés Vargas", action: "Configuró permisos de usuario", time: "Hace 1 hora", avatar: "AV" },
  { user: "Luisa Ríos", action: "Exportó inventario", time: "Hace 2 horas", avatar: "LR" },
  { user: "Jhon Ramírez", action: "Sincronizó datos de báscula", time: "Hace 3 horas", avatar: "JR" },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white rounded-2xl border border-slate-200 p-5 flex items-start gap-4 shadow-sm">
            <div className={`${stat.bg} ${stat.color} p-3 rounded-xl flex-shrink-0`}>
              {stat.icon}
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-slate-800">{stat.value}</p>
              <p className="text-sm text-slate-500 mt-0.5 truncate">{stat.label}</p>
              <span className={`text-xs font-medium mt-1 inline-block ${stat.positive === true ? "text-emerald-600" : stat.positive === false ? "text-red-500" : "text-slate-400"}`}>
                {stat.change}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Chart + Activity */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Area Chart */}
        <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-base font-semibold text-slate-800">Actividad anual</h2>
              <p className="text-sm text-slate-400">Registros procesados por mes</p>
            </div>
            <span className="text-xs font-medium bg-blue-50 text-blue-600 px-3 py-1 rounded-full">2025</span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorValor" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="mes" tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "#1e2a3b", border: "none", borderRadius: "10px", color: "#fff", fontSize: "13px" }}
                cursor={{ stroke: "#3b82f6", strokeWidth: 1, strokeDasharray: "4 4" }}
              />
              <Area type="monotone" dataKey="valor" stroke="#3b82f6" strokeWidth={2.5} fill="url(#colorValor)" dot={false} activeDot={{ r: 5, fill: "#3b82f6" }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Activity Feed */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-800 mb-5">Actividad reciente</h2>
          <div className="space-y-4">
            {recentActivity.map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                  {item.avatar}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-700 truncate">{item.user}</p>
                  <p className="text-xs text-slate-400 truncate">{item.action}</p>
                  <p className="text-xs text-slate-300 mt-0.5">{item.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick start note */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 flex gap-4 items-start">
        <div className="text-blue-500 flex-shrink-0 mt-0.5">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-blue-800">Template listo para conectar a SQL Server</p>
          <p className="text-xs text-blue-600 mt-1">
            Configura tu <code className="bg-blue-100 px-1 rounded">.env</code> con el string de conexión y ejecuta{" "}
            <code className="bg-blue-100 px-1 rounded">npx prisma db push</code> para crear las tablas automáticamente.
          </p>
        </div>
      </div>
    </div>
  );
}
