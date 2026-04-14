// src/app/dashboard/reports/page.tsx
export default function ReportsPage() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 bg-amber-50 text-amber-500 rounded-2xl mb-4">
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-slate-800">Reportes</h2>
      <p className="text-slate-400 text-sm mt-2 max-w-xs mx-auto">
        Conecta tus consultas SQL Server aquí para generar reportes personalizados.
      </p>
      <div className="mt-6 bg-slate-50 border border-slate-200 rounded-xl p-4 text-left max-w-md mx-auto">
        <p className="text-xs font-mono text-slate-600">
          {`// src/app/api/reports/route.ts`}<br />
          {`const data = await prisma.$queryRaw\`SELECT ...\``}
        </p>
      </div>
    </div>
  );
}
