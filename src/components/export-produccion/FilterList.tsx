"use client";
// src/components/export-produccion/FilterList.tsx
// Lista CRUD de filtros compartida entre los 4 módulos de Exportar Producción.
import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

export interface FilterSet {
  id: number;
  identificador: string;
  nombre: string;
  bodega: string | null;
  ubicacion: string | null;
  tipoDocumento: string | null;
  tipoMovimiento: string | null;
  fecha: string;
  centroOperacion: string | null;
  terceroPlanificador: string | null;
  instalacion: string | null;
  bodegaItemPadre: string | null;
  tipoDoctoOrden: string | null;
  modulo: string | null;
  productoProceso: string | null;
  bodegaConsumo: string | null;
  ubicacionConsumo: string | null;
  tipoDocumentoConsumo: string | null;
  tipoMovimientoConsumo: string | null;
  productosEnProceso: string | null;
  productosSinLote: string | null;
}

export type ModuloKey =
  | "entrada-desprese"
  | "salida-desprese"
  | "entrada-beneficio"
  | "salida-beneficio"
  | "beneficio"
  | "desprese"
  | "produccion-spp";

const MODULO_LABELS: Record<ModuloKey, string> = {
  "entrada-desprese":  "Entrada Desprese",
  "salida-desprese":   "Salida Desprese",
  "entrada-beneficio": "Entrada Beneficio",
  "salida-beneficio":  "Salida Beneficio",
  "beneficio":         "Beneficio",
  "desprese":          "Desprese",
  "produccion-spp":    "Sin Prod. en Proceso",
};

const MODULO_COLORS: Record<ModuloKey, string> = {
  "entrada-desprese":  "bg-sky-50 text-sky-700 border-sky-200",
  "salida-desprese":   "bg-violet-50 text-violet-700 border-violet-200",
  "entrada-beneficio": "bg-teal-50 text-teal-700 border-teal-200",
  "salida-beneficio":  "bg-orange-50 text-orange-700 border-orange-200",
  "beneficio":         "bg-rose-50 text-rose-700 border-rose-200",
  "desprese":          "bg-amber-50 text-amber-700 border-amber-200",
  "produccion-spp":    "bg-indigo-50 text-indigo-700 border-indigo-200",
};

interface Props {
  modulo: ModuloKey;
  /** Ruta base del módulo, p.ej. "/dashboard/export-produccion/salida-desprese" */
  basePath: string;
  /** Si el módulo tiene página de detalle ([id]) */
  hasDetail?: boolean;
}

const today = new Date().toISOString().split("T")[0];

const inputClass =
  "px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-colors placeholder:text-slate-300";
const labelClass = "text-xs font-semibold text-slate-500 uppercase tracking-wider";
const counterClass = "text-xs text-slate-400 text-right";

function Field({
  label, name, value, onChange, maxLength, placeholder, mono = false,
}: {
  label: string; name: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  maxLength: number; placeholder?: string; mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className={labelClass}>{label}</label>
      <input
        type="text"
        name={name}
        value={value}
        onChange={onChange}
        maxLength={maxLength}
        placeholder={placeholder}
        className={`${inputClass}${mono ? " font-mono" : ""}`}
      />
      <span className={counterClass}>{value.length}/{maxLength}</span>
    </div>
  );
}

const emptyForm = {
  identificador: "",
  nombre: "",
  bodega: "",
  ubicacion: "",
  tipoDocumento: "",
  tipoMovimiento: "",
  fecha: today,
  centroOperacion: "",
  terceroPlanificador: "",
  instalacion: "",
  bodegaItemPadre: "",
  tipoDoctoOrden: "",
  productoProceso: "",
  bodegaConsumo: "",
  ubicacionConsumo: "",
  tipoDocumentoConsumo: "",
  tipoMovimientoConsumo: "",
  productosEnProceso: "",
  productosSinLote: "",
};

export default function FilterList({ modulo, basePath, hasDetail = false }: Props) {
  const [records, setRecords] = useState<FilterSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/export-produccion?modulo=${modulo}`);
      if (!res.ok) throw new Error("Error al cargar los registros");
      setRecords(await res.json());
    } catch {
      setError("No se pudieron cargar los registros.");
    } finally {
      setLoading(false);
    }
  }, [modulo]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const filtered = records.filter(
    (f) =>
      f.identificador.toLowerCase().includes(search.toLowerCase()) ||
      f.nombre.toLowerCase().includes(search.toLowerCase()) ||
      (f.bodega ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (f.tipoDocumento ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (f.tipoMovimiento ?? "").toLowerCase().includes(search.toLowerCase())
  );

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function handleNew() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  }

  function handleEdit(item: FilterSet) {
    setForm({
      identificador:          item.identificador,
      nombre:                 item.nombre,
      bodega:                 item.bodega                 ?? "",
      ubicacion:              item.ubicacion              ?? "",
      tipoDocumento:          item.tipoDocumento          ?? "",
      tipoMovimiento:         item.tipoMovimiento         ?? "",
      fecha:                  item.fecha.split("T")[0],
      centroOperacion:        item.centroOperacion        ?? "",
      terceroPlanificador:    item.terceroPlanificador    ?? "",
      instalacion:            item.instalacion            ?? "",
      bodegaItemPadre:        item.bodegaItemPadre        ?? "",
      tipoDoctoOrden:         item.tipoDoctoOrden         ?? "",
      productoProceso:        item.productoProceso        ?? "",
      bodegaConsumo:          item.bodegaConsumo          ?? "",
      ubicacionConsumo:       item.ubicacionConsumo       ?? "",
      tipoDocumentoConsumo:   item.tipoDocumentoConsumo   ?? "",
      tipoMovimientoConsumo:  item.tipoMovimientoConsumo  ?? "",
      productosEnProceso:     item.productosEnProceso     ?? "",
      productosSinLote:       item.productosSinLote       ?? "",
    });
    setEditingId(item.id);
    setShowForm(true);
  }

  function handleCancel() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  }

  async function handleSave() {
    if (!form.identificador.trim() || !form.nombre.trim() || !form.fecha) return;
    setSaving(true);
    setError(null);
    try {
      const method = editingId ? "PUT" : "POST";
      const url = editingId
        ? `/api/export-produccion/${editingId}`
        : "/api/export-produccion";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, modulo }),
      });
      if (!res.ok) throw new Error();
      await fetchRecords();
      handleCancel();
    } catch {
      setError("No se pudo guardar el registro.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/export-produccion/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch {
      setError("No se pudo eliminar el registro.");
    } finally {
      setDeletingId(null);
    }
  }

  const fmt = (date: string) =>
    date ? new Date(date.split("T")[0] + "T00:00:00").toLocaleDateString("es-CO") : "—";

  const moduloKey = modulo as ModuloKey;
  const moduloLabel = MODULO_LABELS[moduloKey] ?? modulo;
  const moduloColor = MODULO_COLORS[moduloKey] ?? "bg-slate-100 text-slate-600 border-slate-200";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {loading ? "Cargando..." : `${filtered.length} conjuntos de filtros`}
        </p>
        <button
          onClick={handleNew}
          className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nuevo filtro
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="relative max-w-xs">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Buscar filtros..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Vista</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">ID</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Nombre</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Bodega</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Tipo Doc.</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Tipo Mov.</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Fecha</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 8 }).map((__, j) => (
                      <td key={j} className="px-5 py-4">
                        <div className="h-4 bg-slate-100 rounded w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.map((item) => {
                const itemModulo = (item.modulo ?? modulo) as ModuloKey;
                const itemLabel = MODULO_LABELS[itemModulo] ?? item.modulo ?? "Sin asignar";
                const itemColor = MODULO_COLORS[itemModulo] ?? "bg-slate-100 text-slate-600 border-slate-200";

                return (
                  <tr
                    key={item.id}
                    onClick={() => hasDetail && router.push(`${basePath}/${item.id}`)}
                    className={`transition-colors ${hasDetail ? "hover:bg-slate-50 cursor-pointer" : ""}`}
                  >
                    {/* Vista */}
                    <td className="px-5 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${itemColor}`}>
                        {itemLabel}
                      </span>
                    </td>
                    {/* ID */}
                    <td className="px-5 py-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 font-mono">
                        {item.identificador}
                      </span>
                    </td>
                    <td className="px-5 py-4 font-medium text-slate-800">{item.nombre}</td>
                    <td className="px-5 py-4 text-slate-600">{item.bodega || "—"}</td>
                    <td className="px-5 py-4">
                      {item.tipoDocumento
                        ? <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">{item.tipoDocumento}</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-5 py-4">
                      {item.tipoMovimiento
                        ? <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">{item.tipoMovimiento}</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-5 py-4 text-slate-600">{fmt(item.fecha)}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2 justify-end" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleEdit(item)}
                          className="p-1.5 rounded-lg hover:bg-blue-50 text-slate-400 hover:text-blue-500 transition-colors"
                          title="Editar"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          disabled={deletingId === item.id}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-40"
                          title="Eliminar"
                        >
                          {deletingId === item.id
                            ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
                            : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          }
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!loading && filtered.length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <svg className="w-10 h-10 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm">No se encontraron filtros para {moduloLabel}</p>
            </div>
          )}
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-800">
                {editingId ? `Editando: ${form.nombre}` : "Nuevo conjunto de filtros"}
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Se guardará como{" "}
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${moduloColor}`}>
                  {moduloLabel}
                </span>
              </p>
            </div>
            <button onClick={handleCancel} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
            <Field label="Identificador" name="identificador" value={form.identificador} onChange={handleChange} maxLength={5} placeholder="Ej: PRD01" mono />
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <label className={labelClass}>Nombre</label>
              <input type="text" name="nombre" value={form.nombre} onChange={handleChange} placeholder="Ej: Producción Enero" className={inputClass} />
            </div>
            <Field label="Bodega" name="bodega" value={form.bodega} onChange={handleChange} maxLength={20} placeholder="Ej: BOD01" />
            <Field label="Ubicación" name="ubicacion" value={form.ubicacion} onChange={handleChange} maxLength={10} placeholder="Ej: A-01" />
            <Field label="Tipo Documento" name="tipoDocumento" value={form.tipoDocumento} onChange={handleChange} maxLength={3} placeholder="Ej: FAC" />
            <Field label="Tipo Movimiento" name="tipoMovimiento" value={form.tipoMovimiento} onChange={handleChange} maxLength={5} placeholder="Ej: ENT" />
            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>Fecha</label>
              <input type="date" name="fecha" value={form.fecha} onChange={handleChange} className={`${inputClass} text-slate-700`} />
            </div>
          </div>

          {modulo === "desprese" && (
            <>
              <div className="my-6 border-t border-slate-100" />
              <div className="mb-4">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                  Consumo
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 pl-4 border-l-2 border-amber-100">
                <Field label="Producto en Proceso" name="productoProceso" value={form.productoProceso} onChange={handleChange} maxLength={50} placeholder="Ej: PI00001" />
                <Field label="Bodega" name="bodegaConsumo" value={form.bodegaConsumo} onChange={handleChange} maxLength={20} placeholder="Ej: BOD02" />
                <Field label="Ubicación" name="ubicacionConsumo" value={form.ubicacionConsumo} onChange={handleChange} maxLength={10} placeholder="Ej: B-01" />
                <Field label="Tipo Documento" name="tipoDocumentoConsumo" value={form.tipoDocumentoConsumo} onChange={handleChange} maxLength={3} placeholder="Ej: FAC" />
                <Field label="Tipo Movimiento" name="tipoMovimientoConsumo" value={form.tipoMovimientoConsumo} onChange={handleChange} maxLength={5} placeholder="Ej: SAL" />
              </div>
            </>
          )}

          <div className="my-6 border-t border-slate-100" />

          <div className="mb-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" />
              Orden de producción
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 pl-4 border-l-2 border-indigo-100">
            <Field label="Centro de Operación" name="centroOperacion" value={form.centroOperacion} onChange={handleChange} maxLength={3} placeholder="Ej: C01" />
            <Field label="Tipo Documento" name="tipoDoctoOrden" value={form.tipoDoctoOrden} onChange={handleChange} maxLength={3} placeholder="Ej: OPG" />
            <Field label="Tercero Planificador" name="terceroPlanificador" value={form.terceroPlanificador} onChange={handleChange} maxLength={15} placeholder="Ej: PLANIF001" />
            <Field label="Instalación" name="instalacion" value={form.instalacion} onChange={handleChange} maxLength={3} placeholder="Ej: I01" />
            <Field label="Bodega Item Padre" name="bodegaItemPadre" value={form.bodegaItemPadre} onChange={handleChange} maxLength={5} placeholder="Ej: BO01" />
          </div>

          {modulo === "beneficio" && (
            <>
              <div className="my-6 border-t border-slate-100" />
              <div className="mb-4">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-rose-400 inline-block" />
                  Configuración productos
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pl-4 border-l-2 border-rose-100">
                <Field label="Productos en proceso" name="productosEnProceso" value={form.productosEnProceso} onChange={handleChange} maxLength={500} placeholder="Ej: PI00001, PI00002" />
                <Field label="Productos sin lote" name="productosSinLote" value={form.productosSinLote} onChange={handleChange} maxLength={500} placeholder="Ej: PR00001, PR00002" />
              </div>
            </>
          )}

          <div className="flex items-center justify-end gap-3 mt-8 pt-6 border-t border-slate-100">
            <button type="button" onClick={handleCancel} className="px-4 py-2.5 text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors">
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !form.identificador.trim() || !form.nombre.trim()}
              className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors"
            >
              {saving
                ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
                : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              }
              {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
