// src/app/api/export-produccion/[id]/transmit-produccion-spp/route.ts
// Proceso Sin Producto en Proceso — una sola OPG (clase_op=002):
//
//  OPG1: Orden de producción con los productos filtrados.
//  ↓ Consulta componentes de OPG1 en ERP → SPG (consumo) con componentes reales
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

    const body = await req.json() as {
      bache:            number;
      consecOpg1:       number;
      xml1:             string;
      lotesPorProducto: Record<string, string>;
      rows:             RowXml3[];
    };
    const { bache, consecOpg1, xml1, lotesPorProducto = {}, rows = [] } = body;

    if (!bache)      return NextResponse.json({ error: "Falta el número de lote (bache)" }, { status: 400 });
    if (!consecOpg1) return NextResponse.json({ error: "Falta consecOpg1" }, { status: 400 });

    const fechaYMD = (raw: Date | string): string => {
      const s = typeof raw === "string" ? raw : raw.toISOString();
      return s.slice(0, 10).replace(/-/g, "");
    };
    const fecha = fechaYMD(filtro.fecha);
    const co    = filtro.centroOperacion?.trim() ?? "";

    // ── Crear log OPG1 ────────────────────────────────────────────────────
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

    let ordenOpg1Result:   DocResult = PENDIENTE;
    let consumoOpg1Result: DocResult = PENDIENTE;
    let entregaOpg1Result: DocResult = PENDIENTE;
    let xml2 = "";
    let xml3 = "";

    const mkErr = (e: unknown): DocResult =>
      ({ exitoso: false, printTipoError: -1, errores: [], respuestaRaw: String(e) });

    // ── Paso 1: Enviar XML1 → OPG1 ────────────────────────────────────────
    try { ordenOpg1Result = await callSoap(xml1); }
    catch (e) { ordenOpg1Result = mkErr(e); }

    if (ordenOpg1Result.exitoso) {

      // ── Paso 2: Consultar componentes en ERP → SPG OPG1 ──────────────
      try {
        const opg1Componentes = await queryComponentesOP(co, "OPG", consecOpg1);
        xml2 = buildXML2(co, filtro.nombre, fecha, consecOpg1, opg1Componentes, lotesPorProducto, []);
        await prisma.opgLog.update({ where: { id: log1.id }, data: { xml2 } });
        consumoOpg1Result = await callSoap(xml2);
      } catch (e) { consumoOpg1Result = mkErr(e); }

      // ── Paso 3: EPG OPG1 ──────────────────────────────────────────────
      if (consumoOpg1Result.exitoso) {
        try {
          xml3 = buildXML3(co, filtro.nombre, fecha, consecOpg1, rows, filtro.bodegaItemPadre);
          await prisma.opgLog.update({ where: { id: log1.id }, data: { xml3 } });
          entregaOpg1Result = await callSoap(xml3);
        } catch (e) { entregaOpg1Result = mkErr(e); }
      }
    }

    // ── Actualizar log ────────────────────────────────────────────────────
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

    const toDocResult = (r: DocResult, depOk: boolean) => ({
      exitoso: r.exitoso,
      errores: r.errores,
      estado:  mkEstado(r, depOk),
    });

    return NextResponse.json({
      logId1:  log1.id,
      opg1Num: consecOpg1,
      opg1: {
        orden:   toDocResult(ordenOpg1Result,   true),
        consumo: toDocResult(consumoOpg1Result,  ordenOpg1Result.exitoso),
        entrega: toDocResult(entregaOpg1Result,  consumoOpg1Result.exitoso),
      },
      xmls: { xml2, xml3 },
    });
  } catch (err) {
    console.error("[POST /api/export-produccion/[id]/transmit-produccion-spp]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
