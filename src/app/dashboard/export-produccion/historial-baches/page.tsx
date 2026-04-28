"use client";
// src/app/dashboard/export-produccion/historial-baches/page.tsx

import { useState, useEffect, useCallback } from "react";

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface FiltroSnippet {
  id:              number;
  nombre:          string;
  modulo:          string | null;
  centroOperacion: string | null;
  fecha:           string | null;
}

interface OpgLogRow {
  id:                         number;
  tipoDocumento:              string;
  numeroOpg:                  number;
  numeroBache:                string;
  filtroId:                   number | null;
  filtro:                     FiltroSnippet | null;
  estadoOrdenProduccion:      string;
  estadoConsumoProduccion:    string;
  estadoEntregaProduccion:    string;
  intentos:                   number;
  createdAt:                  string;
}

// ── Helpers visuales ──────────────────────────────────────────────────────────
const MODULO_LABEL: Record<string, string> = {
  desprese:             "Desprese",
  beneficio:            "Beneficio",
  "produccion-spp":     "Sin Prod. en Proceso",
  "entrada-desprese":   "Entrada Desprese",
  "salida-desprese":    "Salida Desprese",
  "entrada-beneficio":  "Entrada Beneficio",
  "salida-beneficio":   "Salida Beneficio",
};

const MODULO_COLOR: Record<string, string> = {
  desprese:            "bg-orange-50 text-orange-700 border-orange-200",
  beneficio:           "bg-emerald-50 text-emerald-700 border-emerald-200",
  "produccion-spp":    "bg-indigo-50 text-indigo-700 border-indigo-200",
  "entrada-desprese":  "bg-blue-50 text-blue-700 border-blue-200",
  "salida-desprese":   "bg-sky-50 text-sky-700 border-sky-200",
  "entrada-beneficio": "bg-teal-50 text-teal-700 border-teal-200",
  "salida-beneficio":  "bg-cyan-50 text-cyan-700 border-cyan-200",
};

const ESTADO_COLOR: Record<string, string> = {
  ENVIADO:    "bg-green-100 text-green-700",
  PENDIENTE:  "bg-yellow-100 text-yellow-700",
  ERROR:      "bg-red-100 text-red-700",
  CONFIRMADO: "bg-blue-100 text-blue-700",
};

function EstadoBadge({ estado }: { estado: string }) {
  const cls = ESTADO_COLOR[estado] ?? "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {estado}
    </span>
  );
}

function ModuloBadge({ modulo }: { modulo: string | null | undefined }) {
  if (!modulo) return <span className="text-slate-400 text-xs">—</span>;
  const cls = MODULO_COLOR[modulo] ?? "bg-slate-50 text-slate-600 border-slate-200";
  return (
    <span className={`inline-block px-2 py-0.5 rounded border text-xs font-medium ${cls}`}>
      {MODULO_LABEL[modulo] ?? modulo}
    </span>
  );
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-CO", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

// ── Modal de justificación ────────────────────────────────────────────────────
interface DesmarcarModalProps {
  log:       OpgLogRow;
  onConfirm: (logId: number, observacion: string) => void;
  onCancel:  () => void;
}

function DesmarcarModal({ log, onConfirm, onCancel }: DesmarcarModalProps) {
  const [obs, setObs] = useState("");
  const invalid = obs.trim().length < 5;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-200">

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-800">Desmarcar bache</h3>
              <p className="text-sm text-slate-500 mt-0.5">
                Bache <span className="font-mono font-semibold text-slate-700">{log.numeroBache}</span>
                {" · "}OPG <span className="font-mono text-slate-600">{log.numeroOpg}</span>
              </p>
              {log.filtro && (
                <p className="text-xs text-slate-400 mt-0.5">{log.filtro.nombre}</p>
              )}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
            Esta acción restablecerá los registros de Mvdcto asociados a este bache,
            permitiendo que puedan volver a ser procesados.
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Observación / Justificación <span className="text-red-500">*</span>
            </label>
            <textarea
              autoFocus
              rows={3}
              value={obs}
              onChange={e => setObs(e.target.value)}
              placeholder="Describe el motivo por el cual se desmarca este bache…"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-700 placeholder-slate-400
                         focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-transparent resize-none"
            />
            <p className="text-xs text-slate-400 mt-1">Mínimo 5 caracteres</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => onConfirm(log.id, obs.trim())}
            disabled={invalid}
            className="px-4 py-2 text-sm font-medium text-white bg-red-500 rounded-xl hover:bg-red-600
                       disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Confirmar desmarque
          </button>
        </div>

      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function HistorialBachesPage() {
  const [logs,    setLogs]    = useState<OpgLogRow[]>([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Filtros de búsqueda
  const [search,      setSearch]      = useState("");
  const [modulo,      setModulo]      = useState("");
  const [draftSearch, setDraftSearch] = useState("");

  // Estado por fila: "" | "loading" | "ok" | "error"
  const [rowAction, setRowAction] = useState<Record<number, string>>({});
  const [rowMsg,    setRowMsg]    = useState<Record<number, string>>({});

  // Modal de justificación
  const [modalLog, setModalLog] = useState<OpgLogRow | null>(null);

  // ── Carga ────────────────────────────────────────────────────────────────────
  const fetchLogs = useCallback(async (p: number, s: string, m: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs  = new URLSearchParams({ page: String(p), search: s, modulo: m });
      const res  = await fetch(`/api/export-produccion/historial-baches?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al cargar");
      setLogs(data.logs);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLogs(page, search, modulo); }, [fetchLogs, page, search, modulo]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSearch(draftSearch);
  }

  function handleModulo(m: string) {
    setPage(1);
    setModulo(m);
  }

  // ── Desmarcar ────────────────────────────────────────────────────────────────
  async function confirmarDesmarque(logId: number, observacion: string) {
    setModalLog(null);
    setRowAction(prev => ({ ...prev, [logId]: "loading" }));

    try {
      const res  = await fetch(
        `/api/export-produccion/historial-baches/${logId}/desmarcar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ observacion }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al desmarcar");

      setRowAction(prev => ({ ...prev, [logId]: "ok" }));
      setRowMsg(prev => ({
        ...prev,
        [logId]: `${data.rowsAfectados} registro(s) restablecido(s)`,
      }));
    } catch (e) {
      setRowAction(prev => ({ ...prev, [logId]: "error" }));
      setRowMsg(prev => ({ ...prev, [logId]: e instanceof Error ? e.message : "Error" }));
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <>
      {/* ── Modal de justificación ── */}
      {modalLog && (
        <DesmarcarModal
          log={modalLog}
          onConfirm={confirmarDesmarque}
          onCancel={() => setModalLog(null)}
        />
      )}

      <div className="space-y-5">

        {/* ── Encabezado + filtros ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Historial de baches</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                {total} registro{total !== 1 ? "s" : ""} en total
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Filtro módulo */}
              <select
                value={modulo}
                onChange={e => handleModulo(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700
                           focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                <option value="">Todos los módulos</option>
                {Object.entries(MODULO_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>

              {/* Búsqueda */}
              <form onSubmit={handleSearch} className="flex gap-2">
                <input
                  type="text"
                  value={draftSearch}
                  onChange={e => setDraftSearch(e.target.value)}
                  placeholder="Buscar bache o filtro…"
                  className="text-sm border border-slate-200 rounded-lg px-3 py-2 w-52
                             focus:outline-none focus:ring-2 focus:ring-slate-300"
                />
                <button
                  type="submit"
                  className="text-sm bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-700 transition-colors"
                >
                  Buscar
                </button>
              </form>

              {/* Refresh */}
              <button
                onClick={() => fetchLogs(page, search, modulo)}
                disabled={loading}
                className="text-sm border border-slate-200 text-slate-600 px-3 py-2 rounded-lg
                           hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                {loading ? (
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ── Error global ── */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* ── Tabla ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">Fecha</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">Módulo</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">Filtro</th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">Bache</th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">OPG #</th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">Orden</th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">Consumo</th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">Entrega</th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">Intentos</th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-600 whitespace-nowrap">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading && logs.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-12 text-slate-400">
                      <svg className="animate-spin w-6 h-6 mx-auto mb-2" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Cargando…
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center py-12 text-slate-400">
                      No hay registros
                    </td>
                  </tr>
                ) : logs.map((log, idx) => {
                  const action = rowAction[log.id] ?? "";
                  const msg    = rowMsg[log.id]    ?? "";
                  const isEven = idx % 2 === 0;

                  return (
                    <tr
                      key={log.id}
                      className={`border-b border-slate-50 transition-colors
                        ${isEven ? "bg-white" : "bg-slate-50/30"}
                        ${action === "ok" ? "!bg-green-50/60" : "hover:bg-slate-50/60"}`}
                    >
                      {/* Fecha */}
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">
                        {formatDate(log.createdAt)}
                      </td>

                      {/* Módulo */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <ModuloBadge modulo={log.filtro?.modulo} />
                      </td>

                      {/* Filtro */}
                      <td className="px-4 py-3">
                        {log.filtro
                          ? <span className="text-slate-700 font-medium">{log.filtro.nombre}</span>
                          : <span className="text-slate-400 italic text-xs">Filtro eliminado</span>}
                      </td>

                      {/* Bache */}
                      <td className="px-4 py-3 text-center">
                        <span className="font-mono font-semibold text-slate-700">{log.numeroBache}</span>
                      </td>

                      {/* OPG # */}
                      <td className="px-4 py-3 text-center">
                        <span className="font-mono text-slate-600">{log.numeroOpg}</span>
                      </td>

                      {/* Estados */}
                      <td className="px-4 py-3 text-center">
                        <EstadoBadge estado={log.estadoOrdenProduccion} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <EstadoBadge estado={log.estadoConsumoProduccion} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <EstadoBadge estado={log.estadoEntregaProduccion} />
                      </td>

                      {/* Intentos */}
                      <td className="px-4 py-3 text-center text-slate-500">{log.intentos}</td>

                      {/* Acciones */}
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        {action === "loading" ? (
                          <svg className="animate-spin w-4 h-4 mx-auto text-slate-400" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        ) : action === "ok" ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-xs text-green-600 font-medium">✓ Desmarcado</span>
                            <span className="text-xs text-slate-400">{msg}</span>
                          </div>
                        ) : action === "error" ? (
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-xs text-red-600">{msg}</span>
                            <button
                              onClick={() => setModalLog(log)}
                              className="text-xs text-slate-500 underline"
                            >
                              Reintentar
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setModalLog(log)}
                            className="text-xs border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg
                                       hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition-colors"
                          >
                            Desmarcar bache
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Paginación ── */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
              <span className="text-sm text-slate-500">
                Página {page} de {totalPages} ({total} registros)
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="text-sm border border-slate-200 px-3 py-1.5 rounded-lg
                             disabled:opacity-40 hover:bg-slate-50 transition-colors"
                >
                  ← Anterior
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="text-sm border border-slate-200 px-3 py-1.5 rounded-lg
                             disabled:opacity-40 hover:bg-slate-50 transition-colors"
                >
                  Siguiente →
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </>
  );
}
