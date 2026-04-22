"use client";
// src/app/dashboard/export-produccion/beneficio/[id]/page.tsx
// Proceso Beneficio (dos OPGs en cascada):
//   OPG1: OP con productos filtrados → consulta componentes → suma PP00001/PP00002/PP00003
//   OPG2: OP para los PP sumados → SPG (consumo OPG2) → EPG (entrega PP)
//   SPG OPG1: consumo con todos los componentes de OPG1
//   EPG OPG1: entrega de los productos filtrados
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

interface OPGResult {
  orden:   DocResult;
  consumo: DocResult;
  entrega: DocResult;
}

interface PpItem { codigo: string; cantidad: number; unidad: string; lote: string; }

interface TransmitResult {
  logId1:   number;
  logId2:   number | null;
  opg1Num:  number;
  opg2Num:  number;
  ppItems:  PpItem[];
  opg1:     OPGResult;
  opg2:     OPGResult;
  xmls: {
    xml1b: string;
    xml2b: string;
    xml3b: string;
    xml2:  string;
    xml3:  string;
  };
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

// ── Utilidades ────────────────────────────────────────────────────────────
const pN = (val: string | number | null | undefined, len: number) =>
  String(Math.floor(Number(val) || 0)).padStart(len, "0").slice(-len);

const pA = (val: string | null | undefined, len: number) =>
  (val ?? "").slice(0, len).padEnd(len, " ");

function fechaYMD(raw: string): string {
  return raw.split("T")[0].replace(/-/g, "");
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

// ── XML1 — OPG1 (mismo que Salida Desprese, clase_op=002) ─────────────────
function buildXML1(filtro: Filtro, rows: ProductRow[], consecOpg: number): string {
  const fecha   = fechaYMD(filtro.fecha);
  const opening = "000000100000001001";

  const header =
    pN(2,   7) + pN(850, 4) + pN(0, 2) + pN(1, 2) + pN(1, 3) + pN(0, 1) +
    pA(filtro.centroOperacion,     3) +
    pA("OPG",                      3) +
    pN(consecOpg, 8) +
    pA(fecha,                      8) +
    pN(1,   1) + pN(0, 1) + pN(701, 3) +
    pA(filtro.terceroPlanificador, 15) +
    pA("OPG",                      3) +
    pN(1,   8) +
    pA(filtro.instalacion,         3) +
    pA("002",                      3) +
    pA("",                        30) + pA("", 30) + pA("", 30) +
    pA(filtro.nombre,           2000) +
    pA("",                         3) + pA("", 3) +
    pN(0,   8);

  const productLines = rows.map((row, i) => {
    const bodega = pA(filtro.bodegaItemPadre ?? row.BODEGA, 5);
    return (
      pN(i + 3,  7) + pN(851, 4) + pN(0, 2) + pN(1, 2) + pN(1, 3) +
      pA(filtro.centroOperacion,  3) +
      pA("OPG",                   3) +
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
      pA("",                      4) +
      pA(row.LOTE_PRODUCTO,      15) +
      pA("",                   2000) +
      bodega
    );
  });

  const closing = pN(rows.length + 3, 7) + "9999" + "00" + "01" + "001";
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
      {result.exitoso && result.nuevos.length > 0 && <p className="text-xs text-emerald-700">Lotes creados exitosamente en ERP.</p>}
    </div>
  );
}

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
  const [bache, setBache]     = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const [consecOpg1, setConsecOpg1]         = useState<number>(0);
  const [transmitting, setTransmitting]     = useState(false);
  const [transmitResult, setTransmitResult] = useState<TransmitResult | null>(null);
  const [transmitError, setTransmitError]   = useState<string | null>(null);
  const [retrying, setRetrying]             = useState(false);
  const [lotesResult, setLotesResult]       = useState<LoteCreacionResult | null>(null);

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
  const xml1        = filtro ? buildXML1(filtro, rows, consecOpg1) : "";

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
      // ── Paso 1: Crear/verificar lotes ────────────────────────────────────
      // Solo se pre-crean los lotes de los productos reales de las filas.
      // Los lotes de PP00001/PP00002/PP00003 los gestiona el ERP al entregar OPG2 (EPG).
      const uniqueLotes: ProductoLote[] = Array.from(
        new Map(
          rows
            .filter((r) => r.LOTE_PRODUCTO?.trim())
            .map((r): [string, ProductoLote] => [
              `${r.CODIGO_PRODUCTO}|${r.LOTE_PRODUCTO}`,
              { codigo: r.CODIGO_PRODUCTO, lote: r.LOTE_PRODUCTO },
            ])
        ).values()
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
        // En Beneficio no se detiene el proceso si los lotes fallan:
        // pueden ya existir en el ERP aunque no estén en nuestra DB.
      }

      // ── Paso 2: Obtener consecutivo OPG1 ────────────────────────────────
      const seqRes  = await fetch("/api/export-produccion/seq-opg", { method: "POST" });
      const seqText = await seqRes.text();
      if (!seqText) throw new Error("Sin respuesta al obtener SEQ_OPG");
      const seqData = JSON.parse(seqText);
      if (!seqRes.ok) throw new Error(seqData.error ?? "Error al obtener SEQ_OPG");
      const nuevoConsec1: number = seqData.consecOpg;
      setConsecOpg1(nuevoConsec1);

      // ── Paso 3: Transmitir ────────────────────────────────────────────────
      const xml1Final = buildXML1(filtro, rows, nuevoConsec1);

      const lotesPorProducto: Record<string, string> = {};
      rows.forEach((r) => {
        const codigo = r.CODIGO_PRODUCTO.trim();
        const lote   = r.LOTE_PRODUCTO?.trim() ?? "";
        if (codigo) lotesPorProducto[codigo] = lote;
      });

      const rowsParaXml3 = rows.map((r) => ({
        CODIGO_PRODUCTO: r.CODIGO_PRODUCTO,
        LOTE_PRODUCTO:   r.LOTE_PRODUCTO ?? "",
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
  }, [id, bache, filtro, rows]);

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
              disabled={transmitting || retrying || loading}
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

      {/* Resultado lotes */}
      {lotesResult && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <p className="text-sm font-semibold text-slate-700">Paso 1 — Registro de lotes</p>
          <LotesResultPanel result={lotesResult} />
        </div>
      )}

      {/* Resultados transmisión */}
      {tr && (
        <div className="space-y-4">
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
                (tr.opg2Num === 0 || tr.opg2.entrega.exitoso)
                  ? () => transmitir(true) : undefined
              }
              onReintentarEntrega={
                !tr.opg1.entrega.exitoso && tr.opg1.consumo.exitoso
                  ? () => transmitir(true) : undefined
              }
            />
          </div>
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

          {/* XMLs OPG1 */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-rose-500 uppercase tracking-wider px-1">OPG1 — Productos filtrados</p>
            <XmlBlock title="XML Lotes — Tipo 403"                    content={xmlLotes} />
            <XmlBlock title="XML 1 — OPG1 Orden de Producción"        content={xml1} />
            <XmlBlock title="XML 2 — OPG1 Consumo SPG"                content={tr?.xmls.xml2  || "// Se genera al transmitir"} />
            <XmlBlock title="XML 3 — OPG1 Entrega EPG"                content={tr?.xmls.xml3  || "// Se genera al transmitir"} />
          </div>

          {/* XMLs OPG2 (solo si ya hay resultado) */}
          {tr && tr.opg2Num > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-orange-500 uppercase tracking-wider px-1">OPG2 — Subproductos PP</p>
              <XmlBlock title="XML 1b — OPG2 Orden de Producción (PP)" content={tr.xmls.xml1b} />
              <XmlBlock title="XML 2b — OPG2 Consumo SPG"              content={tr.xmls.xml2b} />
              <XmlBlock title="XML 3b — OPG2 Entrega EPG (PP)"         content={tr.xmls.xml3b} />
            </div>
          )}
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
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        {Array.from({ length: 7 }).map((__, j) => (
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
                      </tr>
                    ))}
              </tbody>
              {!loading && rows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td colSpan={5} className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase">Total</td>
                    <td className="px-5 py-3 text-right font-bold text-slate-800 tabular-nums">{fmtNum(totalKil)}</td>
                    <td className="px-5 py-3 text-right font-bold text-slate-800 tabular-nums">{fmtNum(totalUnd)}</td>
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
