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
  type DocResult,
  type ComponenteOP,
} from "@/lib/erp-soap";

export type { ErpError, DocResult } from "@/lib/erp-soap";


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
    pA(tipoDoctoOrden,   3) +
    pN(1,   8) +
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
    pA("",                 4) +
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
  lotesPorProducto: Record<string, string>,
  productoProceso:  string[],
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

  const productLines = componentes.map((comp, i) => {
    const esPp    = productoProceso.includes(comp.hijoReferencia.trim());
    const lotePad = esPp ? (lotesPorProducto[comp.padreReferencia.trim()] ?? "") : "";
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
      pA("01",   2) +
      pA(centroOperacion,       3) +
      pA("31",  20) +
      pA("70010401",           15) +
      pA("",    15) +
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
): string {
  const opening = "000000100000001001";

  const encabezado =
    pN(2,    7) + pN(450, 4) + pN(1, 2) + pN(1, 2) + pN(1, 3) + pN(1, 1) +
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
      pA("03",   2) + pA("",    2) +
      pA(centroOperacion,       3) +
      pA("31",  20) +
      pA("70010401",           15) +
      pA("",    15) +
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
//   f470_referencia_item        → siempre "PP00002" para todas las líneas
//   f470_referencia_item_otros  → código real del producto; vacío si es PP00002
//   f_nro_reg_item_padre        → 1 para todos excepto PP00002 que lleva 0
function buildXML3b(
  centroOperacion: string,
  nombre:          string,
  fecha:           string,
  consecOpg:       number,
  rows:            RowXml3[],
  bodegaItemPadre: string | null | undefined,
): string {
  const opening = "000000100000001001";

  const encabezado =
    pN(2,    7) + pN(450, 4) + pN(1, 2) + pN(1, 2) + pN(1, 3) + pN(1, 1) +
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
    const bodega   = pA((bodegaItemPadre ?? row.BODEGA)?.trim(), 5);
    const esPP2    = row.CODIGO_PRODUCTO.trim() === "PP00002";
    const itemOtro = esPP2 ? "" : row.CODIGO_PRODUCTO;   // f470_referencia_item_otros
    const nroRegPadre = esPP2 ? 0 : 2;                   // f_nro_reg_item_padre
    return (
      pN(i + 3,  7) + pN(470, 4) + pN(2, 2) + pN(2, 2) + pN(1, 3) +
      pA(centroOperacion,   3) +
      pA("EPG",             3) +
      pN(1,      8) +
      pN(i + 1, 10) +
      pA("OPG",             3) +
      pN(consecOpg,         8) +
      pN(0,      7) +
      pA("PP00002",        50) +                          // f470_referencia_item
      pA("",    20) + pA("",    20) + pA("",    20) +
      pN(0,      7) +
      pA(itemOtro,         50) +                          // f470_referencia_item_otros
      pA("",    20) + pA("",    20) + pA("",    20) +
      bodega +
      pA("",    10) +
      pA(row.LOTE_PRODUCTO,    15) +
      pN(701,    3) +
      pA("03",   2) + pA("",    2) +
      pA(centroOperacion,   3) +
      pA("31",  20) +
      pA("70010401",       15) +
      pA("",    15) +
      pQ(Number(row.KIL), 15, 4) +
      pQ(Number(row.UND), 15, 4) +
      pQ(0,     15, 4) + pQ(0, 15, 4) +
      pA("",   255) + pA("",  2000) +
      pA("",    40) +
      pA(row.UNIDAD_PRODUCTO,  4) +
      pN(nroRegPadre,      10)                            // f_nro_reg_item_padre
    );
  });

  const closingNum = rows.length + 3;
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
    const PP_CON_LOTE = (filtro.ppConLote ?? "PP00001,PP00002,PP00003")
      .split(",").map((s) => s.trim()).filter(Boolean);

    const body = await req.json() as {
      bache:            number;
      consecOpg1:       number;
      xml1:             string;
      lotesPorProducto: Record<string, string>;
      rows:             RowXml3[];
    };
    const { bache, consecOpg1, xml1, lotesPorProducto = {}, rows = [] } = body;

    if (!bache)     return NextResponse.json({ error: "Falta el número de lote (bache)" },  { status: 400 });
    if (!consecOpg1) return NextResponse.json({ error: "Falta consecOpg1" }, { status: 400 });

    const fechaYMD = (raw: Date | string): string => {
      const s = typeof raw === "string" ? raw : raw.toISOString();
      return s.slice(0, 10).replace(/-/g, "");
    };
    const fecha = fechaYMD(filtro.fecha);
    const co    = filtro.centroOperacion?.trim() ?? "";
    const lote1 = rows[0]?.LOTE_PRODUCTO ?? "";

    // ── Crear log inicial OPG1 ─────────────────────────────────────────────
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

    // Resultados
    let ordenOpg1Result:   DocResult = PENDIENTE;
    let ordenOpg2Result:   DocResult = PENDIENTE;
    let consumoOpg2Result: DocResult = PENDIENTE;
    let entregaOpg2Result: DocResult = PENDIENTE;
    let consumoOpg1Result: DocResult = PENDIENTE;
    let entregaOpg1Result: DocResult = PENDIENTE;

    let consecOpg2 = 0;
    let xml1b = "";
    let xml2b = "";
    let xml3b = "";
    let xml2  = "";
    let xml3  = "";

    let opg1Componentes: ComponenteOP[] = [];
    let ppItems:         PpItem[]       = [];   // solo PP00002 → decide si crear OPG2
    let ppEntregaItems:  PpItem[]       = [];   // PP00001+PP00002+PP00003 → van en EPG OPG2
    let log2Id = 0;

    const mkErr = (e: unknown): DocResult =>
      ({ exitoso: false, printTipoError: -1, errores: [], respuestaRaw: String(e) });

    // ── Paso 1: Enviar XML1 → OPG1 ───────────────────────────────────────
    try { ordenOpg1Result = await callSoap(xml1); }
    catch (e) { ordenOpg1Result = mkErr(e); }

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

      if (ppItems.length > 0) {

        // ── Paso 2b: Crear lotes PP (después de OPG1, antes de OPG2) ───────
        try {
          const ppLotes: ProductoLote[] = ppItems.map((p) => ({ codigo: p.codigo, lote: p.lote }));
          const existentes = await prisma.loteCreado.findMany({
            where:  { OR: ppLotes.map((p) => ({ codigoProducto: p.codigo, lote: p.lote })) },
            select: { codigoProducto: true, lote: true },
          });
          const existenteSet = new Set(existentes.map((e) => `${e.codigoProducto}|${e.lote}`));
          const lotesNuevos  = ppLotes.filter((p) => !existenteSet.has(`${p.codigo}|${p.lote}`));
          if (lotesNuevos.length > 0) {
            const loteResult = await callSoap(buildXMLLotes(lotesNuevos, fecha));
            if (loteResult.exitoso) {
              await Promise.all(
                lotesNuevos.map((p) =>
                  prisma.loteCreado.upsert({
                    where:  { codigoProducto_lote: { codigoProducto: p.codigo, lote: p.lote } },
                    create: { codigoProducto: p.codigo, lote: p.lote },
                    update: {},
                  })
                )
              );
            }
          }
        } catch { /* continuar aunque falle la creación de lotes PP */ }

        // ── Paso 3: Construir y enviar XML1b → OPG2 ─────────────────────
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

        try { ordenOpg2Result = await callSoap(xml1b); }
        catch (e) { ordenOpg2Result = mkErr(e); }

        if (ordenOpg2Result.exitoso) {

          // ── Paso 4: SPG OPG2 ──────────────────────────────────────────
          try {
            const opg2Componentes = await queryComponentesOP(co, "OPG", consecOpg2);
            xml2b = buildXML2(co, filtro.nombre, fecha, consecOpg2, opg2Componentes, {}, []);
            await prisma.opgLog.update({ where: { id: log2Id }, data: { xml2: xml2b } });
            consumoOpg2Result = await callSoap(xml2b);
          } catch (e) { consumoOpg2Result = mkErr(e); }

          if (consumoOpg2Result.exitoso) {

            // ── Paso 5: EPG OPG2 ────────────────────────────────────────
            try {
              // Entrega los tres PP (PP00001, PP00002, PP00003) con sus cantidades de OPG1
              const rowsPP: RowXml3[] = ppEntregaItems.map((p) => ({
                CODIGO_PRODUCTO: p.codigo, LOTE_PRODUCTO: p.lote,
                BODEGA: filtro.bodegaItemPadre?.trim() ?? "",
                UNIDAD_PRODUCTO: p.unidad, KIL: p.cantidad, UND: 0,
              }));
              xml3b = buildXML3b(co, filtro.nombre, fecha, consecOpg2, rowsPP, filtro.bodegaItemPadre);
              await prisma.opgLog.update({ where: { id: log2Id }, data: { xml3: xml3b } });
              entregaOpg2Result = await callSoap(xml3b);
            } catch (e) { entregaOpg2Result = mkErr(e); }

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
            const loteResult = await callSoap(buildXMLLotes(lotesNuevos, fecha));
            if (loteResult.exitoso) {
              await Promise.all(
                lotesNuevos.map((p) =>
                  prisma.loteCreado.upsert({
                    where:  { codigoProducto_lote: { codigoProducto: p.codigo, lote: p.lote } },
                    create: { codigoProducto: p.codigo, lote: p.lote },
                    update: {},
                  })
                )
              );
            }
          }
        } catch { /* continuar aunque falle */ }
      }

      // ── Paso 6: SPG OPG1 ─────────────────────────────────────────────────
      // Depende de: EPG OPG2 exitosa (si había PP) o de OPG1 directamente (si no había PP)
      if (puedeOpg1Phase && opg1Componentes.length > 0) {
        try {
          xml2 = buildXML2(co, filtro.nombre, fecha, consecOpg1, opg1Componentes, lotesPorProducto, PP_CON_LOTE);
          await prisma.opgLog.update({ where: { id: log1.id }, data: { xml2 } });
          consumoOpg1Result = await callSoap(xml2);
        } catch (e) { consumoOpg1Result = mkErr(e); }

        // ── Paso 7: EPG OPG1 ──────────────────────────────────────────────
        if (consumoOpg1Result.exitoso) {
          try {
            xml3 = buildXML3(co, filtro.nombre, fecha, consecOpg1, rows, filtro.bodegaItemPadre);
            await prisma.opgLog.update({ where: { id: log1.id }, data: { xml3 } });
            entregaOpg1Result = await callSoap(xml3);
          } catch (e) { entregaOpg1Result = mkErr(e); }
        }
      }

    }

    // ── Actualizar logs ────────────────────────────────────────────────────
    const mkEstado = (r: DocResult, depOk: boolean): string =>
      r.exitoso ? "ENVIADO" : (r.printTipoError === -1 && !depOk ? "PENDIENTE" : "ERROR");

    await prisma.opgLog.update({
      where: { id: log1.id },
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
      exitoso: r.exitoso,
      errores: r.errores,
      estado:  mkEstado(r, depOk),
    });

    return NextResponse.json({
      logId1:    log1.id,
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
      xmls: { xml1b, xml2b, xml3b, xml2, xml3 },
    });
  } catch (err) {
    console.error("[POST /api/export-produccion/[id]/transmit-beneficio]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
