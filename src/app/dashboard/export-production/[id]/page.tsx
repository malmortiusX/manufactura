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
  logId:    number;
  numeroOpg: number;
  orden:   DocResult;
  consumo: DocResult;
  entrega: DocResult;
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

// ── Generador XML 1 ────────────────────────────────────────────────────────
function buildXML1(filtro: Filtro, rows: ProductRow[], consecOpg: number): string {
  const fecha = fechaYMD(filtro.fecha);
  const opening = "000000100000001001";

  // Longitudes: 7+4+2+2+3+1+3+3+8+8+1+1+3+15+3+8+3+3+30+30+30+2000+3+3+8 = 2182
  const header =
    pN(2,   7) +                             // F_NUMERO-REG          = 2
    pN(850, 4) +                             // F_TIPO-REG            = 850
    pN(0,   2) +                             // F_SUBTIPO-REG         = 00
    pN(1,   2) +                             // F_VERSION-REG         = 01
    pN(1,   3) +                             // F_CIA                 = 1
    pN(0,   1) +                             // F_CONSEC_AUTO_REG     = 0 (manual)
    pA(filtro.centroOperacion,    3) +       // f850_id_co
    pA("OPG",                     3) +       // f850_id_tipo_docto    = OPG
    pN(consecOpg, 8) +                       // f850_consec_docto     (SEQ_OPG)
    pA(fecha,                     8) +       // f850_fecha            YYYYMMDD
    pN(1,   1) +                             // f850_ind_estado       = 1
    pN(0,   1) +                             // f850_ind_impresion    = 0
    pN(701, 3) +                             // f850_id_clase_docto   = 701
    pA(filtro.terceroPlanificador, 15) +     // f850_tercero_planificador
    pA("OPG",                     3) +       // f850_id_tipo_docto_op_padre = OPG
    pN(1,   8) +                             // f850_consec_docto_op_padre  = 1
    pA(filtro.instalacion,        3) +       // f850_id_instalacion
    pA("002",                     3) +       // f850_clase_op         = 002
    pA("",                        30) +      // f850_referencia_1
    pA("",                        30) +      // f850_referencia_2
    pA("",                        30) +      // f850_referencia_3
    pA(filtro.nombre,             2000) +    // f850_notas
    pA("",                        3) +       // f850_id_co_pv
    pA("",                        3) +       // f850_id_tipo_docto_pv
    pN(0,   8);                              // f850_consec_docto_pv

  // Longitudes por línea de producto: 7+4+2+2+3+3+3+8+10+7+50+20+20+20+4+8+20+8+8+4+5+4+15+2000+5 = 2240
  const productLines = rows.map((row, i) => {
    const nroRegistro = i + 1;
    const bodega = pA(filtro.bodegaItemPadre ?? row.BODEGA, 5);
    return (
      pN(i + 3,  7) +                         // F_NUMERO-REG          (3, 4, 5…)
      pN(851,    4) +                         // F_TIPO-REG            = 851
      pN(0,      2) +                         // F_SUBTIPO-REG         = 00
      pN(1,      2) +                         // F_VERSION-REG         = 01
      pN(1,      3) +                         // F_CIA                 = 1
      pA(filtro.centroOperacion,  3) +        // f851_id_co
      pA("OPG",                   3) +        // f851_id_tipo_docto    = OPG
      pN(consecOpg, 8) +                      // f851_consec_docto     (SEQ_OPG)
      pN(nroRegistro,            10) +        // f851_nro_registro
      pN(0,      7) +                         // f851_id_item          (vacío)
      pA(row.CODIGO_PRODUCTO,    50) +        // f851_referencia_item
      pA("",                     20) +        // f851_codigo_barras
      pA("",                     20) +        // f851_id_ext1_detalle
      pA("",                     20) +        // f851_id_ext2_detalle
      pA(row.UNIDAD_PRODUCTO,     4) +        // f851_id_unidad_medida
      pN(100,    8) +                         // f851_porc_rendimiento = 100
      pQ(Number(row.KIL),        15, 4) +     // f851_cant_planeada_base (20 chars)
      pA(fecha,                   8) +        // f851_fecha_inicio
      pA(fecha,                   8) +        // f851_fecha_terminacion
      pA("0001",                  4) +        // f851_id_metodo_lista  = 0001
      bodega +                                // f851_id_bodega_componentes
      pA("",                      4) +        // f851_id_metodo_ruta
      pA(row.LOTE_PRODUCTO,      15) +        // f851_id_lote
      pA("",                   2000) +        // f851_notas
      bodega                                  // f851_id_bodega
    );
  });

  const closingNum = rows.length + 3;
  const closing = pN(closingNum, 7) + "9999" + "00" + "01" + "001";

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

// ── Badge de estado por documento ─────────────────────────────────────────
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
  label: string;
  result: DocResult;
  onReintentar?: () => void;
  retrying?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 space-y-3 ${
      result.estado === "ENVIADO"  ? "border-emerald-200 bg-emerald-50" :
      result.estado === "ERROR"    ? "border-red-200 bg-red-50" :
                                     "border-slate-200 bg-slate-50"
    }`}>
      {/* Cabecera */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        <EstadoBadge estado={result.estado} />
      </div>

      {/* Éxito */}
      {result.exitoso && (
        <p className="text-xs text-emerald-700 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Documento creado exitosamente en ERP
        </p>
      )}

      {/* Errores parseados del diffgram */}
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
              {e.detalle && (
                <p className="text-xs text-red-800 font-medium">{e.detalle}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Fallback: error sin errores parseados — muestra respuesta cruda */}
      {result.estado === "ERROR" && !result.exitoso && result.errores.length === 0 && (
        <details className="group">
          <summary className="text-xs text-red-600 font-medium cursor-pointer select-none list-none flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Ver respuesta del ERP
          </summary>
          <pre className="mt-2 text-[10px] text-slate-500 font-mono whitespace-pre-wrap break-all bg-white border border-red-100 rounded-lg p-2 max-h-48 overflow-y-auto">
            {result.respuestaRaw || "Sin respuesta"}
          </pre>
        </details>
      )}

      {/* Pendiente (no se envió porque un documento anterior falló) */}
      {result.estado === "PENDIENTE" && !result.exitoso && result.errores.length === 0 && (
        <p className="text-xs text-slate-500">
          No se envió — depende de que el documento anterior sea exitoso.
        </p>
      )}

      {/* Botón reintentar — visible siempre que hay error y hay handler */}
      {result.estado === "ERROR" && onReintentar && (
        <button
          onClick={onReintentar}
          disabled={retrying}
          className="flex items-center gap-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:bg-red-300 px-3 py-1.5 rounded-lg transition-colors"
        >
          {retrying ? (
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          Reintentar transmisión
        </button>
      )}
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────
const fmtNum = (n: number) =>
  new Intl.NumberFormat("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default function ExportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

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

  const marcarLote = useCallback(async () => {
    setLoading(true);
    setError(null);
    setTransmitResult(null);
    setTransmitError(null);
    try {
      const res  = await fetch(`/api/export-produccion/${id}/results`, { method: "POST" });
      const text = await res.text();
      if (!text) throw new Error("El servidor no devolvió respuesta");
      const data = JSON.parse(text);
      if (!res.ok) throw new Error(data.error ?? "Error al marcar lote");
      setFiltro(data.filtro);
      setBache(data.bache);
      setRows(data.rows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { marcarLote(); }, [marcarLote]);

  const totalKil = rows.reduce((s, r) => s + Number(r.KIL), 0);
  const totalUnd = rows.reduce((s, r) => s + Number(r.UND), 0);

  const xml1 = filtro ? buildXML1(filtro, rows, consecOpg) : "";
  const xml2 = "// Pendiente de definición";
  const xml3 = "// Pendiente de definición";

  const transmitir = useCallback(async (esReintento = false) => {
    if (!bache || !filtro) return;
    if (esReintento) setRetrying(true);
    else { setTransmitting(true); setTransmitResult(null); }
    setTransmitError(null);
    try {
      // 1. Obtener el siguiente consecutivo de SEQ_OPG
      const seqRes  = await fetch("/api/export-produccion/seq-opg", { method: "POST" });
      const seqText = await seqRes.text();
      if (!seqText) throw new Error("Sin respuesta al obtener SEQ_OPG");
      const seqData = JSON.parse(seqText);
      if (!seqRes.ok) throw new Error(seqData.error ?? "Error al obtener SEQ_OPG");
      const nuevoConsec: number = seqData.consecOpg;
      setConsecOpg(nuevoConsec);

      // 2. Construir XML con el consecutivo real
      const xml1Final = buildXML1(filtro, rows, nuevoConsec);

      // 3. Transmitir al ERP
      const res  = await fetch(`/api/export-produccion/${id}/transmit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bache, consecOpg: nuevoConsec, xml1: xml1Final, xml2, xml3 }),
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
  }, [id, bache, filtro, rows, xml2, xml3]);

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
            {filtro ? `Exportar ${filtro.nombre}` : "Exportar Producción"}
          </h1>
          {filtro && (
            <p className="text-xs text-slate-400 mt-0.5">
              {new Date(filtro.fecha.split("T")[0] + "T00:00:00").toLocaleDateString("es-CO")}
              {filtro.tipoDocumento && <> · Tipo Doc: <span className="font-medium">{filtro.tipoDocumento}</span></>}
              {filtro.tipoMovimiento && <> · Tipo Mov: <span className="font-medium">{filtro.tipoMovimiento}</span></>}
            </p>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* Badge de lote */}
          {bache !== null && (
            <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold px-3 py-1.5 rounded-xl">
              <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
              </svg>
              Lote {bache}
            </div>
          )}

          {/* Badge consecutivo OPG */}
          {consecOpg > 0 && (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-xl">
              <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              OPG #{consecOpg}
            </div>
          )}

          {/* Actualizar */}
          <button
            onClick={marcarLote}
            disabled={loading || transmitting}
            className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-700 hover:bg-white border border-transparent hover:border-slate-200 px-3 py-2 rounded-xl transition-all disabled:opacity-40"
          >
            <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Actualizar
          </button>

          {/* Transmitir al ERP */}
          {!loading && rows.length > 0 && (
            <button
              onClick={transmitir}
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

      {/* Error de carga */}
      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {error}
        </div>
      )}

      {/* Error de transmisión */}
      {transmitError && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {transmitError}
        </div>
      )}

      {/* Resultado de transmisión */}
      {transmitResult && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          {/* Cabecera del panel */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-700">Resultado de transmisión</span>
              <span className="text-xs font-semibold bg-indigo-50 text-indigo-600 border border-indigo-200 px-2 py-0.5 rounded-full">
                OPG #{transmitResult.numeroOpg}
              </span>
            </div>
            {/* Resumen global */}
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

          {/* Documentos */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <DocResultPanel
              label="Orden de Producción"
              result={transmitResult.orden}
              onReintentar={!transmitResult.orden.exitoso ? () => transmitir(true) : undefined}
              retrying={retrying}
            />
            <DocResultPanel
              label="Consumo de Producción"
              result={transmitResult.consumo}
              onReintentar={!transmitResult.consumo.exitoso && transmitResult.orden.exitoso ? () => transmitir(true) : undefined}
              retrying={retrying}
            />
            <DocResultPanel
              label="Entrega de Producción"
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
          <XmlBlock title="XML 1 — Orden de Producción"   content={xml1} />
          <XmlBlock title="XML 2 — Consumo de Producción" content={xml2} />
          <XmlBlock title="XML 3 — Entrega de Producción" content={xml3} />
        </>
      )}

      {/* Tabla */}
      {(rows.length > 0 || loading) && (
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
