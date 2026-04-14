// src/app/dashboard/settings/page.tsx
export default function SettingsPage() {
  return (
    <div className="max-w-2xl space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-base font-semibold text-slate-800 mb-4">Conexión a base de datos</h2>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm font-mono text-slate-600 space-y-1">
          <p><span className="text-blue-500">DATABASE_URL</span>=<span className="text-emerald-600">"sqlserver://host:1433;database=..."</span></p>
          <p><span className="text-blue-500">BETTER_AUTH_SECRET</span>=<span className="text-emerald-600">"tu-secreto-aqui"</span></p>
          <p><span className="text-blue-500">BETTER_AUTH_URL</span>=<span className="text-emerald-600">"http://localhost:3000"</span></p>
        </div>
        <p className="text-xs text-slate-400 mt-3">Edita el archivo <code className="bg-slate-100 px-1 rounded">.env</code> en la raíz del proyecto.</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-base font-semibold text-slate-800 mb-4">Comandos útiles</h2>
        <div className="space-y-2">
          {[
            { cmd: "npx prisma db push", desc: "Crear / sincronizar tablas en SQL Server" },
            { cmd: "npx prisma migrate dev", desc: "Crear migración con historial" },
            { cmd: "npx prisma studio", desc: "Explorador visual de la base de datos" },
            { cmd: "npx prisma generate", desc: "Regenerar el cliente de Prisma" },
          ].map((item) => (
            <div key={item.cmd} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
              <code className="text-sm text-blue-600 font-mono">{item.cmd}</code>
              <span className="text-xs text-slate-400 ml-4">{item.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
