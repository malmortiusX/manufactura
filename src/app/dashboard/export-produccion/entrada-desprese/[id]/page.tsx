"use client";
// src/app/dashboard/export-produccion/entrada-desprese/[id]/page.tsx
// Proceso Entrada Desprese:
//   XML1 — Orden de Producción: produce PI00001 con sumatoria de KIL (clase_op=004, metodo_lista vacío)
//   XML2 — Consumo: consume los productos consultados (componentes de la OP)
//   XML3 — Entrega: entrega PI00001 con totalKil
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";

interface ProductRow {
  UNIDAD_PRODUCTO: string;
  BODEGA: string;
  UBICACION: string;
  CODIGO_PRODUCTO: string;
  DESCRIPCION_PRODUCTO: string;
  LOTE_PRODUCTO: string;
  bache: number;
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
  centroOperacion: string | null;
  terceroPlanificador: string | null;
  instalacion: string | null;
  bodegaItemPadre: string | null;
}

type EstadoDoc = "PENDIENTE" | "ENVIADO" | "ERROR";

interface ErpError {
  nroLinea: number;
  tipoReg:  string;
  subtipo:  string;
  version:  string;
  nivel:    string;
  valor:    string;
  detalle:  string;
}

interface DocResult {
  exitoso: boolean;
  errores: ErpError[];
  estado:  EstadoDoc;
}

interface TransmitResult {
  logId:     number;
  numeroOpg: number;
  xml2:      string;
  xml3:      string;
  orden:     DocResult;
  consumo:   DocResult;
  entrega:   DocResult;
}

interface ProductoLote { codigo: string; lote: string; }

interface LoteCreacionResult {
  exitoso:  boolean;
  omitidos: ProductoLote[];
  nuevos:   ProductoLote[];
  creados:  ProductoLote[];
  errores:  ErpError[];
  xmlLotes: string | null;
  error?:   string;
}

// ── Utilidades de formato ──────────────────────────────────────────────────
const pN = (val: string | number | null | undefined, len: number) =>
  String(Math.floor(Number(val) || 0)).padStart(len, "0").slice(-len);

const pA = (val: string | null | undefined, len: number) =>
  (val ?? "").slice(0, len).padEnd(len, " ");

function fechaYMD(raw: string): string {
  return raw.split("T")[0].replace(/-/g, "");
}

function pQ(val: number, intLen: number, dec: number): string {
  const factor = Math.pow(10, dec);
  const rounded = Math.round(Number(val) * factor) / factor;
  const [intPart, decPart = ""] = rounded.toFixed(dec).split(".");
  return intPart.padStart(intLen, "0") + "." + decPart.padEnd(dec, "0");
}

// ── Suma N días a fecha YYYYMMDD ──────────────────────────────────────────
function sumarDias(fechaStr: string, dias: number): string {
  const y  = parseInt(fechaStr.slice(0, 4), 10);
  const m  = parseInt(fechaStr.slice(4, 6), 10) - 1;
  const d  = parseInt(fechaStr.slice(6, 8), 10);
  const dt = new Date(y, m, d);
  dt.setDate(dt.getDate() + dias);
  return [
    String(dt.getFullYear()),
    String(dt.getMonth() + 1).padStart(2, "0"),
    String(dt.getDate()).padStart(2, "0"),
  ].join("");
}

// ── Generador XML Lotes — Tipo 403 ────────────────────────────────────────
function buildXMLLotes(rows: ProductRow[], fecha: string): string {
  const productos = Array.from(
    new Map(
      rows
        .filter((r) => r.LOTE_PRODUCTO?.trim())
        .map((r) => [
          `${r.CODIGO_PRODUCTO}|${r.LOTE_PRODUCTO}`,
          { codigo: r.CODIGO_PRODUCTO, lote: r.LOTE_PRODUCTO },
        ])
    ).values()
  );

  if (productos.length === 0) return "// Sin lotes — no se generará XML de lotes";

  const fechaVcto = sumarDias(fecha, 30);
  const opening   = "000000100000001001";

  const lines = productos.map((p, i) =>
    pN(i + 2, 7) +
    pN(403,   4) +
    pN(0,     2) +
    pN(2,     2) +
    pN(1,     3) +
    pN(0,     1) +
    pA(p.lote,    15) +
    pN(0,       7) +
    pA(p.codigo,  50) +
    pA("",        20) +
    pA("",        20) +
    pA("",        20) +
    pA("",         3) +
    pN(1,       1) +
    pA(fecha,     8) +
    pA(fechaVcto,  8) +
    pA("",        15) +
    pA("",        15) +
    pA("",         3) +
    pA("",        40) +
    pA("",        15) +
    pA("",         8) +
    pA("Creado por plano", 255)
  );

  const closingNum = productos.length + 2;
  const closing = pN(closingNum, 7) + "9999" + "00" + "01" + "001";
  return [opening, ...lines, closing].join("\n");
}

// ── Generador XML1 — Orden de Producción (Entrada Desprese) ───────────────
// Diferencias respecto a Salida Desprese:
//   · clase_op = "004" (Salida usa "002")
//   · Una sola línea 851 para PI00001 con la SUMATORIA de KIL de todas las filas
//   · f851_id_metodo_lista va en blanco (Salida usa "0001")
//   · f851_id_lote = LOTE_PRODUCTO de las filas (todas comparten el mismo lote)
function buildXML1(filtro: Filtro, rows: ProductRow[], consecOpg: number): string {
  const fecha   = fechaYMD(filtro.fecha);
  const opening = "000000100000001001";

  // ── Encabezado (tipo 850) ─────────────────────────────────────────────
  const header =
    pN(2,   7) + pN(850, 4) + pN(0, 2) + pN(1, 2) + pN(1, 3) + pN(0, 1) +
    pA(filtro.centroOperacion,      3) +   // f850_id_co
    pA("OPG",                       3) +   // f850_id_tipo_docto
    pN(consecOpg,                   8) +   // f850_consec_docto
    pA(fecha,                       8) +   // f850_fecha
    pN(1,   1) +                           // f850_ind_estado
    pN(0,   1) +                           // f850_ind_impresion
    pN(701, 3) +                           // f850_id_clase_docto
    pA(filtro.terceroPlanificador,  15) +  // f850_tercero_planificador
    pA("OPG",                       3) +   // f850_id_tipo_docto_op_padre
    pN(1,   8) +                           // f850_consec_docto_op_padre
    pA(filtro.instalacion,          3) +   // f850_id_instalacion
    pA("004",                       3) +   // f850_clase_op ← "004" para Entrada Desprese
    pA("",                         30) +   // f850_referencia_1
    pA("",                         30) +   // f850_referencia_2
    pA("",                         30) +   // f850_referencia_3
    pA(filtro.nombre,            2000) +   // f850_notas
    pA("",                          3) +   // f850_id_co_pv
    pA("",                          3) +   // f850_id_tipo_docto_pv
    pN(0,   8);                            // f850_consec_docto_pv

  // ── Única línea 851: PI00001 con sumatoria de KIL ─────────────────────
  const totalKil = rows.reduce((s, r) => s + Number(r.KIL), 0);
  const lote     = rows[0]?.LOTE_PRODUCTO ?? "";
  const bodega   = pA(filtro.bodegaItemPadre ?? "", 5);

  const pi00001Line =
    pN(3,  7) + pN(851, 4) + pN(0, 2) + pN(1, 2) + pN(1, 3) +
    pA(filtro.centroOperacion,  3) +   // f851_id_co
    pA("OPG",                   3) +   // f851_id_tipo_docto
    pN(consecOpg,               8) +   // f851_consec_docto
    pN(1,                      10) +   // f851_nro_registro
    pN(0,                       7) +   // f851_id_item
    pA("PI00001",              50) +   // f851_referencia_item
    pA("",                     20) +   // f851_codigo_barras
    pA("",                     20) +   // f851_id_ext1_detalle
    pA("",                     20) +   // f851_id_ext2_detalle
    pA("KIL",                   4) +   // f851_id_unidad_medida
    pN(100,                     8) +   // f851_porc_rendimiento
    pQ(totalKil,               15, 4) + // f851_cant_planeada_base (sumatoria)
    pA(fecha,                   8) +   // f851_fecha_inicio
    pA(fecha,                   8) +   // f851_fecha_terminacion
    pA("",                      4) +   // f851_id_metodo_lista ← VACÍO para Entrada Desprese
    pA("",                      5) +   // f851_id_bodega_componentes ← VACÍO para Entrada Desprese
    pA("",                      4) +   // f851_id_metodo_ruta
    pA(lote,                   15) +   // f851_id_lote (LOTE_PRODUCTO de las filas)
    pA("",                   2000) +   // f851_notas
    bodega;                             // f851_id_bodega (5)

  // Cierre: 1 línea de producto + 3 = línea 4
  const closing = pN(4, 7) + "9999" + "00" + "01" + "001";
  return [opening, header, pi00001Line, closing].join("\n");
}

// ── Generador XML2 — Consumo de Producción (Entrada Desprese) ────────────
// Usa los productos consultados directamente (no consulta componentes en ERP).
// Cada producto crudo es un componente consumido con padre = PI00001.
// Estructura: apertura + encabezado 450 (344 chars) + líneas 470 (2673 chars) + cierre
function buildXML2(filtro: Filtro, rows: ProductRow[], consecOpg: number): string {
  const fecha   = fechaYMD(filtro.fecha);
  const opening = "000000100000001001";

  // ── Encabezado tipo 450, subtipo 3, versión 1 (344 chars) ────────────────
  // Longitudes: 7+4+2+2+3+1+3+3+8+8+1+1+3+15+255+2+15+3+8 = 344
  const encabezado =
    pN(2,   7) + pN(450, 4) + pN(3, 2) + pN(1, 2) + pN(1, 3) + pN(1, 1) +
    pA(filtro.centroOperacion, 3) +   // f350_id_co
    pA("SCG",                  3) +   // f350_id_tipo_docto
    pN(1,   8) +                      // f350_consec_docto = 1 (ERP asigna)
    pA(fecha,                  8) +   // f350_id_fecha
    pN(1,   1) +                      // f350_ind_estado = 1
    pN(0,   1) +                      // f350_ind_impresion = 0
    pN(710, 3) +                      // f350_id_clase_docto = 710
    pA("",  15) +                     // f350_docto_alterno
    pA(filtro.nombre,        255) +   // f350_notas
    pA("01",  2) +                    // f350_id_motivo = 01
    pA("",   15) +                    // f350_id_proyecto
    pA("OPG", 3) +                    // f850_tipo_docto = OPG
    pN(consecOpg, 8);                 // f850_consec_docto (nro de la OP creada)

  // ── Líneas tipo 470, subtipo 00, versión 4 (2673 chars c/u) ──────────────
  // Longitudes: 7+4+2+2+3+3+3+8+10+7+50+20+20+20+10+7+50+20+20+20+5+10+15+3+2+3+20+15+15+4+20+20+255+2000 = 2673
  const productLines = rows.map((row, i) =>
    pN(i + 3,  7) + pN(470, 4) + pN(0, 2) + pN(4, 2) + pN(1, 3) +
    pA(filtro.centroOperacion,     3) +   // f470_id_co
    pA("SCG",                      3) +   // f470_id_tipo_docto
    pN(1,      8) +                       // f470_consec_docto = 1
    pN(i + 1, 10) +                       // f470_nro_registro (1, 2, 3…)
    pN(0,      7) +                       // f470_id_item_padre
    pA("PI00001",                 50) +   // f470_referencia_item_padre = PI00001
    pA("",    20) +                       // f470_codigo_barras_padre
    pA("",    20) +                       // f470_id_ext1_detalle_padre
    pA("",    20) +                       // f470_id_ext2_detalle_padre
    pN(0,     10) +                       // f470_numero_operacion
    pN(0,      7) +                       // f470_id_item_comp
    pA(row.CODIGO_PRODUCTO,       50) +   // f470_referencia_item_comp
    pA("",    20) +                       // f470_codigo_barras_comp
    pA("",    20) +                       // f470_id_ext1_detalle_comp
    pA("",    20) +                       // f470_id_ext2_detalle_comp
    pA((row.BODEGA ?? "").trim(),  5) +   // f470_id_bodega
    pA("",    10) +                       // f470_id_ubicacion_aux
    pA(row.LOTE_PRODUCTO,         15) +   // f470_id_lote
    pN(701,    3) +                       // f470_id_concepto = 701
    pA("01",   2) +                       // f470_id_motivo = 01
    pA(filtro.centroOperacion,     3) +   // f470_id_co_movto
    pA("31",  20) +                       // f470_id_un_movto
    pA("70010101",                15) +   // f470_id_ccosto_movto
    pA("",    15) +                       // f470_id_proyecto
    pA(row.UNIDAD_PRODUCTO,        4) +   // f470_id_unidad_medida
    pQ(Number(row.KIL), 15, 4) +          // f470_cant_base (20 chars)
    pQ(Number(row.UND), 15, 4) +          // f470_cant_2 (20 chars)
    pA("",   255) +                       // f470_notas
    pA("",  2000)                         // f470_desc_varible
  );

  const closingNum = rows.length + 3;
  const closing = pN(closingNum, 7) + "9999" + "00" + "01" + "001";
  return [opening, encabezado, ...productLines, closing].join("\n");
}

// ── Componente: bloque XML con copiar ─────────────────────────────────────
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

// ── Badge de estado ────────────────────────────────────────────────────────
function EstadoBadge({ estado }: { estado: EstadoDoc }) {
  if (estado === "ENVIADO")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
        Enviado
      </span>
    );
  if (estado === "ERROR")
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
        </svg>
        Error
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-500 border border-slate-200">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      Pendiente
    </span>
  );
}

// ── Panel de errores ERP por documento ────────────────────────────────────
function DocResultPanel({
  label, result, onReintentar, retrying,
}: {
  label:        string;
  result:       DocResult;
  onReintentar?: () => void;
  retrying?:    boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 space-y-3 ${
      result.estado === "ENVIADO" ? "border-emerald-200 bg-emerald-50" :
      result.estado === "ERROR"   ? "border-red-200 bg-red-50" :
                                    "border-slate-200 bg-slate-50"
    }`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        <EstadoBadge estado={result.estado} />
      </div>

      {result.exitoso && (
        <p className="text-xs text-emerald-700 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Documento creado exitosamente en ERP
        </p>
      )}

      {result.errores.length > 0 && (
        <div className="space-y-2">
          {result.errores.map((e, i) => (
            <div key={i} className="rounded-lg bg-white border border-red-100 px-3 py-2.5 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                  Línea {e.nroLinea}
                </span>
                {e.tipoReg && (
                  <span className="font-mono text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                    Tipo {e.tipoReg}
                  </span>
                )}
                {e.valor?.trim() && (
                  <span className="font-mono text-xs bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">
                    Valor: {e.valor.trim()}
                  </span>
                )}
              </div>
              {e.detalle && <p className="text-xs text-red-800 font-medium">{e.detalle}</p>}
            </div>
          ))}
        </div>
      )}

      {result.estado === "ERROR" && !result.exitoso && result.errores.length === 0 && (
        <details className="group">
          <summary className="text-xs text-red-600 font-medium cursor-pointer select-none list-none flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Ver respuesta del ERP
          </summary>
          <pre className="mt-2 text-[10px] text-slate-500 font-mono whitespace-pre-wrap break-all bg-white border border-red-100 rounded-lg p-2 max-h-48 overflow-y-auto">
            Sin respuesta
          </pre>
        </details>
      )}

      {result.estado === "PENDIENTE" && !result.exitoso && result.errores.length === 0 && (
        <p className="text-xs text-slate-500">
          No se envió — depende de que el documento anterior sea exitoso.
        </p>
      )}

      {result.estado === "ERROR" && onReintentar && (
        <button
          onClick={onReintentar}
          disabled={retrying}
          className="flex items-center gap-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:bg-red-300 px-3 py-1.5 rounded-lg transition-colors"
        >
          <svg className={`w-3.5 h-3.5 ${retrying ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Reintentar transmisión
        </button>
      )}
    </div>
  );
}

// ── Panel de resultado de creación de lotes ───────────────────────────────
function LotesResultPanel({ result }: { result: LoteCreacionResult }) {
  const todoOmitidos = result.omitidos.length > 0 && result.nuevos.length === 0;
  const hayErrores   = !result.exitoso && result.nuevos.length > 0;

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${
      hayErrores   ? "border-amber-200 bg-amber-50"   :
      todoOmitidos ? "border-slate-200 bg-slate-50"   :
                     "border-emerald-200 bg-emerald-50"
    }`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <svg className={`w-4 h-4 ${hayErrores ? "text-amber-500" : "text-emerald-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <span className="text-xs font-semibold text-slate-700">Registro de Lotes</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {result.omitidos.length > 0 && (
            <span className="text-xs bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-full font-medium">
              {result.omitidos.length} ya existían
            </span>
          )}
          {result.nuevos.length > 0 && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
              hayErrores
                ? "bg-amber-100 text-amber-700 border-amber-200"
                : "bg-emerald-100 text-emerald-700 border-emerald-200"
            }`}>
              {result.creados.length} / {result.nuevos.length} creados
            </span>
          )}
        </div>
      </div>

      {todoOmitidos && (
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Todos los lotes ya estaban registrados — se omitió el envío al ERP.
        </p>
      )}

      {result.exitoso && result.nuevos.length > 0 && (
        <p className="text-xs text-emerald-700 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Lotes creados exitosamente en ERP.
        </p>
      )}

      {hayErrores && result.errores.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-amber-700">Errores al crear lotes:</p>
          {result.errores.map((e, i) => (
            <div key={i} className="rounded-lg bg-white border border-amber-100 px-3 py-2.5 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                  Línea {e.nroLinea}
                </span>
                {e.valor?.trim() && (
                  <span className="font-mono text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                    {e.valor.trim()}
                  </span>
                )}
              </div>
              {e.detalle && <p className="text-xs text-amber-900 font-medium">{e.detalle}</p>}
            </div>
          ))}
        </div>
      )}

      {hayErrores && result.errores.length === 0 && (
        <p className="text-xs text-amber-700">
          El ERP rechazó la creación de lotes. Verifique el XML enviado.
        </p>
      )}
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────
const fmtNum = (n: number) =>
  new Intl.NumberFormat("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default function EntradaDesPreseDetailPage() {
  const { id }   = useParams<{ id: string }>();
  const router   = useRouter();

  const [filtro, setFiltro]   = useState<Filtro | null>(null);
  const [rows, setRows]       = useState<ProductRow[]>([]);
  const [bache, setBache]     = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const [consecOpg, setConsecOpg]           = useState<number>(0);
  const [transmitting, setTransmitting]     = useState(false);
  const [transmitResult, setTransmitResult] = useState<TransmitResult | null>(null);
  const [transmitError, setTransmitError]   = useState<string | null>(null);
  const [retrying, setRetrying]             = useState(false);

  const [lotesResult, setLotesResult] = useState<LoteCreacionResult | null>(null);

  const cargarDatos = useCallback(async () => {
    setLoading(true);
    setError(null);
    setTransmitResult(null);
    setTransmitError(null);
    setLotesResult(null);
    try {
      const res  = await fetch(`/api/export-produccion/${id}/results`, { method: "POST" });
      const text = await res.text();
      if (!text) throw new Error("El servidor no devolvió respuesta");
      const data = JSON.parse(text);
      if (!res.ok) throw new Error(data.error ?? "Error al cargar los datos");
      setFiltro(data.filtro);
      setBache(data.bache);
      setRows(data.rows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  const totalKil = rows.reduce((s, r) => s + Number(r.KIL), 0);
  const totalUnd = rows.reduce((s, r) => s + Number(r.UND), 0);

  const xmlLotes    = filtro ? buildXMLLotes(rows, fechaYMD(filtro.fecha)) : "";
  const xml1        = filtro ? buildXML1(filtro, rows, consecOpg) : "";
  const xml2        = filtro && rows.length > 0 ? buildXML2(filtro, rows, consecOpg) : "";
  const xml3Preview = transmitResult?.xml3 || "// Se genera en el servidor al completar el consumo";

  const transmitir = useCallback(async (esReintento = false) => {
    if (!bache || !filtro) return;
    if (esReintento) setRetrying(true);
    else {
      setTransmitting(true);
      setTransmitResult(null);
      setLotesResult(null);
    }
    setTransmitError(null);

    try {
      // ── Paso 1: Crear/verificar lotes en ERP ─────────────────────────────
      // Incluye los productos crudos Y PI00001 (que comparte el lote de las filas)
      const lotePi = rows[0]?.LOTE_PRODUCTO?.trim() ?? "";
      const uniqueLotes: ProductoLote[] = Array.from(
        new Map([
          // Productos crudos consultados
          ...rows
            .filter((r) => r.LOTE_PRODUCTO?.trim())
            .map((r): [string, ProductoLote] => [
              `${r.CODIGO_PRODUCTO}|${r.LOTE_PRODUCTO}`,
              { codigo: r.CODIGO_PRODUCTO, lote: r.LOTE_PRODUCTO },
            ]),
          // PI00001 — producto en proceso que se va a producir
          ...(lotePi
            ? [[`PI00001|${lotePi}`, { codigo: "PI00001", lote: lotePi }] as [string, ProductoLote]]
            : []),
        ]).values()
      );

      if (uniqueLotes.length > 0) {
        const lotesRes  = await fetch(`/api/export-produccion/${id}/lotes`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ productos: uniqueLotes, fecha: fechaYMD(filtro.fecha) }),
        });
        const lotesText = await lotesRes.text();
        if (!lotesText) throw new Error("Sin respuesta al crear lotes");
        const lotesData: LoteCreacionResult = JSON.parse(lotesText);
        if (!lotesRes.ok) throw new Error(lotesData.error ?? "Error al crear lotes");
        setLotesResult(lotesData);

        if (!lotesData.exitoso && lotesData.nuevos.length > 0) {
          setTransmitting(false);
          setRetrying(false);
          return;
        }
      }

      // ── Paso 2: Obtener consecutivo OPG ──────────────────────────────────
      const seqRes  = await fetch("/api/export-produccion/seq-opg", { method: "POST" });
      const seqText = await seqRes.text();
      if (!seqText) throw new Error("Sin respuesta al obtener SEQ_OPG");
      const seqData = JSON.parse(seqText);
      if (!seqRes.ok) throw new Error(seqData.error ?? "Error al obtener SEQ_OPG");
      const nuevoConsec: number = seqData.consecOpg;
      setConsecOpg(nuevoConsec);

      // ── Paso 3: Transmitir ────────────────────────────────────────────────
      const xml1Final = buildXML1(filtro, rows, nuevoConsec);

      // lotesPorProducto: indexado por código del producto crudo (para XML2 del servidor)
      const lotesPorProducto: Record<string, string> = {};
      rows.forEach((r) => {
        const codigo = r.CODIGO_PRODUCTO.trim();
        const lote   = r.LOTE_PRODUCTO?.trim() ?? "";
        if (codigo) lotesPorProducto[codigo] = lote;
      });

      // XML2: consumo de los productos crudos — construido localmente, sin consulta SOAP
      const xml2Final = buildXML2(filtro, rows, nuevoConsec);

      // XML3: entrega de PI00001 con la sumatoria de KIL
      const rowsParaXml3 = [{
        CODIGO_PRODUCTO: "PI00001",
        LOTE_PRODUCTO:   rows[0]?.LOTE_PRODUCTO ?? "",
        BODEGA:          filtro.bodegaItemPadre ?? (rows[0]?.BODEGA ?? ""),
        UNIDAD_PRODUCTO: "KIL",
        KIL:             totalKil,
        UND:             0,
      }];

      const res  = await fetch(`/api/export-produccion/${id}/transmit`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          bache,
          consecOpg:        nuevoConsec,
          xml1:             xml1Final,
          lotesPorProducto,
          rows:             rowsParaXml3,
          xml2Prefabricado: xml2Final,   // ← XML2 ya construido, omite consulta SOAP
        }),
      });
      const text = await res.text();
      if (!text) throw new Error("El servidor no devolvió respuesta");
      const data = JSON.parse(text);
      if (!res.ok) throw new Error(data.error ?? "Error al transmitir");
      setTransmitResult(data);
    } catch (err: unknown) {
      setTransmitError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setTransmitting(false);
      setRetrying(false);
    }
  }, [id, bache, filtro, rows, totalKil]);

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
            {filtro ? `Entrada Desprese — ${filtro.nombre}` : "Entrada Desprese"}
          </h1>
          {filtro && (
            <p className="text-xs text-slate-400 mt-0.5">
              {new Date(filtro.fecha.split("T")[0] + "T00:00:00").toLocaleDateString("es-CO")}
              {filtro.tipoDocumento  && <> · Tipo Doc: <span className="font-medium">{filtro.tipoDocumento}</span></>}
              {filtro.tipoMovimiento && <> · Tipo Mov: <span className="font-medium">{filtro.tipoMovimiento}</span></>}
            </p>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {bache !== null && (
            <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold px-3 py-1.5 rounded-xl">
              <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
              </svg>
              Lote {bache}
            </div>
          )}

          {consecOpg > 0 && (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-xl">
              <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              OPG #{consecOpg}
            </div>
          )}

          <button
            onClick={cargarDatos}
            disabled={loading || transmitting}
            className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-white border border-transparent hover:border-slate-200 px-3 py-2 rounded-xl transition-all disabled:opacity-40"
          >
            <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Actualizar
          </button>

          {!loading && rows.length > 0 && (
            <button
              onClick={() => transmitir(false)}
              disabled={transmitting || loading}
              className="flex items-center gap-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white px-4 py-2 rounded-xl transition-all shadow-sm"
            >
              {transmitting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Transmitiendo…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                  Transmitir al ERP
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      {transmitError && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {transmitError}
        </div>
      )}

      {lotesResult && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <p className="text-sm font-semibold text-slate-700">Paso 1 — Registro de lotes</p>
          <LotesResultPanel result={lotesResult} />
        </div>
      )}

      {transmitResult && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-700">
                {lotesResult ? "Paso 2 — " : ""}Resultado de transmisión
              </span>
              <span className="text-xs font-semibold bg-indigo-50 text-indigo-600 border border-indigo-200 px-2 py-0.5 rounded-full">
                OPG #{transmitResult.numeroOpg}
              </span>
            </div>
            {transmitResult.orden.exitoso && transmitResult.consumo.exitoso && transmitResult.entrega.exitoso ? (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Todos los documentos enviados
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-red-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Hay errores — revisa los detalles
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <DocResultPanel
              label="Orden de Producción (PI00001)"
              result={transmitResult.orden}
              onReintentar={!transmitResult.orden.exitoso ? () => transmitir(true) : undefined}
              retrying={retrying}
            />
            <DocResultPanel
              label="Consumo — Productos crudos"
              result={transmitResult.consumo}
              onReintentar={!transmitResult.consumo.exitoso && transmitResult.orden.exitoso ? () => transmitir(true) : undefined}
              retrying={retrying}
            />
            <DocResultPanel
              label="Entrega — PI00001"
              result={transmitResult.entrega}
              onReintentar={!transmitResult.entrega.exitoso && transmitResult.orden.exitoso && transmitResult.consumo.exitoso ? () => transmitir(true) : undefined}
              retrying={retrying}
            />
          </div>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Totales */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Total Productos</p>
              <p className="text-2xl font-bold text-slate-800">{rows.length}</p>
              <p className="text-xs text-slate-400 mt-1">Componentes a consumir</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Total KIL → PI00001</p>
              <p className="text-2xl font-bold text-slate-800">{fmtNum(totalKil)}</p>
              <p className="text-xs text-slate-400 mt-1">Cantidad a producir</p>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Total Unidades</p>
              <p className="text-2xl font-bold text-slate-800">{fmtNum(totalUnd)}</p>
            </div>
          </div>

          <XmlBlock title="XML Lotes — Tipo 403"                  content={xmlLotes} />
          <XmlBlock title="XML 1 — Orden de Producción (PI00001)" content={xml1} />
          <XmlBlock title="XML 2 — Consumo — Productos crudos"    content={xml2} />
          <XmlBlock title="XML 3 — Entrega — PI00001"             content={xml3Preview} />
        </>
      )}

      {/* Tabla de productos consultados */}
      {(rows.length > 0 || loading) && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Productos consultados — serán los componentes del consumo
            </span>
          </div>
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
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        {Array.from({ length: 9 }).map((__, j) => (
                          <td key={j} className="px-5 py-4">
                            <div className="h-4 bg-slate-100 rounded w-3/4" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : rows.map((row, i) => (
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
                    <td colSpan={6} className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Total → PI00001
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-slate-800 tabular-nums">{fmtNum(totalKil)}</td>
                    <td className="px-5 py-3 text-right font-bold text-slate-800 tabular-nums">{fmtNum(totalUnd)}</td>
                    <td className="px-5 py-3" />
                  </tr>
                </tfoot>
              )}
            </table>

            {!loading && rows.length === 0 && (
              <div className="text-center py-12 text-slate-400">
                <svg className="w-10 h-10 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm">No se encontraron registros con los filtros aplicados</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
