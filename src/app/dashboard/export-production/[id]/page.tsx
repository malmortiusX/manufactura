"use client";
// src/app/dashboard/export-production/[id]/page.tsx
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";

interface ProductRow {
  UNIDAD_PRODUCTO: string;
  BODEGA: string;
  UBICACION: string;
  CODIGO_PRODUCTO: string;
  DESCRIPCION_PRODUCTO: string;
  LOTE_PRODUCTO: string;
  TRASMIT: string;
  KIL: number;
  UND: number;
  PROMEDIO_PESO: number;
}

interface Filtro {
  id: number;
  nombre: string;
  fecha: string;
  tipoDocumento: string | null;
  tipoMovimiento: string | null;
  tipoDoc: string | null;
  motivo: string | null;
  centroCostos: string | null;
  origenCentroOperacion: string | null;
  origenBodega: string | null;
  origenUbicacion: string | null;
  destinoCentroOperacion: string | null;
  destinoBodega: string | null;
  destinoUbicacion: string | null;
  unidadNegocio: string | null;
}

// ── Utilidades de formato ──────────────────────────────────────────────────
const pN = (val: string | number | null | undefined, len: number) =>
  String(Math.floor(Number(val) || 0)).padStart(len, "0").slice(-len);

const pA = (val: string | null | undefined, len: number) =>
  (val ?? "").slice(0, len).padEnd(len, " ");

function fechaYMD(raw: string): string {
  return raw.split("T")[0].replace(/-/g, ""); // YYYYMMDD
}

// ── Formato de cantidad numérica con decimales (ej: "00000000000000010.50") ─
function pQ(val: number, intLen: number, dec: number): string {
  const factor = Math.pow(10, dec);
  const rounded = Math.round(Number(val) * factor) / factor;
  const [intPart, decPart = ""] = rounded.toFixed(dec).split(".");
  return intPart.padStart(intLen, "0") + "." + decPart.padEnd(dec, "0");
}

// ── Generador XML 1: Encabezado + líneas de producto + cierre ──────────────
function buildXML1(filtro: Filtro, rows: ProductRow[]): string {
  const fecha = fechaYMD(filtro.fecha);
  const opening = "000000100000001001";

  // Línea del encabezado del movimiento (record #2, tipo 450)
  const header =
    pN(2, 7) +                                   // F_NUMERO-REG
    pN(450, 4) +                                 // F_TIPO-REG
    pN(3, 2) +                                   // F_SUBTIPO-REG
    pN(1, 2) +                                   // F_VERSION-REG
    pN(1, 3) +                                   // F_CIA
    pN(1, 1) +                                   // F_CONSEC_AUTO_REG
    pA(filtro.destinoCentroOperacion, 3) +        // f350_id_co
    pA(filtro.tipoDoc, 3) +                       // f350_id_tipo_docto
    pN(1, 8) +                                   // f350_consec_docto
    pA(fecha, 8) +                               // f350_id_fecha
    pN(1, 1) +                                   // f350_ind_estado
    pN(0, 1) +                                   // f350_ind_impresión
    pN(710, 3) +                                 // f350_id_clase_docto
    pA("", 15) +                                 // f350_docto_alterno
    pA(filtro.nombre, 255) +                     // f350_notas
    pA(filtro.motivo, 2) +                       // f350_id_motivo
    pA("", 15) +                                 // f350_id_proyecto
    pA("OPG", 3) +                               // f850_tipo_docto
    pN(0, 8);                                    // f850_consec_docto

  // Líneas de movimiento por producto (tipo 470, records #3, #4, ...)
  const productLines = rows.map((row, i) => {
    const nroRegistro = i + 1; // número de registro dentro del documento
    const kilStr = pQ(Number(row.KIL), 15, 4);
    const undStr = pQ(Number(row.UND), 15, 4);

    return (
      pN(i + 3, 7) +                             // F_NUMERO-REG (3, 4, 5...)
      pN(470, 4) +                               // F_TIPO-REG
      pN(0, 2) +                                 // F_SUBTIPO-REG (vacio)
      pN(4, 2) +                                 // F_VERSION-REG
      pN(1, 3) +                                 // F_CIA
      pA(filtro.destinoCentroOperacion, 3) +      // f470_id_co
      pA(filtro.tipoDoc, 3) +                     // f470_id_tipo_docto
      pN(1, 8) +                                 // f470_consec_docto
      pN(nroRegistro, 10) +                      // f470_nro_registro
      pN(0, 7) +                                 // f470_id_item_padre (vacio)
      pA(row.CODIGO_PRODUCTO, 50) +              // f470_referencia_item_padre
      pA("", 20) +                               // f470_codigo_barras_padre
      pA("", 20) +                               // f470_id_ext1_detalle_padre
      pA("", 20) +                               // f470_id_ext2_detalle_padre
      pN(0, 10) +                                // f470_numero_operacion (vacio)
      pN(0, 7) +                                 // f470_id_item_comp (vacio)
      pA(row.CODIGO_PRODUCTO, 50) +              // f470_referencia_item_comp
      pA("", 20) +                               // f470_codigo_barras_comp
      pA("", 20) +                               // f470_id_ext1_detalle_comp
      pA("", 20) +                               // f470_id_ext2_detalle_comp
      pA(row.BODEGA, 5) +                        // f470_id_bodega
      pA(row.UBICACION, 10) +                    // Ubicación
      pA(row.LOTE_PRODUCTO, 15) +                // Lote
      pN(701, 3) +                               // Concepto
      pA(filtro.motivo, 2) +                     // Motivo
      pA(filtro.destinoCentroOperacion, 3) +      // Centro de operación movimiento
      pA(filtro.unidadNegocio, 20) +             // Unidad de negocio movimiento
      pA(filtro.centroCostos, 15) +              // Centro de costo movimiento
      pA("", 15) +                               // Proyecto (vacio)
      pA(row.UNIDAD_PRODUCTO, 4) +               // Unidad de medida
      kilStr +                                   // Cantidad base (KIL)
      undStr +                                   // Cantidad adicional (UND)
      pA("", 255) +                              // Notas (vacio)
      pA(row.DESCRIPCION_PRODUCTO, 2000)         // Descripción
    );
  });

  // Línea de cierre (tipo 9999)
  const closingNum = rows.length + 1;
  const closing =
    pN(closingNum, 7) +
    "9999" +
    "00" +
    "01" +
    "001";

  return [opening, header, ...productLines, closing].join("\n");
}

// ── Componente de bloque XML ───────────────────────────────────────────────
function XmlBlock({ title, content }: { title: string; content: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
        <span className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          {title}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg transition-colors"
        >
          {copied ? (
            <>
              <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-emerald-500">Copiado</span>
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copiar
            </>
          )}
        </button>
      </div>
      <div className="bg-slate-950 p-5 overflow-x-auto">
        <pre className="text-xs text-emerald-400 font-mono whitespace-pre leading-relaxed">{content}</pre>
      </div>
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────
const fmtNum = (n: number) =>
  new Intl.NumberFormat("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default function ExportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [filtro, setFiltro] = useState<Filtro | null>(null);
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/export-produccion/${id}/results`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al consultar");
      setFiltro(data.filtro);
      setRows(data.rows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalKil = rows.reduce((s, r) => s + Number(r.KIL), 0);
  const totalUnd = rows.reduce((s, r) => s + Number(r.UND), 0);

  const xml1 = filtro ? buildXML1(filtro, rows) : "";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 text-slate-400 hover:text-slate-600 transition-all"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h1 className="text-lg font-semibold text-slate-800">
            {loading ? "Cargando..." : filtro ? `Exportar ${filtro.nombre}` : "Exportar"}
          </h1>
          {filtro && (
            <p className="text-xs text-slate-400 mt-0.5">
              {new Date(filtro.fecha.split("T")[0] + "T00:00:00").toLocaleDateString("es-CO")}
              {filtro.tipoDocumento && <> · Tipo Doc: <span className="font-medium">{filtro.tipoDocumento}</span></>}
              {filtro.tipoMovimiento && <> · Tipo Mov: <span className="font-medium">{filtro.tipoMovimiento}</span></>}
            </p>
          )}
        </div>
        <div className="ml-auto">
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-white border border-transparent hover:border-slate-200 px-3 py-2 rounded-xl transition-all disabled:opacity-40"
          >
            <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Actualizar
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Totales */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Total Registros</p>
              <p className="text-2xl font-bold text-slate-800">{rows.length}</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Total Kilogramos</p>
              <p className="text-2xl font-bold text-slate-800">{fmtNum(totalKil)}</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Total Unidades</p>
              <p className="text-2xl font-bold text-slate-800">{fmtNum(totalUnd)}</p>
            </div>
          </div>

          {/* XMLs */}
          <XmlBlock title="XML 1 — Encabezado del movimiento" content={xml1} />
          <XmlBlock title="XML 2 — Pendiente" content="// Pendiente de definición" />
          <XmlBlock title="XML 3 — Pendiente" content="// Pendiente de definición" />
        </>
      )}

      {/* Tabla */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Código</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Descripción</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Bodega</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Ubicación</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Lote</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">U/M</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Kilogramos</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Unidades</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Prom. Peso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 9 }).map((__, j) => (
                      <td key={j} className="px-5 py-4">
                        <div className="h-4 bg-slate-100 rounded w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.map((row, i) => (
                <tr key={i} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 font-mono text-xs text-slate-700">{row.CODIGO_PRODUCTO}</td>
                  <td className="px-5 py-3 text-slate-800 font-medium max-w-[220px] truncate">{row.DESCRIPCION_PRODUCTO}</td>
                  <td className="px-5 py-3 text-slate-600">{row.BODEGA || "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{row.UBICACION || "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{row.LOTE_PRODUCTO || "—"}</td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                      {row.UNIDAD_PRODUCTO}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right text-slate-700 font-medium tabular-nums">{fmtNum(Number(row.KIL))}</td>
                  <td className="px-5 py-3 text-right text-slate-700 font-medium tabular-nums">{fmtNum(Number(row.UND))}</td>
                  <td className="px-5 py-3 text-right text-slate-500 tabular-nums">{fmtNum(Number(row.PROMEDIO_PESO))}</td>
                </tr>
              ))}
            </tbody>
            {!loading && rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td colSpan={6} className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Total</td>
                  <td className="px-5 py-3 text-right font-bold text-slate-800 tabular-nums">{fmtNum(totalKil)}</td>
                  <td className="px-5 py-3 text-right font-bold text-slate-800 tabular-nums">{fmtNum(totalUnd)}</td>
                  <td className="px-5 py-3" />
                </tr>
              </tfoot>
            )}
          </table>

          {!loading && rows.length === 0 && !error && (
            <div className="text-center py-12 text-slate-400">
              <svg className="w-10 h-10 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-sm">No se encontraron registros con los filtros aplicados</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
