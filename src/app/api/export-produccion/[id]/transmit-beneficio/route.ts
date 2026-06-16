// src/app/api/export-produccion/[id]/transmit-beneficio/route.ts
// Proceso Beneficio — dos OPGs en cascada:
//
//  OPG1: Orden de producción con los productos filtrados (igual que Salida Desprese).
//  ↓ Consulta componentes de OPG1 → suma PP00001, PP00002, PP00003
//  OPG2: Orden de producción para los PP (subproductos) sumados.
//  ↓ Consulta componentes de OPG2 → SPG (consumo) de OPG2 → EPG (entrega) de PP
//  ↓ SPG (consumo) de OPG1 usando todos sus componentes
//  ↓ EPG (entrega) de OPG1 con los productos filtrados

import { NextResponse }                              from "next/server";
import { auth }                                      from "@/lib/auth";
import { prisma }                                    from "@/lib/prisma";
import { headers }                                   from "next/headers";
import {
  callSoap,
  queryComponentesOP,
  queryExistenciaLote,
  type DocResult,
  type ComponenteOP,
} from "@/lib/erp-soap";

export type { ErpError, DocResult } from "@/lib/erp-soap";

// ── Comparación de existencias por bodega + referencia + lote ────────────
interface ExistenciaComparacion {
  bodegaId:    string;
  referencia:  string;
  lote:        string;
  disponible1: number;
  disponible2: number;
  aConsumir1:  number;
  suficiente:  boolean;
}

// ── Utilidades de formato ──────────────────────────────────────────────────
const pN = (val: string | number | null | undefined, len: number) =>
  String(Math.floor(Number(val) || 0)).padStart(len, "0").slice(-len);

const pA = (val: string | null | undefined, len: number) =>
  (val ?? "").slice(0, len).padEnd(len, " ");

function pQ(val: number, intLen: number, dec: number): string {
  const factor  = Math.pow(10, dec);
  const rounded = Math.round(Number(val) * factor) / factor;
  const [intPart, decPart = ""] = rounded.toFixed(dec).split(".");
  return intPart.padStart(intLen, "0") + "." + decPart.padEnd(dec, "0");
}

// ── XML1b — Orden de Producción para PP (OPG2) ────────────────────────────
// Mismo formato que OPG1 (tipo 850/851, clase_op=002).
// Las líneas 851 son los PP00001/PP00002/PP00003 presentes en componentes de OPG1.
interface PpItem { codigo: string; cantidad: number; unidad: string; lote: string; }

function buildXML1b(
  centroOperacion:     string,
  nombre:              string,
  fecha:               string,
  consecOpg2:          number,
  ppItems:             PpItem[],
  terceroPlanificador: string,
  instalacion:         string,
  bodegaItemPadre:     string,
  tipoDoctoOrden:      string,
): string {
  const opening = "000000100000001001";

  const header =
    pN(2,   7) + pN(850, 4) + pN(0, 2) + pN(1, 2) + pN(1, 3) + pN(0, 1) +
    pA(centroOperacion,  3) +
    pA(tipoDoctoOrden,   3) +
    pN(consecOpg2,       8) +
    pA(fecha,            8) +
    pN(1,   1) + pN(0, 1) + pN(701, 3) +
    pA(terceroPlanificador, 15) +
    pA("",   3) +
    pN(0,   8) +
    pA(instalacion,      3) +
    pA("002",            3) +   // clase_op = 002
    pA("",                  30) +
    pA("",                  30) +
    pA("",                  30) +
    pA(nombre,            2000) +
    pA("",                   3) +
    pA("",                   3) +
    pN(0,   8);

  const bodega = pA(bodegaItemPadre, 5);

  const productLines = ppItems.map((item, i) =>
    pN(i + 3,  7) + pN(851, 4) + pN(0, 2) + pN(1, 2) + pN(1, 3) +
    pA(centroOperacion, 3) +
    pA(tipoDoctoOrden,  3) +
    pN(consecOpg2,      8) +
    pN(i + 1,          10) +
    pN(0,               7) +
    pA(item.codigo,    50) +
    pA("",                20) +
    pA("",                20) +
    pA("",                20) +
    pA(item.unidad,        4) +
    pN(100,                8) +
    pQ(item.cantidad,     15, 4) +
    pA(fecha,              8) +
    pA(fecha,              8) +
    pA("0001",             4) +
    pA("", 5) +
    pA("0001",                 4) +
    pA(item.lote,         15) +
    pA("",              2000) +
    bodega
  );

  const closingNum = ppItems.length + 3;
  const closing = pN(closingNum, 7) + "9999" + "00" + "01" + "001";
  return [opening, header, ...productLines, closing].join("\n");
}

// ── XML2 — Consumo de Producción SPG (tipo 450/470) ───────────────────────
function buildXML2(
  centroOperacion:  string,
  nombre:           string,
  fecha:            string,
  consecOpg:        number,
  componentes:      ComponenteOP[],
  lotesPorProducto: PpItem[],
  productoProceso:  string[],
  motivoConsumo:    string,
  ccostoMovto:      string,
  unNegocio:        string,
): string {
  const opening = "000000100000001001";

  const encabezado =
    pN(2,   7) + pN(450, 4) + pN(3, 2) + pN(1, 2) + pN(1, 3) + pN(1, 1) +
    pA(centroOperacion, 3) +
    pA("SCG",           3) +
    pN(1,   8) +
    pA(fecha,           8) +
    pN(1,   1) + pN(0, 1) + pN(710, 3) +
    pA("",  15) +
    pA(nombre,        255) +
    pA("01",  2) +
    pA("",   15) +
    pA("OPG", 3) +
    pN(consecOpg, 8);

  const y      = parseInt(fecha.slice(0, 4), 10);
  const m      = parseInt(fecha.slice(4, 6), 10);
  const d      = parseInt(fecha.slice(6, 8), 10);
  const dia    = Math.round((new Date(y, m - 1, d).getTime() - new Date(y, 0, 1).getTime()) / 86_400_000) + 1;
  const loteJul = String(dia).padStart(3, "0") + String(y).slice(-2);

  const productLines = componentes.map((comp, i) => {
    const esPp    = productoProceso.includes(comp.hijoReferencia.trim());
    const lotePad = esPp ? loteJul : "";
    return (
      pN(i + 3,  7) + pN(470, 4) + pN(0, 2) + pN(4, 2) + pN(1, 3) +
      pA(centroOperacion,       3) +
      pA("SCG",                 3) +
      pN(1,      8) +
      pN(i + 1, 10) +
      pN(0,      7) +
      pA(comp.padreReferencia, 50) +
      pA("",    20) + pA("",    20) + pA("",    20) +
      pN(0,     10) +
      pN(0,      7) +
      pA(comp.hijoReferencia,  50) +
      pA("",    20) + pA("",    20) + pA("",    20) +
      pA(comp.bodegaId,         5) +
      pA("",    10) +
      pA(lotePad,              15) +
      pN(701,    3) +
      pA(motivoConsumo,         2) +
      pA(centroOperacion,       3) +
      pA(unNegocio,            20) +
      pA(ccostoMovto,          15) +
      pA("",                   15) +
      pA(comp.hijoUnidad,       4) +
      pQ(comp.cantidadPendiente1, 15, 4) +
      pQ(comp.cantidadPendiente2,     15, 4) +
      pA("",   255) +
      pA("",  2000)
    );
  });

  const closingNum = componentes.length + 3;
  const closing = pN(closingNum, 7) + "9999" + "00" + "01" + "001";
  return [opening, encabezado, ...productLines, closing].join("\n");
}

// ── XML2ConLotes — SPG OPG1 con lotes explícitos (distribución FIFO) ────────
interface Xml2Line {
  padreReferencia: string;
  hijoReferencia:  string;
  bodegaId:        string;
  lote:            string;
  hijoUnidad:      string;
  cantidad1:       number;
  cantidad2:       number;
}

function buildXML2ConLotes(
  centroOperacion: string,
  nombre:          string,
  fecha:           string,
  consecOpg:       number,
  lineas:          Xml2Line[],
  motivoConsumo:   string,
  ccostoMovto:     string,
  unNegocio:       string,
): string {
  const opening = "000000100000001001";

  const encabezado =
    pN(2,   7) + pN(450, 4) + pN(3, 2) + pN(1, 2) + pN(1, 3) + pN(1, 1) +
    pA(centroOperacion, 3) +
    pA("SCG",           3) +
    pN(1,   8) +
    pA(fecha,           8) +
    pN(1,   1) + pN(0, 1) + pN(710, 3) +
    pA("",  15) +
    pA(nombre,        255) +
    pA("01",  2) +
    pA("",   15) +
    pA("OPG", 3) +
    pN(consecOpg, 8);

  const productLines = lineas.map((ln, i) =>
    pN(i + 3,  7) + pN(470, 4) + pN(0, 2) + pN(4, 2) + pN(1, 3) +
    pA(centroOperacion,       3) +
    pA("SCG",                 3) +
    pN(1,      8) +
    pN(i + 1, 10) +
    pN(0,      7) +
    pA(ln.padreReferencia,   50) +
    pA("",    20) + pA("",    20) + pA("",    20) +
    pN(0,     10) +
    pN(0,      7) +
    pA(ln.hijoReferencia,    50) +
    pA("",    20) + pA("",    20) + pA("",    20) +
    pA(ln.bodegaId,           5) +
    pA("",    10) +
    pA(ln.lote,              15) +
    pN(701,    3) +
    pA(motivoConsumo,         2) +
    pA(centroOperacion,       3) +
    pA(unNegocio,            20) +
    pA(ccostoMovto,          15) +
    pA("",                   15) +
    pA(ln.hijoUnidad,         4) +
    pQ(ln.cantidad1,         15, 4) +
    pQ(ln.cantidad2,         15, 4) +
    pA("",   255) +
    pA("",  2000)
  );

  const closingNum = lineas.length + 3;
  const closing = pN(closingNum, 7) + "9999" + "00" + "01" + "001";
  return [opening, encabezado, ...productLines, closing].join("\n");
}

// ── XML3 — Entrega de Producción EPG (tipo 450-01/470-02) ─────────────────
interface RowXml3 {
  CODIGO_PRODUCTO: string;
  LOTE_PRODUCTO:   string;
  BODEGA:          string;
  UNIDAD_PRODUCTO: string;
  KIL:             number;
  UND:             number;
}

function buildXML3(
  centroOperacion: string,
  nombre:          string,
  fecha:           string,
  consecOpg:       number,
  rows:            RowXml3[],
  bodegaItemPadre: string | null | undefined,
  motivoEntrega:   string,
  ccostoMovto:     string,
  unNegocio:       string,
): string {
  const opening = "000000100000001001";

  const encabezado =
    pN(2,    7) + pN(450, 4) + pN(1, 2) + 
    pN(2, 2) + // Version del tipo de registro F_VERSION-REG
    pN(1, 3) + pN(1, 1) +
    pA(centroOperacion,   3) +
    pA("EPG",             3) +
    pN(1,    8) +
    pA(fecha,             8) +
    pN(1,    1) + pN(0, 1) +
    pA(nombre,          255) +
    pN(720,  3) +
    pA("",   15) + pA("",   10) + pA("",   15) + pA("",    3) +
    pA("",   15) + pA("",   50) + pA("",   15) + pA("",   30) +
    pN(0,    15) +
    pQ(0,    15, 4) + pQ(0, 15, 4) + pQ(0, 15, 4) +
    pA("",  255) +
    pA("01",  2) +
    pA("",   15) +
    pA("70010101", 15);

  const productLines = rows.map((row, i) => {
    const bodega = pA((bodegaItemPadre ?? row.BODEGA)?.trim(), 5);
    return (
      pN(i + 3,  7) + pN(470, 4) + pN(2, 2) + pN(2, 2) + pN(1, 3) +
      pA(centroOperacion,      3) +
      pA("EPG",                3) +
      pN(1,      8) +
      pN(i + 1, 10) +
      pA("OPG",                3) +
      pN(consecOpg,            8) +
      pN(0,      7) +
      pA(row.CODIGO_PRODUCTO,  50) +
      pA("",    20) + pA("",    20) + pA("",    20) +
      pN(0,      7) +
      pA("",    50) + pA("",    20) + pA("",    20) + pA("",    20) +
      bodega +
      pA("",    10) +
      pA(row.LOTE_PRODUCTO,    15) +
      pN(701,    3) +
      pA(motivoEntrega, 2) +
      pA("", 2) +
      pA(centroOperacion,       3) +
      pA(unNegocio,            20) +
      pA(ccostoMovto,          15) +
      pA("",          15) +
      pQ(Number(row.KIL), 15, 4) +
      pQ(Number(row.UND), 15, 4) +
      pQ(0,     15, 4) + pQ(0, 15, 4) +
      pA("",   255) + pA("",  2000) +
      pA("",    40) +
      pA(row.UNIDAD_PRODUCTO,   4) +
      pN(0,     10)
    );
  });

  const closingNum = rows.length + 3;
  const closing = pN(closingNum, 7) + "9999" + "00" + "01" + "001";
  return [opening, encabezado, ...productLines, closing].join("\n");
}

// ── XML3b — Entrega OPG2 (EPG con reglas de PP) ───────────────────────────
// Diferencias respecto a buildXML3 (OPG1):
//   - El producto PP_CODIGOS va siempre primero.
//   - f470_referencia_item        → código del producto en proceso para OPG (ppCodigos[0])
//   - f470_referencia_item_otros  → código real del producto; vacío si es ppCodigos
//   - f_nro_reg_item_padre        → 0 si es ppCodigos, 1 para los demás
function buildXML3b(
  centroOperacion: string,
  nombre:          string,
  fecha:           string,
  consecOpg:       number,
  rows:            RowXml3[],
  bodegaItemPadre: string | null | undefined,
  ppCodigos:       string[],
  motivoEntrega:   string,
  ccostoMovto:     string,
  unNegocio:       string,
): string {
  const ppRef = ppCodigos[0] ?? "PP00002";   // código de referencia PP para todas las líneas

  // El producto en proceso para OPG debe ir siempre primero
  const rowsOrdenadas = [
    ...rows.filter((r) =>  ppCodigos.includes(r.CODIGO_PRODUCTO.trim())),
    ...rows.filter((r) => !ppCodigos.includes(r.CODIGO_PRODUCTO.trim())),
  ];

  const opening = "000000100000001001";

  const encabezado =
    pN(2,    7) + pN(450, 4) + pN(1, 2) + 
    pN(2, 2) + // Version del tipo de registro F_VERSION-REG
    pN(1, 3) + pN(1, 1) +
    pA(centroOperacion,   3) +
    pA("EPG",             3) +
    pN(1,    8) +
    pA(fecha,             8) +
    pN(1,    1) + pN(0, 1) +
    pA(nombre,          255) +
    pN(720,  3) +
    pA("",   15) + pA("",   10) + pA("",   15) + pA("",    3) +
    pA("",   15) + pA("",   50) + pA("",   15) + pA("",   30) +
    pN(0,    15) +
    pQ(0,    15, 4) + pQ(0, 15, 4) + pQ(0, 15, 4) +
    pA("",  255) +
    pA("01",  2) +
    pA("",   15) +
    pA("70010101", 15);

  const productLines = rowsOrdenadas.map((row, i) => {
    const bodega      = pA((bodegaItemPadre ?? row.BODEGA)?.trim(), 5);
    const esPpCodigo  = ppCodigos.includes(row.CODIGO_PRODUCTO.trim());
    const itemOtro    = esPpCodigo ? "" : row.CODIGO_PRODUCTO;  // f470_referencia_item_otros
    const nroRegPadre = esPpCodigo ? 0 : 1;                    // f_nro_reg_item_padre
    return (
      pN(i + 3,  7) + pN(470, 4) + pN(2, 2) + pN(2, 2) + pN(1, 3) +
      pA(centroOperacion,   3) +
      pA("EPG",             3) +
      pN(1,      8) +
      pN(i + 1, 10) +
      pA("OPG",             3) +
      pN(consecOpg,         8) +
      pN(0,      7) +
      pA(ppRef,            50) +                               // f470_referencia_item
      pA("",    20) + pA("",    20) + pA("",    20) +
      pN(0,      7) +
      pA(itemOtro,         50) +                               // f470_referencia_item_otros
      pA("",    20) + pA("",    20) + pA("",    20) +
      bodega +
      pA("",    10) +
      pA(row.LOTE_PRODUCTO,    15) +
      pN(701,    3) +
      pA(motivoEntrega, 2) +
      pA("", 2) +
      pA(centroOperacion,   3) +
      pA(unNegocio,        20) +
      pA(ccostoMovto,      15) +
      pA("",          15) +
      pQ(Number(row.KIL), 15, 4) +
      pQ(Number(row.UND), 15, 4) +
      pQ(0,     15, 4) + pQ(0, 15, 4) +
      pA("",   255) + pA("",  2000) +
      pA("",    40) +
      pA(row.UNIDAD_PRODUCTO,  4) +
      pN(nroRegPadre,      10)                                 // f_nro_reg_item_padre
    );
  });

  const closingNum = rowsOrdenadas.length + 3;
  const closing = pN(closingNum, 7) + "9999" + "00" + "01" + "001";
  return [opening, encabezado, ...productLines, closing].join("\n");
}

// ── XML Lotes (tipo 403) ──────────────────────────────────────────────────
function sumarDias(fechaYMD: string, dias: number): string {
  const y  = parseInt(fechaYMD.slice(0, 4), 10);
  const m  = parseInt(fechaYMD.slice(4, 6), 10) - 1;
  const d  = parseInt(fechaYMD.slice(6, 8), 10);
  const dt = new Date(y, m, d);
  dt.setDate(dt.getDate() + dias);
  return [
    String(dt.getFullYear()),
    String(dt.getMonth() + 1).padStart(2, "0"),
    String(dt.getDate()).padStart(2, "0"),
  ].join("");
}

interface ProductoLote { codigo: string; lote: string; }

function buildXMLLotes(productos: ProductoLote[], fechaYMD: string): string {
  const fechaVcto = sumarDias(fechaYMD, 30);
  const opening   = "000000100000001001";

  const lines = productos.map((p, i) =>
    pN(i + 2, 7) + pN(403, 4) + pN(0, 2) + pN(2, 2) + pN(1, 3) + pN(0, 1) +
    pA(p.lote,    15) +
    pN(0,          7) +
    pA(p.codigo,  50) +
    pA("",        20) + pA("",        20) + pA("",        20) +
    pA("",         3) +
    pN(1,          1) +
    pA(fechaYMD,   8) +
    pA(fechaVcto,  8) +
    pA("",        15) + pA("",        15) + pA("",         3) +
    pA("",        40) + pA("",        15) + pA("",         8) +
    pA("Creado por plano", 255)
  );

  const closing = pN(productos.length + 2, 7) + "9999" + "00" + "01" + "001";
  return [opening, ...lines, closing].join("\n");
}

// ── Envío individual de lotes (una petición SOAP por lote) ───────────────
// Enviar todos en un solo XML hace que si uno ya existe en ERP el batch entero
// falle. Enviando de a uno, un "ya existe" solo afecta ese lote.
const LOTE_YA_EXISTE_MSG = "el lote que desea adicionar ya existe";

async function enviarLotesIndividual(
  lotesNuevos: ProductoLote[],
  fecha: string,
): Promise<string> {
  const xmls: string[] = [];
  for (const lote of lotesNuevos) {
    const xml = buildXMLLotes([lote], fecha);
    xmls.push(xml);
    try {
      const result = await callSoap(xml);
      const yaExiste = result.errores.some((e) =>
        e.detalle.toLowerCase().includes(LOTE_YA_EXISTE_MSG)
      );
      if (result.exitoso || yaExiste) {
        await prisma.loteCreado.upsert({
          where:  { codigoProducto_lote: { codigoProducto: lote.codigo, lote: lote.lote } },
          create: { codigoProducto: lote.codigo, lote: lote.lote },
          update: {},
        });
      }
    } catch { /* continuar con el siguiente */ }
  }
  return xmls.join("\n\n");
}

// ── Consecutivo OPG desde Prisma (sin HTTP) ───────────────────────────────
async function nextConsecOpg(): Promise<number> {
  const rec = await prisma.consecutivo.upsert({
    where:  { tipoDocumento: "OPG" },
    create: { tipoDocumento: "OPG", consecutivo: 1 },
    update: { consecutivo: { increment: 1 } },
  });
  return rec.consecutivo;
}

const PENDIENTE: DocResult = { exitoso: false, printTipoError: -1, errores: [], respuestaRaw: "" };

// ── POST handler ───────────────────────────────────────────────────────────
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { id } = await params;
    const filtroId = Number(id);

    const filtro = await prisma.exportProduccion.findUnique({ where: { id: filtroId } });
    if (!filtro) return NextResponse.json({ error: "Filtro no encontrado" }, { status: 404 });

    // Productos en proceso que generan OPG2 — configurables desde el filtro
    const PP_CODIGOS = (filtro.ppCodigos ?? "PP00002")
      .split(",").map((s) => s.trim()).filter(Boolean);

    // Productos en proceso que llevan lote en el consumo (SPG) de OPG1
    const PP_CON_LOTE = (filtro.ppConLote ?? "PP00001,PP00002,PP00003,PP00004,PP00005")
      .split(",").map((s) => s.trim()).filter(Boolean);

    const body = await req.json() as {
      bache:            number;
      consecOpg1:       number;
      xml1:             string;
      lotesPorProducto: Record<string, string>;
      rows:             RowXml3[];
      logId1?:          number;
      logId2?:          number;   // ID log OPG2 ya creado en intento previo
      prevConsecOpg2?:  number;   // consecutivo OPG2 ya asignado en intento previo
    };
    const { bache, consecOpg1, xml1, lotesPorProducto = {}, rows = [], logId1,
            logId2: bodyLogId2, prevConsecOpg2 } = body;

    const ccostoConsumo    = filtro.ccostoConsumo?.trim()    ?? "";
    const ccostoEntrega    = filtro.ccostoEntrega?.trim()    ?? "";
    const unNegocioConsumo = filtro.unNegocioConsumo?.trim() ?? "";
    const unNegocioEntrega = filtro.unNegocioEntrega?.trim() ?? "";

    if (!bache)     return NextResponse.json({ error: "Falta el número de lote (bache)" },  { status: 400 });
    if (!consecOpg1) return NextResponse.json({ error: "Falta consecOpg1" }, { status: 400 });

    const fechaYMD = (raw: Date | string): string => {
      const s = typeof raw === "string" ? raw : raw.toISOString();
      return s.slice(0, 10).replace(/-/g, "");
    };
    const fecha = fechaYMD(filtro.fecha);
    const co    = filtro.centroOperacion?.trim() ?? "";
    const lote1 = rows[0]?.LOTE_PRODUCTO ?? "";

    // ── Crear o reutilizar log inicial OPG1 ───────────────────────────────
    // Si logId1 viene del cliente, el log ya fue creado al marcar el bache
    // con estados PENDIENTE. Solo se actualiza el xml1 y se incrementan intentos.
    let log1Id: number;
    if (logId1) {
      log1Id = logId1;
      await prisma.opgLog.update({
        where: { id: log1Id },
        data:  { xml1, intentos: { increment: 1 } },
      });
    } else {
      const log1 = await prisma.opgLog.create({
        data: {
          tipoDocumento:           "OPG",
          numeroOpg:               consecOpg1,
          numeroBache:             String(bache),
          filtroId,
          xml1,
          estadoOrdenProduccion:   "PENDIENTE",
          estadoConsumoProduccion: "PENDIENTE",
          estadoEntregaProduccion: "PENDIENTE",
        },
      });
      log1Id = log1.id;
    }

    // ── Cargar estados actuales de los logs para poder saltar pasos ya enviados ──
    // Esto permite que un reintento continúe desde el punto de fallo en lugar
    // de empezar desde cero y re-enviar documentos que ya están en el ERP.
    const log1State = await prisma.opgLog.findUnique({
      where:  { id: log1Id },
      select: {
        estadoOrdenProduccion:      true, estadoConsumoProduccion:      true, estadoEntregaProduccion:      true,
        respuestaOrdenProduccion:   true, respuestaConsumoProduccion:   true, respuestaEntregaProduccion:   true,
        xml2: true, xml3: true,
      },
    });
    const log2State = bodyLogId2 ? await prisma.opgLog.findUnique({
      where:  { id: bodyLogId2 },
      select: {
        estadoOrdenProduccion:      true, estadoConsumoProduccion:      true, estadoEntregaProduccion:      true,
        respuestaOrdenProduccion:   true, respuestaConsumoProduccion:   true, respuestaEntregaProduccion:   true,
        xml1: true, xml2: true, xml3: true,
      },
    }) : null;

    // Helper: resultado ficticio para un paso que ya fue enviado exitosamente
    const skip = (respuesta: string | null | undefined = ""): DocResult => ({
      exitoso: true, printTipoError: -1, errores: [], respuestaRaw: respuesta ?? "",
    });

    // Resultado de verificación de existencias OPG1 (solo cuando son insuficientes)
    let existenciaCheck: { items: ExistenciaComparacion[]; suficiente: boolean } | null = null;

    // Resultados
    let ordenOpg1Result:   DocResult = PENDIENTE;
    let ordenOpg2Result:   DocResult = PENDIENTE;
    let consumoOpg2Result: DocResult = PENDIENTE;
    let entregaOpg2Result: DocResult = PENDIENTE;
    let consumoOpg1Result: DocResult = PENDIENTE;
    let entregaOpg1Result: DocResult = PENDIENTE;

    // Inicializar desde el log previo cuando es un reintento
    let consecOpg2      = bodyLogId2 ? (prevConsecOpg2 ?? 0) : 0;
    let xml1b           = log2State?.xml1 ?? "";
    let xml2b           = log2State?.xml2 ?? "";
    let xml3b           = log2State?.xml3 ?? "";
    let xml2            = log1State?.xml2  ?? "";
    let xml3            = log1State?.xml3  ?? "";
    let xmlLotesEpgOpg2 = "";

    let opg1Componentes: ComponenteOP[] = [];
    let ppItems:         PpItem[]       = [];   // solo PP_CODIGOS → decide si crear OPG2
    let ppEntregaItems:  PpItem[]       = [];   // PP_CON_LOTE → van en EPG OPG2
    let log2Id = bodyLogId2 ?? 0;

    const mkErr = (e: unknown): DocResult =>
      ({ exitoso: false, printTipoError: -1, errores: [], respuestaRaw: String(e) });

    // ── Paso 1: Enviar XML1 → OPG1 (saltar si ya fue enviado) ────────────
    if (log1State?.estadoOrdenProduccion === "ENVIADO") {
      ordenOpg1Result = skip(log1State.respuestaOrdenProduccion);
    } else {
      try { ordenOpg1Result = await callSoap(xml1); }
      catch (e) { ordenOpg1Result = mkErr(e); }
    }

    if (ordenOpg1Result.exitoso) {

      // ── Paso 2: Consultar componentes de OPG1 + calcular ppItems ─────────
      try {
        opg1Componentes = await queryComponentesOP(co, "OPG", consecOpg1);

        // Sumar cantidades para PP_CODIGOS (trigger OPG2) y PP_CON_LOTE (entrega OPG2)
        const ppSums:         Record<string, { cantidad: number; unidad: string }> = {};
        const ppEntregaSums:  Record<string, { cantidad: number; unidad: string }> = {};

        for (const comp of opg1Componentes) {
          const codigo = comp.hijoReferencia.trim();
          if (PP_CODIGOS.includes(codigo)) {
            if (!ppSums[codigo]) ppSums[codigo] = { cantidad: 0, unidad: comp.hijoUnidad.trim() };
            ppSums[codigo].cantidad += comp.cantidadPendiente1;
          }
          if (PP_CON_LOTE.includes(codigo)) {
            if (!ppEntregaSums[codigo]) ppEntregaSums[codigo] = { cantidad: 0, unidad: comp.hijoUnidad.trim() };
            ppEntregaSums[codigo].cantidad += comp.cantidadPendiente1;
          }
        }

        ppItems        = Object.entries(ppSums).map(([codigo, { cantidad, unidad }]) => ({
          codigo, cantidad, unidad, lote: lote1,
        }));
        ppEntregaItems = Object.entries(ppEntregaSums).map(([codigo, { cantidad, unidad }]) => ({
          codigo, cantidad, unidad, lote: lote1,
        }));
      } catch {
        opg1Componentes = [];
        ppItems         = [];
        ppEntregaItems  = [];
      }

      // ── ¿Hay subproductos PP? → rama OPG2 ────────────────────────────────
      // Si no hay PP, se salta directamente a SPG/EPG de OPG1.
      let puedeOpg1Phase = ppItems.length === 0;   // true cuando no hay OPG2

      if (ppItems.length > 0 || (bodyLogId2 && prevConsecOpg2)) {

        // ── Paso 2b: Crear lotes PP (después de OPG1, antes de OPG2) ───────
        if (ppItems.length > 0) {
          try {
            const ppLotes: ProductoLote[] = ppItems.map((p) => ({ codigo: p.codigo, lote: p.lote }));
            const existentes = await prisma.loteCreado.findMany({
              where:  { OR: ppLotes.map((p) => ({ codigoProducto: p.codigo, lote: p.lote })) },
              select: { codigoProducto: true, lote: true },
            });
            const existenteSet = new Set(existentes.map((e) => `${e.codigoProducto}|${e.lote}`));
            const lotesNuevos  = ppLotes.filter((p) => !existenteSet.has(`${p.codigo}|${p.lote}`));
            if (lotesNuevos.length > 0) {
              await enviarLotesIndividual(lotesNuevos, fecha);
            }
          } catch { /* continuar aunque falle la creación de lotes PP */ }
        }

        // ── Paso 3: Construir y enviar XML1b → OPG2 ─────────────────────
        if (!bodyLogId2) {
          // Primera transmisión: asignar consecutivo y crear log OPG2
          consecOpg2 = await nextConsecOpg();
          xml1b = buildXML1b(
            co, filtro.nombre, fecha, consecOpg2, ppItems,
            filtro.terceroPlanificador?.trim() ?? "",
            filtro.instalacion?.trim()          ?? "",
            filtro.bodegaItemPadre?.trim()       ?? "",
            filtro.tipoDoctoOrden?.trim()        ?? "OPG",
          );
          const log2 = await prisma.opgLog.create({
            data: {
              tipoDocumento: "OPG", numeroOpg: consecOpg2,
              numeroBache: String(bache), filtroId, xml1: xml1b,
              estadoOrdenProduccion: "PENDIENTE", estadoConsumoProduccion: "PENDIENTE",
              estadoEntregaProduccion: "PENDIENTE",
            },
          });
          log2Id = log2.id;
        } else if (log2State?.estadoOrdenProduccion !== "ENVIADO" && ppItems.length > 0) {
          // Reintento: OPG2 existe pero su orden no fue enviada → reconstruir XML1b
          xml1b = buildXML1b(
            co, filtro.nombre, fecha, consecOpg2, ppItems,
            filtro.terceroPlanificador?.trim() ?? "",
            filtro.instalacion?.trim()          ?? "",
            filtro.bodegaItemPadre?.trim()       ?? "",
            filtro.tipoDoctoOrden?.trim()        ?? "OPG",
          );
          await prisma.opgLog.update({ where: { id: log2Id }, data: { xml1: xml1b } });
        }

        // Enviar orden OPG2 (o saltar si ya fue enviada)
        if (log2State?.estadoOrdenProduccion === "ENVIADO") {
          ordenOpg2Result = skip(log2State.respuestaOrdenProduccion);
        } else {
          try { ordenOpg2Result = await callSoap(xml1b); }
          catch (e) { ordenOpg2Result = mkErr(e); }
        }

        if (ordenOpg2Result.exitoso) {

          // ── Paso 4: SPG OPG2 (saltar si ya fue enviado) ───────────────
          if (log2State?.estadoConsumoProduccion === "ENVIADO") {
            consumoOpg2Result = skip(log2State.respuestaConsumoProduccion);
          } else {
            try {
              const opg2Componentes = await queryComponentesOP(co, "OPG", consecOpg2);
              xml2b = buildXML2(co, filtro.nombre, fecha, consecOpg2, opg2Componentes.filter((c) => c.cantidadPendiente1 > 0), {}, [], filtro.motivoConsumo?.trim() ?? "", ccostoConsumo, unNegocioConsumo);
              await prisma.opgLog.update({ where: { id: log2Id }, data: { xml2: xml2b } });
              consumoOpg2Result = await callSoap(xml2b);
            } catch (e) { consumoOpg2Result = mkErr(e); }
          }

          if (consumoOpg2Result.exitoso) {

            // ── Paso 5: Crear lotes PP antes de EPG OPG2 ────────────────
            const rowsPP: RowXml3[] = ppEntregaItems.map((p) => ({
              CODIGO_PRODUCTO: p.codigo, 
              LOTE_PRODUCTO: p.lote,
              BODEGA: filtro.bodegaItemPadre?.trim() ?? "",
              UNIDAD_PRODUCTO: p.unidad, 
              KIL: p.cantidad, 
              UND: 0,
            }));
            try {
              const ppEntregaLotes: ProductoLote[] = Array.from(
                new Map(
                  rowsPP
                    .filter((r) => r.LOTE_PRODUCTO?.trim())
                    .map((r) => [
                      `${r.CODIGO_PRODUCTO.trim()}|${r.LOTE_PRODUCTO.trim()}`,
                      { codigo: r.CODIGO_PRODUCTO.trim(), lote: r.LOTE_PRODUCTO.trim() },
                    ])
                ).values()
              );
              if (ppEntregaLotes.length > 0) {
                const existentes = await prisma.loteCreado.findMany({
                  where:  { OR: ppEntregaLotes.map((p) => ({ codigoProducto: p.codigo, lote: p.lote })) },
                  select: { codigoProducto: true, lote: true },
                });
                const existenteSet = new Set(existentes.map((e) => `${e.codigoProducto}|${e.lote}`));
                const lotesNuevos  = ppEntregaLotes.filter((p) => !existenteSet.has(`${p.codigo}|${p.lote}`));
                if (lotesNuevos.length > 0) {
                  xmlLotesEpgOpg2 = await enviarLotesIndividual(lotesNuevos, fecha);
                }
              }
            } catch { /* continuar aunque falle la creación de lotes */ }

            // ── Paso 5b: EPG OPG2 (saltar si ya fue enviado) ────────────
            if (log2State?.estadoEntregaProduccion === "ENVIADO") {
              entregaOpg2Result = skip(log2State.respuestaEntregaProduccion);
            } else {
              try {
                xml3b = buildXML3b(co, filtro.nombre, fecha, consecOpg2, rowsPP, filtro.bodegaItemPadre, PP_CODIGOS, filtro.motivoEntrega?.trim() ?? "", ccostoEntrega, unNegocioEntrega);
                await prisma.opgLog.update({ where: { id: log2Id }, data: { xml3: xml3b } });
                entregaOpg2Result = await callSoap(xml3b);
              } catch (e) { entregaOpg2Result = mkErr(e); }
            }

            // Solo si EPG OPG2 fue exitosa se puede continuar con OPG1
            if (entregaOpg2Result.exitoso) {
              puedeOpg1Phase = true;
            }
          }
        }
      }

      // ── Paso 5b: Crear lotes PP_CON_LOTE antes del consumo de OPG1 ──────
      if (puedeOpg1Phase) {
        try {
          const ppConLoteLotes: ProductoLote[] = PP_CON_LOTE.map((codigo) => ({ codigo, lote: lote1 }));
          const existentes = await prisma.loteCreado.findMany({
            where:  { OR: ppConLoteLotes.map((p) => ({ codigoProducto: p.codigo, lote: p.lote })) },
            select: { codigoProducto: true, lote: true },
          });
          const existenteSet = new Set(existentes.map((e) => `${e.codigoProducto}|${e.lote}`));
          const lotesNuevos  = ppConLoteLotes.filter((p) => !existenteSet.has(`${p.codigo}|${p.lote}`));
          if (lotesNuevos.length > 0) {
            await enviarLotesIndividual(lotesNuevos, fecha);
          }
        } catch { /* continuar aunque falle */ }
      }

      // ── Paso 6: SPG OPG1 ─────────────────────────────────────────────────
      // Depende de: EPG OPG2 exitosa (si había PP) o de OPG1 directamente (si no había PP)
      if (puedeOpg1Phase && opg1Componentes.length > 0) {
        // ── Paso 6: SPG OPG1 (saltar si ya fue enviado) ──────────────────
        if (log1State?.estadoConsumoProduccion === "ENVIADO") {
          consumoOpg1Result = skip(log1State.respuestaConsumoProduccion);
        } else {
          try {
            const componentes1ToConsume = opg1Componentes.filter((c) => c.cantidadPendiente1 > 0);

            // ── Verificar existencias OPG1 antes de consumir ──────────────
            let existenciasOk    = true;
            let lotesParaConsumo: Xml2Line[] | null = null;
            try {
              const existencias = await queryExistenciaLote(co, "OPG", consecOpg1);

              // Paso A: sumatoria de pendiente por (Bodega_id, Hijo_Referencia)
              type NeedEntry = { bodegaId: string; referencia: string; pendiente1: number; pendiente2: number };
              const needMap = new Map<string, NeedEntry>();
              for (const e of existencias) {
                const bId = e.bodegaId.trim();
                const ref = e.referencia.trim();
                const key = `${bId}\x00${ref}`;
                const prev = needMap.get(key);
                if (!prev) {
                  needMap.set(key, { bodegaId: bId, referencia: ref, pendiente1: e.pendiente1, pendiente2: e.pendiente2 });
                } else {
                  prev.pendiente1 += e.pendiente1;
                  prev.pendiente2 += e.pendiente2;
                }
              }

              // Paso B: stock por (Bodega_id, Hijo_Referencia, Lote) — deduplica
              type StockEntry = { bodegaId: string; referencia: string; lote: string; disponible1: number; disponible2: number };
              const stockMap = new Map<string, StockEntry>();
              for (const e of existencias) {
                const bId  = e.bodegaId.trim();
                const ref  = e.referencia.trim();
                const lote = e.lote.trim();
                const key  = `${bId}\x00${ref}\x00${lote}`;
                const prev = stockMap.get(key);
                if (!prev || e.disponible1 > prev.disponible1) {
                  stockMap.set(key, { bodegaId: bId, referencia: ref, lote, disponible1: e.disponible1, disponible2: e.disponible2 });
                }
              }

              // Paso C: total disponible por (Bodega_id, Hijo_Referencia)
              const availMap = new Map<string, number>();
              for (const pos of stockMap.values()) {
                const key = `${pos.bodegaId}\x00${pos.referencia}`;
                availMap.set(key, (availMap.get(key) ?? 0) + pos.disponible1);
              }

              // Paso D: items de comparación — uno por (Bodega_id, Referencia)
              // Se agrega el disponible total de todos los lotes para que el usuario
              // vea claramente cuánto hay vs cuánto se necesita consumir.
              // Se redondea a 4 decimales para evitar falsos negativos por punto flotante.
              const r4 = (n: number) => Math.round(n * 10000) / 10000;
              const items: ExistenciaComparacion[] = [];
              for (const [needKey, need] of needMap.entries()) {
                const totalDisp = availMap.get(needKey) ?? 0;
                items.push({
                  bodegaId:    need.bodegaId,
                  referencia:  need.referencia,
                  lote:        "",
                  disponible1: totalDisp,
                  disponible2: 0,
                  aConsumir1:  need.pendiente1,
                  suficiente:  r4(totalDisp) >= r4(need.pendiente1),
                });
              }

              const todoSuficiente = items.every((i) => i.suficiente);
              if (!todoSuficiente) {
                existenciaCheck = { items, suficiente: false };
                existenciasOk   = false;
              } else {
                // ── Distribuir el consumo FIFO por lotes ──────────────────
                // Stock mutable por (bodegaId\x00referencia\x00lote).
                // Se comparte entre todos los padres que consumen el mismo hijo,
                // de modo que cada padre ve el remanente que dejaron los anteriores.
                type StockPos = { lote: string; remaining: number };
                const stockMutable = new Map<string, StockPos[]>();
                for (const pos of stockMap.values()) {
                  const key = `${pos.bodegaId}\x00${pos.referencia}`;
                  const arr = stockMutable.get(key) ?? [];
                  arr.push({ lote: pos.lote, remaining: pos.disponible1 });
                  stockMutable.set(key, arr);
                }
                // Ordenar FIFO: lote vacío primero (sin lote), luego por código de lote
                for (const arr of stockMutable.values()) {
                  arr.sort((a, b) => {
                    if (a.lote === "" && b.lote !== "") return -1;
                    if (a.lote !== "" && b.lote === "") return  1;
                    return a.lote.localeCompare(b.lote);
                  });
                }

                const lineas: Xml2Line[] = [];

                // Iterar componentes directamente para conservar la relación padre-hijo
                for (const comp of componentes1ToConsume) {
                  const padre  = comp.padreReferencia.trim();
                  const hijo   = comp.hijoReferencia.trim();
                  const bodega = comp.bodegaId.trim();
                  const unidad = comp.hijoUnidad.trim();
                  const key    = `${bodega}\x00${hijo}`;

                  const positions = stockMutable.get(key);

                  // Producto sin información de lotes en el WS → línea simple
                  if (!positions || positions.every(p => p.lote === "")) {
                    lineas.push({
                      padreReferencia: padre,
                      hijoReferencia:  hijo,
                      bodegaId:        bodega,
                      lote:            "",
                      hijoUnidad:      unidad,
                      cantidad1:       comp.cantidadPendiente1,
                      cantidad2:       comp.cantidadPendiente2,
                    });
                    continue;
                  }

                  // Producto con lotes → distribuir FIFO consumiendo stock global
                  let rem1       = comp.cantidadPendiente1;
                  const total1   = comp.cantidadPendiente1;
                  for (const pos of positions) {
                    if (rem1 <= 0.00001) break;
                    if (pos.remaining <= 0.00001) continue;
                    const take1 = Math.min(pos.remaining, rem1);
                    const take2 = total1 > 0 && comp.cantidadPendiente2 > 0
                      ? Math.round((comp.cantidadPendiente2 * (take1 / total1)) * 10000) / 10000
                      : 0;
                    lineas.push({
                      padreReferencia: padre,
                      hijoReferencia:  hijo,
                      bodegaId:        bodega,
                      lote:            pos.lote,
                      hijoUnidad:      unidad,
                      cantidad1:       take1,
                      cantidad2:       take2,
                    });
                    pos.remaining -= take1;
                    rem1          -= take1;
                  }
                }

                lotesParaConsumo = lineas;
              }
            } catch { /* si falla la consulta, continuar con el SPG de todas formas */ }

            if (existenciasOk) {
              if (lotesParaConsumo && lotesParaConsumo.length > 0) {
                xml2 = buildXML2ConLotes(co, filtro.nombre, fecha, consecOpg1, lotesParaConsumo, filtro.motivoConsumo?.trim() ?? "", ccostoConsumo, unNegocioConsumo);
                // throw new Error("Parardo para revisión de lotes en consumo OPG1"); // No enviar aún, esperar validación del usuario
              } else {
                xml2 = buildXML2(co, filtro.nombre, fecha, consecOpg1, componentes1ToConsume, ppEntregaItems, PP_CON_LOTE, filtro.motivoConsumo?.trim() ?? "", ccostoConsumo, unNegocioConsumo);
                // throw new Error("Parardo para revisión de lotes en consumo OPG1"); // No enviar aún, esperar validación del usuario

              }
              await prisma.opgLog.update({ where: { id: log1Id }, data: { xml2 } });
              consumoOpg1Result = await callSoap(xml2);
            }
          } catch (e) { consumoOpg1Result = mkErr(e); }
        }

        // ── Paso 7: Crear lotes de productos entrega antes de EPG OPG1 ──────
        if (consumoOpg1Result.exitoso) {
          try {
            const entregaLotes: ProductoLote[] = Array.from(
              new Map(
                rows
                  .filter((r) => r.LOTE_PRODUCTO?.trim())
                  .map((r) => [
                    `${r.CODIGO_PRODUCTO.trim()}|${r.LOTE_PRODUCTO.trim()}`,
                    { codigo: r.CODIGO_PRODUCTO.trim(), lote: r.LOTE_PRODUCTO.trim() },
                  ])
              ).values()
            );
            if (entregaLotes.length > 0) {
              const existentes = await prisma.loteCreado.findMany({
                where:  { OR: entregaLotes.map((p) => ({ codigoProducto: p.codigo, lote: p.lote })) },
                select: { codigoProducto: true, lote: true },
              });
              const existenteSet = new Set(existentes.map((e) => `${e.codigoProducto}|${e.lote}`));
              const lotesNuevos  = entregaLotes.filter((p) => !existenteSet.has(`${p.codigo}|${p.lote}`));
              if (lotesNuevos.length > 0) {
                await enviarLotesIndividual(lotesNuevos, fecha);
              }
            }
          } catch { /* continuar aunque falle la creación de lotes */ }

          // ── Paso 8: EPG OPG1 (saltar si ya fue enviado) ─────────────────
          if (log1State?.estadoEntregaProduccion === "ENVIADO") {
            entregaOpg1Result = skip(log1State.respuestaEntregaProduccion);
          } else {
            try {
              const sinCantAdicional = new Set(
                (filtro.productosSinCantAdicional ?? "")
                  .split(",").map((s) => s.trim()).filter(Boolean)
              );
              const rowsEpg1 = rows.map((r) =>
                sinCantAdicional.has(r.CODIGO_PRODUCTO.trim())
                  ? { ...r, UND: 0 }
                  : r
              );
              xml3 = buildXML3(co, filtro.nombre, fecha, consecOpg1, rowsEpg1, filtro.bodegaItemPadre, filtro.motivoEntrega?.trim() ?? "", ccostoEntrega, unNegocioEntrega);
              await prisma.opgLog.update({ where: { id: log1Id }, data: { xml3 } });
              entregaOpg1Result = await callSoap(xml3);
            } catch (e) { entregaOpg1Result = mkErr(e); }
          }
        }
      }

    }

    // ── Actualizar logs ────────────────────────────────────────────────────
    const mkEstado = (r: DocResult, depOk: boolean): string =>
      r.exitoso ? "ENVIADO" : (r.printTipoError === -1 && !depOk ? "PENDIENTE" : "ERROR");

    await prisma.opgLog.update({
      where: { id: log1Id },
      data: {
        xml2,
        xml3,
        estadoOrdenProduccion:      mkEstado(ordenOpg1Result,   true),
        estadoConsumoProduccion:    mkEstado(consumoOpg1Result,  ordenOpg1Result.exitoso),
        estadoEntregaProduccion:    mkEstado(entregaOpg1Result,  consumoOpg1Result.exitoso),
        respuestaOrdenProduccion:   ordenOpg1Result.respuestaRaw,
        respuestaConsumoProduccion: consumoOpg1Result.respuestaRaw,
        respuestaEntregaProduccion: entregaOpg1Result.respuestaRaw,
        intentos: { increment: 1 },
      },
    });

    if (log2Id) {
      await prisma.opgLog.update({
        where: { id: log2Id },
        data: {
          xml2: xml2b,
          xml3: xml3b,
          estadoOrdenProduccion:      mkEstado(ordenOpg2Result,   true),
          estadoConsumoProduccion:    mkEstado(consumoOpg2Result,  ordenOpg2Result.exitoso),
          estadoEntregaProduccion:    mkEstado(entregaOpg2Result,  consumoOpg2Result.exitoso),
          respuestaOrdenProduccion:   ordenOpg2Result.respuestaRaw,
          respuestaConsumoProduccion: consumoOpg2Result.respuestaRaw,
          respuestaEntregaProduccion: entregaOpg2Result.respuestaRaw,
          intentos: { increment: 1 },
        },
      });
    }

    const toDocResult = (r: DocResult, depOk: boolean) => ({
      exitoso:      r.exitoso,
      errores:      r.errores,
      estado:       mkEstado(r, depOk),
      respuestaRaw: r.respuestaRaw,
    });

    return NextResponse.json({
      logId1:    log1Id,
      logId2:    log2Id || null,
      opg1Num:   consecOpg1,
      opg2Num:   consecOpg2,
      ppItems,
      opg1: {
        orden:   toDocResult(ordenOpg1Result,   true),
        consumo: toDocResult(consumoOpg1Result,  ordenOpg1Result.exitoso),
        entrega: toDocResult(entregaOpg1Result,  consumoOpg1Result.exitoso),
      },
      opg2: {
        orden:   toDocResult(ordenOpg2Result,   true),
        consumo: toDocResult(consumoOpg2Result,  ordenOpg2Result.exitoso),
        entrega: toDocResult(entregaOpg2Result,  consumoOpg2Result.exitoso),
      },
      xmls: { xml1b, xml2b, xml3b, xml2, xml3, xmlLotesEpgOpg2 },
      existenciaCheck: existenciaCheck ?? undefined,
    });
  } catch (err) {
    console.error("[POST /api/export-produccion/[id]/transmit-beneficio]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
