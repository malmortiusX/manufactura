"use client";
// src/app/dashboard/export-produccion/beneficio/[id]/page.tsx
// Proceso Beneficio (dos OPGs en cascada):
//   OPG1: OP con productos filtrados → consulta componentes → suma PP00001/PP00002/PP00003
//   OPG2: OP para los PP sumados → SPG (consumo OPG2) → EPG (entrega PP)
//   SPG OPG1: consumo con todos los componentes de OPG1
//   EPG OPG1: entrega de los productos filtrados
import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { leerLotesStream } from "@/lib/lotes-stream";

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
  tipoDoctoOrden: string | null;
  productosEnProceso: string | null;
  productosSinLote: string | null;
  ppCodigos: string | null;
  ppConLote: string | null;
  productosSinCantAdicional: string | null;
  motivoConsumo: string | null;
  motivoEntrega: string | null;
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
  exitoso:       boolean;
  errores:       ErpError[];
  estado:        EstadoDoc;
  respuestaRaw?: string;
}

interface OPGResult {
  orden:   DocResult;
  consumo: DocResult;
  entrega: DocResult;
}

interface PpItem { codigo: string; cantidad: number; unidad: string; lote: string; }

interface ExistenciaComparacion {
  bodegaId:    string;
  referencia:  string;
  lote:        string;
  disponible1: number;
  disponible2: number;
  aConsumir1:  number;
  suficiente:  boolean;
}

interface ExistenciaCheck {
  items:      ExistenciaComparacion[];
  suficiente: boolean;
}

interface TransmitResult {
  logId1:   number;
  logId2:   number | null;
  opg1Num:  number;
  opg2Num:  number;
  ppItems:  PpItem[];
  opg1:     OPGResult;
  opg2:     OPGResult;
  xmls: {
    xml1b:             string;
    xml2b:             string;
    xml3b:             string;
    xml2:              string;
    xml3:              string;
    xmlLotesEpgOpg2:   string;
  };
  existenciaCheck?: ExistenciaCheck;
}

interface RowOpg1 {
  UNIDAD_PRODUCTO: string;
  CODIGO_PRODUCTO: string;
  bache:           number;
  KIL:             number;
  UND:             number;
}

interface ProductoLote { codigo: string; lote: string; }

interface LoteCreacionResult {
  exitoso:      boolean;
  omitidos:     ProductoLote[];
  nuevos:       ProductoLote[];
  creados:      ProductoLote[];
  errores:      ErpError[];
  respuestaRaw: string;
  xmlLotes:     string | null;
  error?:       string;
}

// ── Utilidades ────────────────────────────────────────────────────────────
const pN = (val: string | number | null | undefined, len: number) =>
  String(Math.floor(Number(val) || 0)).padStart(len, "0").slice(-len);

const pA = (val: string | null | undefined, len: number) =>
  (val ?? "").slice(0, len).padEnd(len, " ");

function fechaYMD(raw: string): string {
  return raw.split("T")[0].replace(/-/g, "");
}

function loteJuliano(fecha: string): string {
  const y      = parseInt(fecha.slice(0, 4), 10);
  const m      = parseInt(fecha.slice(4, 6), 10);
  const d      = parseInt(fecha.slice(6, 8), 10);
  const inicio = new Date(y, 0, 1);
  const actual = new Date(y, m - 1, d);
  const dia    = Math.round((actual.getTime() - inicio.getTime()) / 86_400_000) + 1;
  return String(dia).padStart(3, "0") + String(y).slice(-2);
}

function pQ(val: number, intLen: number, dec: number): string {
  const factor  = Math.pow(10, dec);
  const rounded = Math.round(Number(val) * factor) / factor;
  const [intPart, decPart = ""] = rounded.toFixed(dec).split(".");
  return intPart.padStart(intLen, "0") + "." + decPart.padEnd(dec, "0");
}

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

// ── XML Lotes (tipo 403) ──────────────────────────────────────────────────
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
    pN(i + 2, 7) + pN(403, 4) + pN(0, 2) + pN(2, 2) + pN(1, 3) + pN(0, 1) +
    pA(p.lote,    15) + pN(0, 7) + pA(p.codigo, 50) +
    pA("", 20) + pA("", 20) + pA("", 20) + pA("", 3) +
    pN(1, 1) + pA(fecha, 8) + pA(fechaVcto, 8) +
    pA("", 15) + pA("", 15) + pA("", 3) + pA("", 40) + pA("", 15) + pA("", 8) +
    pA("Creado por plano", 255)
  );

  const closing = pN(productos.length + 2, 7) + "9999" + "00" + "01" + "001";
  return [opening, ...lines, closing].join("\n");
}

// ── XML1 — OPG1 (clase_op=002) ────────────────────────────────────────────
function buildXML1(
  filtro:     Filtro,
  rowsOpg1:   RowOpg1[],
  consecOpg:  number,
  sinLoteSet: Set<string>,
): string {
  const fecha   = fechaYMD(filtro.fecha);
  const lote    = loteJuliano(fecha);
  const opening = "000000100000001001";

  const header =
    pN(2,   7) + pN(850, 4) + pN(0, 2) + pN(1, 2) + pN(1, 3) + pN(0, 1) +
    pA(filtro.centroOperacion,         3) +
    pA(filtro.tipoDoctoOrden ?? "OPG", 3) +
    pN(consecOpg, 8) +
    pA(fecha,                          8) +
    pN(1,   1) + pN(0, 1) + pN(701, 3) +
    pA(filtro.terceroPlanificador,    15) +
    pA("",                             3) +   // f850_id_tipo_docto_op_padre — vacío
    pN(0,   8) +                              // f850_consec_docto_op_padre  — vacío
    pA(filtro.instalacion,             3) +
    pA("002",                          3) +
    pA("",                            30) + pA("", 30) + pA("", 30) +
    pA(filtro.nombre,               2000) +
    pA("",                             3) + pA("", 3) +
    pN(0,   8);

  const productLines = rowsOpg1.map((row, i) => {
    const esSinLote = sinLoteSet.has(row.CODIGO_PRODUCTO.trim());
    return (
      pN(i + 3,  7) + pN(851, 4) + pN(0, 2) + pN(1, 2) + pN(1, 3) +
      pA(filtro.centroOperacion,         3) +
      pA(filtro.tipoDoctoOrden ?? "OPG", 3) +
      pN(consecOpg, 8) +
      pN(i + 1,                  10) +
      pN(0,      7) +
      pA(row.CODIGO_PRODUCTO,    50) +
      pA("",    20) + pA("", 20) + pA("", 20) +
      pA(row.UNIDAD_PRODUCTO,     4) +
      pN(100,    8) +
      pQ(Number(row.KIL), 15, 4) +
      pA(fecha,                   8) +
      pA(fecha,                   8) +
      pA("0001",                  4) +
      pA("",                      5) +
      pA("0001",                      4) + // f851_id_metodo_ruta: metodo de ruta
      pA(esSinLote ? "" : lote,  15) +   // f851_id_lote: vacío si es sin-lote
      pA("",                   2000) +
      pA(filtro.bodegaItemPadre ?? "", 5)
    );
  });

  const closing = pN(rowsOpg1.length + 3, 7) + "9999" + "00" + "01" + "001";
  return [opening, header, ...productLines, closing].join("\n");
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

// ── Panel de resultado de un documento ───────────────────────────────────
function DocResultPanel({
  label, result, onReintentar, retrying,
}: {
  label: string;
  result: DocResult;
  onReintentar?: () => void;
  retrying?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 space-y-2 ${
      result.estado === "ENVIADO" ? "border-emerald-200 bg-emerald-50" :
      result.estado === "ERROR"   ? "border-red-200 bg-red-50"         :
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
          Enviado exitosamente
        </p>
      )}
      {result.errores.length > 0 && (
        <div className="space-y-1.5 mt-1">
          {result.errores.map((e, i) => (
            <div key={i} className="rounded-lg bg-white border border-red-100 px-3 py-2 space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Línea {e.nroLinea}</span>
                {e.tipoReg && <span className="font-mono text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">Tipo {e.tipoReg}</span>}
                {e.valor?.trim() && <span className="font-mono text-xs bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">{e.valor.trim()}</span>}
              </div>
              {e.detalle && <p className="text-xs text-red-800 font-medium">{e.detalle}</p>}
            </div>
          ))}
        </div>
      )}
      {result.estado === "PENDIENTE" && !result.exitoso && result.errores.length === 0 && (
        <p className="text-xs text-slate-500">No se envió — depende del documento anterior.</p>
      )}
      {result.estado === "ERROR" && result.errores.length === 0 && result.respuestaRaw?.trim() && (
        <pre className="text-xs bg-red-100 border border-red-200 rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap break-all text-red-800 max-h-40">
          {result.respuestaRaw.trim()}
        </pre>
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

// ── Panel de un OPG (3 documentos) ───────────────────────────────────────
function OPGPanel({ titulo, num, result, accent, retrying, onReintentarOrden, onReintentarConsumo, onReintentarEntrega }: {
  titulo: string;
  num: number;
  result: OPGResult;
  accent: string;
  retrying?: boolean;
  onReintentarOrden?:   () => void;
  onReintentarConsumo?: () => void;
  onReintentarEntrega?: () => void;
}) {
  const todoOk = result.orden.exitoso && result.consumo.exitoso && result.entrega.exitoso;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">{titulo}</span>
          {num > 0 && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${accent}`}>
              OPG #{num}
            </span>
          )}
        </div>
        {num > 0 && (
          todoOk ? (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Completo
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs font-semibold text-red-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Con errores
            </span>
          )
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <DocResultPanel label="Orden de Producción" result={result.orden}   onReintentar={onReintentarOrden}   retrying={retrying} />
        <DocResultPanel label="Consumo (SPG)"       result={result.consumo} onReintentar={onReintentarConsumo} retrying={retrying} />
        <DocResultPanel label="Entrega (EPG)"       result={result.entrega} onReintentar={onReintentarEntrega} retrying={retrying} />
      </div>
    </div>
  );
}

// ── Panel lotes ───────────────────────────────────────────────────────────
function LotesResultPanel({ result }: { result: LoteCreacionResult }) {
  const todoOmitidos = result.omitidos.length > 0 && result.nuevos.length === 0;
  const hayErrores   = !result.exitoso && result.nuevos.length > 0;
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${
      hayErrores   ? "border-amber-200 bg-amber-50" :
      todoOmitidos ? "border-slate-200 bg-slate-50" :
                     "border-emerald-200 bg-emerald-50"
    }`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-semibold text-slate-700">Registro de Lotes</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          {result.omitidos.length > 0 && (
            <span className="text-xs bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-full font-medium">
              {result.omitidos.length} ya existían
            </span>
          )}
          {result.nuevos.length > 0 && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
              hayErrores ? "bg-amber-100 text-amber-700 border-amber-200" : "bg-emerald-100 text-emerald-700 border-emerald-200"
            }`}>
              {result.creados.length} / {result.nuevos.length} creados
            </span>
          )}
        </div>
      </div>
      {todoOmitidos && <p className="text-xs text-slate-500">Todos los lotes ya estaban registrados.</p>}
      {result.exitoso && result.nuevos.length > 0 && (
        <p className="text-xs text-emerald-700">Lotes creados exitosamente en ERP.</p>
      )}
      {result.errores.length > 0 && (
        <div className="space-y-1">
          {result.errores.map((e, i) => (
            <div key={i} className="text-xs bg-amber-100 border border-amber-200 rounded-lg px-3 py-2 text-amber-800">
              <span className="font-semibold">Línea {e.nroLinea} · Nivel {e.nivel}</span>
              {" — "}{e.detalle || e.valor}
            </div>
          ))}
        </div>
      )}
      {result.respuestaRaw && (
        <div>
          <button
            onClick={() => setShowRaw(v => !v)}
            className="text-xs text-slate-500 hover:text-slate-700 underline"
          >
            {showRaw ? "Ocultar respuesta ERP" : "Ver respuesta ERP"}
          </button>
          {showRaw && (
            <pre className="mt-2 text-xs bg-slate-100 border border-slate-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all text-slate-600 max-h-48">
              {result.respuestaRaw}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Panel de verificación de existencias OPG1 ────────────────────────────
function ExistenciaCheckPanel({
  check,
  onReverificar,
  loading,
}: {
  check:         ExistenciaCheck;
  onReverificar: () => void;
  loading:       boolean;
}) {
  const insuficientes = check.items.filter((i) => !i.suficiente).length;
  // Insuficientes primero, luego suficientes
  const itemsOrdenados = [
    ...check.items.filter((i) => !i.suficiente),
    ...check.items.filter((i) =>  i.suficiente),
  ];

  return (
    <div className="bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden">
      {/* Encabezado */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-red-100 bg-red-50">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="text-xs font-semibold text-red-700 uppercase tracking-wider">
            Existencias insuficientes — Consumo OPG1
          </span>
          <span className="text-xs font-semibold bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 rounded-full">
            {insuficientes} {insuficientes === 1 ? "producto" : "productos"} sin stock suficiente
          </span>
        </div>
        <button
          onClick={onReverificar}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:bg-red-300 px-3 py-1.5 rounded-lg transition-colors"
        >
          <svg
            className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {loading ? "Verificando…" : "Re-verificar y continuar"}
        </button>
      </div>

      {/* Cuerpo */}
      <div className="p-4 space-y-3">
        <p className="text-xs text-red-600">
          El consumo de la OPG1 fue bloqueado porque uno o más productos no tienen existencia suficiente en el ERP.
          Ajuste las cantidades en el sistema y presione <strong>Re-verificar y continuar</strong>.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide">Bodega</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide">Referencia</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide">A consumir</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide">Disponible</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide">Diferencia</th>
                <th className="text-center px-3 py-2 font-semibold text-slate-500 uppercase tracking-wide">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {itemsOrdenados.map((item, i) => {
                const diff = item.disponible1 - item.aConsumir1;
                return (
                  <tr key={i} className={item.suficiente ? "bg-emerald-50" : "bg-red-50"}>
                    <td className={`px-3 py-2 font-mono text-xs ${item.suficiente ? "text-emerald-700" : "text-red-600"}`}>
                      {item.bodegaId || <span className="italic text-slate-400">—</span>}
                    </td>
                    <td className={`px-3 py-2 font-mono font-semibold ${item.suficiente ? "text-emerald-800" : "text-red-800"}`}>
                      {item.referencia}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700 font-medium">
                      {fmtNum(item.aConsumir1)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                      item.suficiente ? "text-emerald-700" : "text-red-700"
                    }`}>
                      {fmtNum(item.disponible1)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                      item.suficiente ? "text-emerald-600" : "text-red-600"
                    }`}>
                      {diff >= 0 ? "+" : ""}{fmtNum(diff)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {item.suficiente ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-300">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          OK
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-300">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Insuficiente
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Panel XML colapsable: preview antes de enviar ────────────────────────
function XmlsPreview({ preview }: { preview: { xmlLotes: string; xml1: string } }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors"
      >
        <span className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          XMLs a transmitir
        </span>
        <svg className={`w-4 h-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="p-5 space-y-4">
          {preview.xmlLotes && <XmlBlock title="XML Lotes (403)" content={preview.xmlLotes} />}
          <XmlBlock title="XML OPG1 — Orden" content={preview.xml1} />
        </div>
      )}
    </div>
  );
}

// ── Panel XML colapsable: todos los XMLs generados ───────────────────────
function XmlsGenerados({
  preview,
  xmls,
  opg1Num,
  opg2Num,
}: {
  preview:  { xmlLotes: string; xml1: string } | null;
  xmls:     TransmitResult["xmls"];
  opg1Num:  number;
  opg2Num:  number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3 border-b border-slate-100 hover:bg-slate-50 transition-colors"
      >
        <span className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
          </svg>
          XMLs generados
        </span>
        <svg className={`w-4 h-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="p-5 space-y-4">
          {preview && <XmlBlock title="XML Lotes (403)" content={preview.xmlLotes} />}
          {preview && <XmlBlock title={`XML OPG1 #${opg1Num} — Orden`} content={preview.xml1} />}
          {opg2Num > 0 && xmls.xml1b && <XmlBlock title={`XML OPG2 #${opg2Num} — Orden`} content={xmls.xml1b} />}
          {opg2Num > 0 && xmls.xml2b && <XmlBlock title={`XML OPG2 #${opg2Num} — SPG Consumo`} content={xmls.xml2b} />}
          {opg2Num > 0 && xmls.xmlLotesEpgOpg2 && <XmlBlock title={`XML Lotes EPG OPG2 #${opg2Num}`} content={xmls.xmlLotesEpgOpg2} />}
          {opg2Num > 0 && xmls.xml3b && <XmlBlock title={`XML OPG2 #${opg2Num} — EPG Entrega`} content={xmls.xml3b} />}
          {xmls.xml2 && <XmlBlock title={`XML OPG1 #${opg1Num} — SPG Consumo`} content={xmls.xml2} />}
          {xmls.xml3 && <XmlBlock title={`XML OPG1 #${opg1Num} — EPG Entrega`} content={xmls.xml3} />}
        </div>
      )}
    </div>
  );
}

// Guard contra la doble ejecución de useEffect en React Strict Mode.
const _cargando = new Set<string>();

// ── Página principal ───────────────────────────────────────────────────────
const fmtNum = (n: number) =>
  new Intl.NumberFormat("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

const PENDIENTE_RESULT: DocResult = { exitoso: false, errores: [], estado: "PENDIENTE" };
const PENDIENTE_OPG: OPGResult    = { orden: PENDIENTE_RESULT, consumo: PENDIENTE_RESULT, entrega: PENDIENTE_RESULT };

export default function BeneficioDetailPage() {
  const { id }   = useParams<{ id: string }>();
  const router   = useRouter();

  const [filtro, setFiltro]   = useState<Filtro | null>(null);
  const [rows, setRows]       = useState<ProductRow[]>([]);
  const [rowsOpg1, setRowsOpg1] = useState<RowOpg1[]>([]);
  const [bache, setBache]     = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const [consecOpg1, setConsecOpg1]         = useState<number>(0);
  const [transmitting, setTransmitting]     = useState(false);
  const [transmitResult, setTransmitResult] = useState<TransmitResult | null>(null);
  const [transmitError, setTransmitError]   = useState<string | null>(null);
  const [retrying, setRetrying]             = useState(false);
  const [lotesResult, setLotesResult]       = useState<LoteCreacionResult | null>(null);
  const [lotesProgreso, setLotesProgreso]   = useState<{ completado: number; total: number } | null>(null);
  const [xmlsPreview, setXmlsPreview]       = useState<{ xmlLotes: string; xml1: string } | null>(null);
  const [logId1, setLogId1]                 = useState<number | null>(null);
  const [isResumeMode, setIsResumeMode]     = useState(false);
  const searchParams = useSearchParams();
  const bacheParam   = searchParams.get("bache");

  const cargarDatos = useCallback(async () => {
    if (_cargando.has(id)) return;
    _cargando.add(id);

    setBache(null);
    setRows([]);
    setRowsOpg1([]);
    setLoading(true);
    setError(null);
    setTransmitResult(null);
    setTransmitError(null);
    setLotesResult(null);
    setLotesProgreso(null);
    setXmlsPreview(null);
    setLogId1(null);
    setConsecOpg1(0);
    try {
      const res  = await fetch(`/api/export-produccion/${id}/results`, { method: "POST" });
      const text = await res.text();
      if (!text) throw new Error("El servidor no devolvió respuesta");
      const data = JSON.parse(text);
      if (!res.ok) throw new Error(data.error ?? "Error al cargar los datos");

      const filtroData:   Filtro    = data.filtro;
      const bacheData:    number    = data.bache;
      const rowsOpg1Data: RowOpg1[] = data.rowsOpg1 ?? [];

      setFiltro(filtroData);
      setBache(bacheData);
      setRows(data.rows);
      setRowsOpg1(rowsOpg1Data);

      // ── Inicializar log al marcar el bache ────────────────────────────
      // El OpgLog se crea aquí con estados PENDIENTE, antes de transmitir.
      if (bacheData && filtroData) {
        try {
          const initRes  = await fetch(`/api/export-produccion/${id}/init-log`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ bache: bacheData }),
          });
          const initText = await initRes.text();
          if (initText && initRes.ok) {
            const { logId, consecOpg } = JSON.parse(initText) as { logId: number; consecOpg: number };
            setLogId1(logId);
            setConsecOpg1(consecOpg);
            // Vista previa del XML1 disponible antes de transmitir
            const sinLote = new Set<string>(
              (filtroData.productosSinLote ?? "").split(",").map((s) => s.trim()).filter(Boolean)
            );
            const xml1Preview = buildXML1(filtroData, rowsOpg1Data, consecOpg, sinLote);
            setXmlsPreview({ xmlLotes: "", xml1: xml1Preview });
          }
        } catch { /* init-log falló; el log se creará durante la transmisión */ }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
      _cargando.delete(id);
    }
  }, [id]);

  const cargarResume = useCallback(async (bacheNum: number) => {
    const guard = `${id}:r:${bacheNum}`;
    if (_cargando.has(guard)) return;
    _cargando.add(guard);

    setBache(null);
    setRows([]);
    setRowsOpg1([]);
    setLoading(true);
    setError(null);
    setTransmitResult(null);
    setTransmitError(null);
    setLotesResult(null);
    setLotesProgreso(null);
    setXmlsPreview(null);
    setLogId1(null);
    setConsecOpg1(0);
    try {
      const res  = await fetch(`/api/export-produccion/${id}/resume-bache?bache=${bacheNum}`);
      const text = await res.text();
      if (!text) throw new Error("El servidor no devolvió respuesta");
      const data = JSON.parse(text);
      if (!res.ok) throw new Error(data.error ?? "Error al cargar el bache");

      const filtroData:   Filtro    = data.filtro;
      const rowsOpg1Data: RowOpg1[] = data.rowsOpg1 ?? [];

      setFiltro(filtroData);
      setBache(bacheNum);
      setRows(data.rows);
      setRowsOpg1(rowsOpg1Data);
      setLogId1(data.logId1);
      setConsecOpg1(data.consecOpg1);
      setIsResumeMode(true);

      type LogSnap = {
        id: number; numeroOpg: number;
        estadoOrdenProduccion: string; estadoConsumoProduccion: string; estadoEntregaProduccion: string;
        xml1: string; xml2: string; xml3: string;
      };
      const log1 = data.log1 as LogSnap;
      const log2 = data.log2 as LogSnap | null;
      const mkDoc = (estado: string): DocResult => ({
        exitoso: estado === "ENVIADO",
        errores: [],
        estado:  estado as EstadoDoc,
      });

      setTransmitResult({
        logId1:  data.logId1,
        logId2:  data.logId2  ?? null,
        opg1Num: log1.numeroOpg,
        opg2Num: log2?.numeroOpg ?? 0,
        ppItems: [],
        opg1: {
          orden:   mkDoc(log1.estadoOrdenProduccion),
          consumo: mkDoc(log1.estadoConsumoProduccion),
          entrega: mkDoc(log1.estadoEntregaProduccion),
        },
        opg2: {
          orden:   mkDoc(log2?.estadoOrdenProduccion   ?? "PENDIENTE"),
          consumo: mkDoc(log2?.estadoConsumoProduccion ?? "PENDIENTE"),
          entrega: mkDoc(log2?.estadoEntregaProduccion ?? "PENDIENTE"),
        },
        xmls: {
          xml1b:           log2?.xml1 ?? "",
          xml2b:           log2?.xml2 ?? "",
          xml3b:           log2?.xml3 ?? "",
          xml2:            log1.xml2  ?? "",
          xml3:            log1.xml3  ?? "",
          xmlLotesEpgOpg2: "",
        },
      });

      // Vista previa XML1
      const sinLote = new Set<string>(
        (filtroData.productosSinLote ?? "").split(",").map((s) => s.trim()).filter(Boolean)
      );
      setXmlsPreview({ xmlLotes: "", xml1: buildXML1(filtroData, rowsOpg1Data, data.consecOpg1, sinLote) });

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
      _cargando.delete(guard);
    }
  }, [id]);

  useEffect(() => {
    if (bacheParam) cargarResume(Number(bacheParam));
    else             cargarDatos();
  }, [cargarDatos, cargarResume, bacheParam]);

  const totalKil = rows.reduce((s, r) => s + Number(r.KIL), 0);
  const totalUnd = rows.reduce((s, r) => s + Number(r.UND), 0);

  const sinLoteSet  = new Set<string>(
    (filtro?.productosSinLote ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  );
  const xmlLotes    = filtro ? buildXMLLotes(rows, fechaYMD(filtro.fecha)) : "";
  const xml1        = filtro ? buildXML1(filtro, rowsOpg1, consecOpg1, sinLoteSet) : "";

  const transmitir = useCallback(async (esReintento = false) => {
    if (!bache || !filtro) return;
    if (esReintento) setRetrying(true);
    else {
      setTransmitting(true);
      setTransmitResult(null);
      setLotesResult(null);
      setLotesProgreso(null);
    }
    setTransmitError(null);

    try {
      // ── Paso 1: Crear/verificar lotes (OPG1 usa lote juliano) ───────────
      // Los lotes de PP00001/PP00002/PP00003 los gestiona el ERP al entregar OPG2 (EPG).
      // Los productos en productosSinLote se omiten de la creación de lotes.
      const loteJul = loteJuliano(fechaYMD(filtro.fecha));
      const sinLote = new Set<string>(
        (filtro.productosSinLote ?? "").split(",").map((s) => s.trim()).filter(Boolean)
      );
      const uniqueLotes: ProductoLote[] = Array.from(
        new Map(
          rowsOpg1
            .filter((r) => !sinLote.has(r.CODIGO_PRODUCTO.trim()))
            .map((r): [string, ProductoLote] => [
              r.CODIGO_PRODUCTO.trim(),
              { codigo: r.CODIGO_PRODUCTO.trim(), lote: loteJul },
            ])
        ).values()
      );

      let xmlLotesEnviado = "// Todos los lotes ya existían — no se envió XML";
      // En modo resume los lotes ya fueron enviados en la transmisión original
      if (!isResumeMode && uniqueLotes.length > 0) {
        const lotesRes = await fetch(`/api/export-produccion/${id}/lotes`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ productos: uniqueLotes, fecha: fechaYMD(filtro.fecha) }),
        });
        if (!lotesRes.ok && !lotesRes.headers.get("content-type")?.includes("ndjson")) {
          throw new Error(`Error al crear lotes (HTTP ${lotesRes.status})`);
        }
        const lotesData = await new Promise<LoteCreacionResult>((resolve, reject) => {
          leerLotesStream(lotesRes, {
            onStart:    (total) => setLotesProgreso({ completado: 0, total }),
            onProgress: (completado, total) => setLotesProgreso({ completado, total }),
            onDone:     (result) => resolve(result),
            onError:    (msg) => reject(new Error(msg)),
          });
        });
        if (lotesData.error) throw new Error(lotesData.error);
        setLotesProgreso(null);
        setLotesResult(lotesData);
        xmlLotesEnviado = lotesData.xmlLotes ?? xmlLotesEnviado;
      }

      // ── Paso 2: Usar consecOpg1 obtenido al marcar el bache ─────────────
      // Si init-log falló al cargar la página, obtener el consecutivo ahora.
      let nuevoConsec1 = consecOpg1;
      if (!nuevoConsec1) {
        const seqRes  = await fetch("/api/export-produccion/seq-opg", { method: "POST" });
        const seqText = await seqRes.text();
        if (!seqText) throw new Error("Sin respuesta al obtener SEQ_OPG");
        const seqData = JSON.parse(seqText);
        if (!seqRes.ok) throw new Error(seqData.error ?? "Error al obtener SEQ_OPG");
        nuevoConsec1 = seqData.consecOpg as number;
        setConsecOpg1(nuevoConsec1);
      }

      // ── Paso 3: Construir XMLs y actualizar preview ──────────────────────
      const xml1Final = buildXML1(filtro, rowsOpg1, nuevoConsec1, sinLote);
      // Actualizar solo el xmlLotes; el xml1 ya estaba en preview desde cargarDatos
      setXmlsPreview((prev) => ({
        xml1:     prev?.xml1 ?? xml1Final,
        xmlLotes: xmlLotesEnviado,
      }));

      const lotesPorProducto: Record<string, string> = {};
      rowsOpg1.forEach((r) => {
        const codigo = r.CODIGO_PRODUCTO.trim();
        // Los productos sin lote no llevan lote en el consumo (SPG OPG1)
        if (codigo && !sinLote.has(codigo)) lotesPorProducto[codigo] = loteJul;
      });

      const rowsParaXml3 = rows.map((r) => ({
        CODIGO_PRODUCTO: r.CODIGO_PRODUCTO,
        // f470_id_lote vacío para productos sin lote (entrega EPG OPG1)
        LOTE_PRODUCTO:   sinLote.has(r.CODIGO_PRODUCTO.trim()) ? "" : loteJul,
        BODEGA:          r.BODEGA,
        UNIDAD_PRODUCTO: r.UNIDAD_PRODUCTO,
        KIL:             Number(r.KIL),
        UND:             Number(r.UND),
      }));

      const res  = await fetch(`/api/export-produccion/${id}/transmit-beneficio`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          bache,
          consecOpg1:      nuevoConsec1,
          xml1:            xml1Final,
          lotesPorProducto,
          rows:            rowsParaXml3,
          logId1:          logId1              ?? undefined,
          logId2:          tr?.logId2          ?? undefined,
          prevConsecOpg2:  (tr?.opg2Num ?? 0) > 0 ? tr!.opg2Num : undefined,
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
  }, [id, bache, filtro, rows, rowsOpg1, consecOpg1, logId1, transmitResult, isResumeMode]);

  const tr = transmitResult;

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
            {filtro ? `Beneficio — ${filtro.nombre}` : "Beneficio"}
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

          {tr && (
            <div className="flex items-center gap-2">
              {tr.opg1Num > 0 && (
                <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold px-3 py-1.5 rounded-xl">
                  OPG1 #{tr.opg1Num}
                </div>
              )}
              {tr.opg2Num > 0 && (
                <div className="flex items-center gap-1.5 bg-orange-50 border border-orange-200 text-orange-700 text-xs font-semibold px-3 py-1.5 rounded-xl">
                  OPG2 #{tr.opg2Num}
                </div>
              )}
            </div>
          )}

          <button
            onClick={isResumeMode && bache ? () => cargarResume(bache) : cargarDatos}
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
              onClick={() => transmitir(isResumeMode)}
              disabled={transmitting || retrying || loading}
              className="flex items-center gap-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white px-4 py-2 rounded-xl transition-all shadow-sm"
            >
              {transmitting || retrying ? (
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
                  {isResumeMode ? "Continuar transmisión" : "Transmitir al ERP"}
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Errores */}
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

      {/* Progreso de creación de lotes */}
      {lotesProgreso && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
          <p className="text-sm font-semibold text-slate-700">Paso 1 — Registrando lotes en ERP…</p>
          <div className="flex items-center gap-3">
            <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
              <div
                className="h-2 rounded-full bg-[#f89520] transition-all duration-300"
                style={{ width: `${lotesProgreso.total > 0 ? Math.round((lotesProgreso.completado / lotesProgreso.total) * 100) : 0}%` }}
              />
            </div>
            <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
              {lotesProgreso.completado} / {lotesProgreso.total}
            </span>
          </div>
        </div>
      )}

      {/* Resultado lotes */}
      {lotesResult && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <p className="text-sm font-semibold text-slate-700">Paso 1 — Registro de lotes</p>
          <LotesResultPanel result={lotesResult} />
        </div>
      )}

      {/* Banner modo reanudación */}
      {isResumeMode && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3 rounded-xl">
          <svg className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            Modo de reanudación — bache <span className="font-mono font-semibold">#{bache}</span>.
            {" "}Los estados anteriores del proceso se muestran abajo.
            Presione <strong>Continuar transmisión</strong> para reanudar desde el paso donde se detuvo.
          </span>
        </div>
      )}

      {/* XMLs antes de enviar (visible mientras transmite y hasta que llega el resultado) */}
      {xmlsPreview && !tr && <XmlsPreview preview={xmlsPreview} />}

      {/* XMLs generados (tras transmisión exitosa o con error) */}
      {tr && (
        <XmlsGenerados
          preview={xmlsPreview}
          xmls={tr.xmls}
          opg1Num={tr.opg1Num}
          opg2Num={tr.opg2Num}
        />
      )}

      {/* Resultados transmisión */}
      {tr && (
        <div className="space-y-4">
          {/* OPG1 — producto principal */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 px-1">
              <div className="h-px flex-1 bg-rose-200" />
              <span className="text-xs font-semibold text-rose-500 uppercase tracking-wider px-2">
                Fase 2 · Producto principal
              </span>
              <div className="h-px flex-1 bg-rose-200" />
            </div>
            <OPGPanel
              titulo="OPG1 — Productos filtrados"
              num={tr.opg1Num}
              result={tr.opg1}
              accent="bg-rose-50 text-rose-600 border-rose-200"
              retrying={retrying}
              onReintentarOrden={
                !tr.opg1.orden.exitoso
                  ? () => transmitir(true) : undefined
              }
              onReintentarConsumo={
                !tr.opg1.consumo.exitoso && tr.opg1.orden.exitoso &&
                (tr.opg2Num === 0 || tr.opg2.entrega.exitoso) &&
                !tr.existenciaCheck
                  ? () => transmitir(true) : undefined
              }
              onReintentarEntrega={
                !tr.opg1.entrega.exitoso && tr.opg1.consumo.exitoso
                  ? () => transmitir(true) : undefined
              }
            />
            {/* Panel de existencias insuficientes — bloquea el SPG OPG1 */}
            {tr.existenciaCheck && !tr.existenciaCheck.suficiente && (
              <ExistenciaCheckPanel
                check={tr.existenciaCheck}
                onReverificar={() => transmitir(true)}
                loading={retrying}
              />
            )}
          </div>

          {/* OPG2 — subproductos PP */}
          {tr.opg2Num > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-1">
                <div className="h-px flex-1 bg-orange-200" />
                <span className="text-xs font-semibold text-orange-500 uppercase tracking-wider px-2">
                  Fase 1 · Subproductos PP ({tr.ppItems.map((p) => p.codigo).join(", ")})
                </span>
                <div className="h-px flex-1 bg-orange-200" />
              </div>
              <OPGPanel
                titulo="OPG2 — Subproductos"
                num={tr.opg2Num}
                result={tr.opg2}
                accent="bg-orange-50 text-orange-600 border-orange-200"
                retrying={retrying}
                onReintentarOrden={
                  !tr.opg2.orden.exitoso && tr.opg1.orden.exitoso
                    ? () => transmitir(true) : undefined
                }
                onReintentarConsumo={
                  !tr.opg2.consumo.exitoso && tr.opg2.orden.exitoso
                    ? () => transmitir(true) : undefined
                }
                onReintentarEntrega={
                  !tr.opg2.entrega.exitoso && tr.opg2.consumo.exitoso
                    ? () => transmitir(true) : undefined
                }
              />
            </div>
          )}
        </div>
      )}

      {/* Totales + XMLs */}
      {!loading && !error && (
        <>
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

        </>
      )}

      {/* Tabla de productos */}
      {(rows.length > 0 || loading) && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Código</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Descripción</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Bodega</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Lote</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">U/M</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Kilogramos</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Unidades</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Peso Promedio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        {Array.from({ length: 8 }).map((__, j) => (
                          <td key={j} className="px-5 py-4"><div className="h-4 bg-slate-100 rounded w-3/4" /></td>
                        ))}
                      </tr>
                    ))
                  : rows.map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3 font-mono text-xs text-slate-700">{row.CODIGO_PRODUCTO}</td>
                        <td className="px-5 py-3 text-slate-800 font-medium max-w-[200px] truncate">{row.DESCRIPCION_PRODUCTO}</td>
                        <td className="px-5 py-3 text-slate-600">{row.BODEGA || "—"}</td>
                        <td className="px-5 py-3 text-slate-600">{row.LOTE_PRODUCTO || "—"}</td>
                        <td className="px-5 py-3">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                            {row.UNIDAD_PRODUCTO}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right text-slate-700 font-medium tabular-nums">{fmtNum(Number(row.KIL))}</td>
                        <td className="px-5 py-3 text-right text-slate-700 font-medium tabular-nums">{fmtNum(Number(row.UND))}</td>
                        <td className="px-5 py-3 text-right text-slate-700 font-medium tabular-nums">
                          {fmtNum(Number(row.UND) !== 0 ? Number(row.KIL) / Number(row.UND) : 0)}
                        </td>
                      </tr>
                    ))}
              </tbody>
              {!loading && rows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td colSpan={5} className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Total</td>
                    <td className="px-5 py-3 text-right font-bold text-slate-800 tabular-nums">{fmtNum(totalKil)}</td>
                    <td className="px-5 py-3 text-right font-bold text-slate-800 tabular-nums">{fmtNum(totalUnd)}</td>
                    <td className="px-5 py-3 text-right font-bold text-slate-800 tabular-nums">
                      {fmtNum(totalUnd !== 0 ? totalKil / totalUnd : 0)}
                    </td>
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
