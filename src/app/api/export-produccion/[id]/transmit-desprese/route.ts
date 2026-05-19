// src/app/api/export-produccion/[id]/transmit-desprese/route.ts
// Proceso Desprese — dos OPGs en cascada:
//
//  OPG1: Orden de producción con los productos filtrados.
//  ↓ Consulta componentes de OPG1 → suma PI00001
//  OPG2: Orden de producción para PI00001 (subproducto).
//  ↓ Consulta componentes de OPG2 → SPG (consumo) de OPG2 → EPG (entrega) de PI
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
  queryInventarioRefLote,
  type DocResult,
  type ComponenteOP,
} from "@/lib/erp-soap";

export type { ErpError, DocResult } from "@/lib/erp-soap";

// ── Comparación de existencias por bodega + referencia + lote ────────────
interface ExistenciaComparacion {
  bodegaId:    string;    // Bodega_id        (trimmed)
  referencia:  string;    // Hijo_Referencia  (trimmed)
  descripcion?: string;   // Descripcion del ítem (solo para OPG2)
  lote:        string;    // Lote             (trimmed, puede ser vacío)
  disponible1: number;    // Cantidad_disponible1 de ese lote en esa bodega
  disponible2: number;    // Cantidad_disponible2 de ese lote en esa bodega
  aConsumir1:  number;    // sum(Cantidad_pendiente1) para esa (bodega, ref) en la respuesta del WS
  suficiente:  boolean;   // sum(disponible1 de todos los lotes de esa bodega+ref) >= aConsumir1
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

function trimStart(str: string, char: string): string {
  if (char.length !== 1) {
    throw new Error("El carácter de referencia debe ser exactamente un carácter");
  }

  let i = 0;
  while (i < str.length && str[i] === char) {
    i++;
  }

  return str.slice(i);
}

function loteEsMasAntiguo(lote: string, fechaComparar: Date): boolean {
  if (lote.length !== 5 || !/^\d{5}$/.test(lote)) {
    throw new Error("El lote debe tener exactamente 5 dígitos numéricos");
  }

  const diaJuliano = parseInt(lote.substring(0, 3), 10);
  const anio       = parseInt(lote.substring(3, 5), 10) + 2000;

  if (diaJuliano < 1 || diaJuliano > 366) {
    throw new Error(`Día juliano inválido: ${diaJuliano}`);
  }

  // Construir la fecha a partir del día juliano
  const fechaLote = new Date(anio, 0, 1);         // 1 enero del año
  fechaLote.setDate(diaJuliano);                  // sumar los días julianos

  // Comparar solo fechas (sin hora)
  fechaLote.setHours(0, 0, 0, 0);
  fechaComparar.setHours(0, 0, 0, 0);

  return fechaLote.getTime() < fechaComparar.getTime();
}

// ── XML1b — Orden de Producción para PI (OPG2) ────────────────────────────
// Mismo formato que OPG1 (tipo 850/851), pero clase_op=004 ya que PI00001
// no tiene lista de materiales (permite consumir cualquier producto).
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
    pA("004",            3) +   // clase_op = 004 (sin lista de materiales)
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
    pA(trimStart(item.codigo, "0"),    50) +
    pA("",                20) +
    pA("",                20) +
    pA("",                20) +
    pA(item.unidad,        4) +
    pN(100,                8) +
    pQ(item.cantidad,     15, 4) +
    pA(fecha,              8) +
    pA(fecha,              8) +
    pA("",                 4) +   // f851_id_metodo_lista — vacío (sin lista de materiales)
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
  centroOperacion: string,
  nombre:          string,
  fecha:           string,
  consecOpg:       number,
  componentes:     ComponenteOP[],
  productoProceso: string[],
  motivoConsumo:   string,
  ccostoMovto:     string,
): string {
  const y      = parseInt(fecha.slice(0, 4), 10);
  const m      = parseInt(fecha.slice(4, 6), 10);
  const d      = parseInt(fecha.slice(6, 8), 10);
  const dia    = Math.round((new Date(y, m - 1, d).getTime() - new Date(y, 0, 1).getTime()) / 86_400_000) + 1;
  const loteJul = String(dia).padStart(3, "0") + String(y).slice(-2);

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

  const loteSaldoInicial = "P26ERP";
  const productosLoteQuemado = new Set(["MPS250022", "MPS250023", "MPS250024", "MPS250025", "MPS250026", "MPS250027", "MPS250028", "MPS010002", "MPS050001", "MPS070002", "MPS100006", "MPS100012", "MPS100013", "MPS220001", "MPS220002", "MPS220003", "MPS220004", "MPS090003", "MPS220005", "MPS030001"]); 

  const productLines = componentes.map((comp, i) => {
    const esProductoProceso    = productoProceso.includes(comp.hijoReferencia.trim());
    const lotePad = esProductoProceso ? (productosLoteQuemado.has(comp.hijoReferencia.trim()) ? loteSaldoInicial : loteJul) : (productosLoteQuemado.has(comp.hijoReferencia.trim()) ? loteSaldoInicial : "");

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
      pA("31",  20) +
      pA(ccostoMovto,          15) +
      pA("",                   15) +
      pA(comp.hijoUnidad,       4) +
      pQ(comp.cantidadPendiente1, 15, 4) +
      pQ(comp.cantidadPendiente2, 15, 4) +
      pA("",   255) +
      pA("",  2000)
    );
  });

  const closingNum = componentes.length + 3;
  const closing = pN(closingNum, 7) + "9999" + "00" + "01" + "001";
  return [opening, encabezado, ...productLines, closing].join("\n");
}

// ── XML2ConLotes — SPG OPG1 con lotes explícitos (distribución FIFO) ────────
// Igual que buildXML2 pero el lote ya viene calculado en cada línea;
// no aplica ningún override de lote. Permite consumir del stock exacto
// (potencialmente en varios lotes) que el WS reportó como disponible.
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
    pA("31",  20) +
    pA(ccostoMovto,          15) +
    pA("",          15) +
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

// ── XML2Consumo — SPG OPG2 Desprese (consumo libre, clase_op=004) ────────
// Igual que buildXML2 pero:
//   f470_id_bodega → bodegaItemPadre del filtro (no la bodega del movimiento)
//   f470_id_lote   → lote del producto consumido (LOTE_PRODUCTO de la fila)
function buildXML2Consumo(
  centroOperacion:  string,
  nombre:           string,
  fecha:            string,
  consecOpg:        number,
  rows:             RowXml3[],
  bodegaItemPadre:  string,
  productoProceso:  string,
  motivoConsumo:    string,
  ccostoMovto:      string,
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

  const productLines = rows.map((row, i) =>
    pN(i + 3,  7) + pN(470, 4) + pN(0, 2) + pN(4, 2) + pN(1, 3) +
    pA(centroOperacion,      3) +
    pA("SCG",                3) +
    pN(1,      8) +
    pN(i + 1, 10) +
    pN(0,      7) +
    pA(productoProceso,     50) +   // padreReferencia = producto en proceso
    pA("",    20) + pA("",    20) + pA("",    20) +
    pN(0,     10) +
    pN(0,      7) +
    pA(trimStart(row.CODIGO_PRODUCTO, "0"), 50) +   // hijoReferencia = producto consumido
    pA("",    20) + pA("",    20) + pA("",    20) +
    pA(bodegaItemPadre,      5) +   // f470_id_bodega = bodegaItemPadre del filtro
    pA("",    10) +
    pA(row.LOTE_PRODUCTO.trim(), 15) +              // f470_id_lote = lote del WS (directo)
    pN(701,    3) +
    pA(motivoConsumo,        2) +
    pA(centroOperacion,      3) +
    pA("31",  20) +
    pA(ccostoMovto,         15) +
    pA("",          15) +
    pA((row.UNIDAD_PRODUCTO.trim() === "KG") ? "KIL" : row.UNIDAD_PRODUCTO.trim(), 4) +
    pQ(Number(row.KIL), 15, 4) +
    pQ(Number(row.UND), 15, 4) +
    pA("",   255) +
    pA("",  2000)
  );

  const closingNum = rows.length + 3;
  const closing = pN(closingNum, 7) + "9999" + "00" + "01" + "001";
  return [opening, encabezado, ...productLines, closing].join("\n");
}

// ── XML3 — Entrega de Producción EPG (tipo 450-01/470-02) ─────────────────
interface RowXml3 {
  CODIGO_PRODUCTO: string;
  LOTE_PRODUCTO:   string;
  BODEGA:          string;
  UBICACION?:      string;
  UNIDAD_PRODUCTO: string;
  KIL:             number;
  UND:             number;
  // Identificadores de registro en Mvdcto — usados para marcar el bache al transmitir
  NRODCTO?:        string;
  TIPODCTO?:       string;
  ORIGEN?:         string;
}

// Escapa comillas simples para uso en SQL dinámico
const s = (val: string | null | undefined): string =>
  (val ?? "").replace(/'/g, "''").trim();

function buildXML3(
  centroOperacion: string,
  nombre:          string,
  fecha:           string,
  consecOpg:       number,
  rows:            RowXml3[],
  bodegaItemPadre: string | null | undefined,
  motivoEntrega:   string,
  ccostoMovto:     string,
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
    const productoSinUnidadAdicional = new Set<string>(["35538F", "35538E"]);

    return (
      pN(i + 3,  7) + pN(470, 4) + pN(2, 2) + pN(2, 2) + pN(1, 3) +
      pA(centroOperacion,      3) +
      pA("EPG",                3) +
      pN(1,      8) +
      pN(i + 1, 10) +
      pA("OPG",                3) +
      pN(consecOpg,            8) +
      pN(0,      7) +
      pA(trimStart(row.CODIGO_PRODUCTO, "0"),  50) +
      pA("",    20) + pA("",    20) + pA("",    20) +
      pN(0,      7) +
      pA("",    50) + pA("",    20) + pA("",    20) + pA("",    20) +
      bodega +
      pA("",    10) +
      pA(row.LOTE_PRODUCTO,    15) +
      pN(701,    3) +
      pA(motivoEntrega, 2) +
      pA("",   2) + 
      pA(centroOperacion,       3) +
      pA("31",  20) +
      pA(ccostoMovto,          15) +
      pA("",          15) +
      pQ(Number(row.KIL), 15, 4) +
      pQ(productoSinUnidadAdicional.has(row.CODIGO_PRODUCTO.trim()) ? 0 : Number(row.UND), 15, 4) +
      pQ(0,     15, 4) + pQ(0, 15, 4) +
      pA("",   255) + pA("",  2000) +
      pA("",    40) +
      pA((row.UNIDAD_PRODUCTO.trim() == "KG") ? "KIL" : row.UNIDAD_PRODUCTO,   4) +
      pN(0,     10)
    );
  });

  const closingNum = rows.length + 3;
  const closing = pN(closingNum, 7) + "9999" + "00" + "01" + "001";
  return [opening, encabezado, ...productLines, closing].join("\n");
}

// ── XML3b — Entrega OPG2 (EPG con reglas de PI) ───────────────────────────
// Diferencias respecto a buildXML3 (OPG1):
//   f470_referencia_item        → siempre productoProceso para todas las líneas
//   f470_referencia_item_otros  → código real del producto; vacío si es productoProceso
//   f_nro_reg_item_padre        → 1 para todos excepto productoProceso que lleva 0
function buildXML3b(
  centroOperacion:  string,
  nombre:           string,
  fecha:            string,
  consecOpg:        number,
  rows:             RowXml3[],
  bodegaItemPadre:  string | null | undefined,
  productoProceso:  string,
  motivoEntrega:    string,
  ccostoMovto:      string,
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
    const bodega   = pA((bodegaItemPadre ?? row.BODEGA)?.trim(), 5);
    const esPI     = row.CODIGO_PRODUCTO.trim() === productoProceso;
    const itemOtro = esPI ? "" : row.CODIGO_PRODUCTO;    // f470_referencia_item_otros
    const nroRegPadre = esPI ? 0 : 2;                    // f_nro_reg_item_padre
    return (
      pN(i + 3,  7) + pN(470, 4) + pN(2, 2) + pN(2, 2) + pN(1, 3) +
      pA(centroOperacion,   3) +
      pA("EPG",             3) +
      pN(1,      8) +
      pN(i + 1, 10) +
      pA("OPG",             3) +
      pN(consecOpg,         8) +
      pN(0,      7) +
      pA(productoProceso,  50) +                         // f470_referencia_item
      pA("",    20) + pA("",    20) + pA("",    20) +
      pN(0,      7) +
      pA(itemOtro,         50) +                          // f470_referencia_item_otros
      pA("",    20) + pA("",    20) + pA("",    20) +
      bodega +
      pA("",    10) +
      pA(row.LOTE_PRODUCTO,    15) +
      pN(701,    3) +
      pA(motivoEntrega, 2) +
      pA("",   2) + 
      pA(centroOperacion,   3) +
      pA("31",  20) +
      pA(ccostoMovto,      15) +
      pA("",          15) +
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
    pA(trimStart(p.codigo, "0"),  50) +
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
const LOTE_YA_EXISTE_MSG = "el lote que desea adicionar ya existe";

async function enviarLotesIndividual(
  lotesNuevos: ProductoLote[],
  fecha: string,
): Promise<void> {
  for (const lote of lotesNuevos) {
    const xml = buildXMLLotes([lote], fecha);
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
}

// ── Consecutivo OPG desde Prisma (sin HTTP) ───────────────────────────────
// ── Recupera ppItems desde el XML1b guardado en BD (para reintentos) ────────
// Cuando en un reintento los componentes de OPG1 ya muestran cantidadPendiente1=0
// para los productos PP (porque OPG1 ya fue consumida), ppItems queda vacío y la
// EPG de OPG2 no tendría líneas. Este parser extrae los ítems directamente del
// XML1b que se usó para CREAR OPG2, garantizando que la entrega siempre coincida.
//
// Offsets dentro de cada línea 851 (calculados desde buildXML1b):
//   7-10   tipo de registro "0851"
//  49-98   f851_referencia_item (50 chars, sin ceros iniciales)
// 159-162  f851_id_unidad (4 chars)
// 171-190  f851_cantidad (pQ 15,4 → 20 chars incluyendo punto decimal)
// 220-234  f851_id_lote (15 chars)
function parsePpItemsFromXml1b(xml1b: string): PpItem[] {
  const items: PpItem[] = [];
  for (const line of xml1b.split("\n")) {
    if (line.length < 235 || line.slice(7, 11) !== "0851") continue;
    const codigo   = line.slice(49, 99).trim();
    const unidad   = line.slice(159, 163).trim();
    const cantidad = parseFloat(line.slice(171, 191)) || 0;
    const lote     = line.slice(220, 235).trim();
    if (codigo && cantidad > 0) items.push({ codigo, cantidad, unidad, lote });
  }
  return items;
}

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
      rowsConsumo:      RowXml3[];
      logId1?:          number;
      logId2?:          number;
      prevConsecOpg2?:  number;
    };
    const { bache, consecOpg1, xml1, lotesPorProducto = {}, rows = [], rowsConsumo = [], logId1,
            logId2: bodyLogId2, prevConsecOpg2 } = body;

    const ccostoConsumo = filtro.ccostoConsumo?.trim() ?? "";
    const ccostoEntrega = filtro.ccostoEntrega?.trim() ?? "";

    if (!bache)     return NextResponse.json({ error: "Falta el número de lote (bache)" },  { status: 400 });
    if (!consecOpg1) return NextResponse.json({ error: "Falta consecOpg1" }, { status: 400 });

    const fechaYMD = (raw: Date | string): string => {
      const s = typeof raw === "string" ? raw : raw.toISOString();
      return s.slice(0, 10).replace(/-/g, "");
    };
    const fecha = fechaYMD(filtro.fecha);
    const co    = filtro.centroOperacion?.trim() ?? "";

    const _fy    = parseInt(fecha.slice(0, 4), 10);
    const _fm    = parseInt(fecha.slice(4, 6), 10);
    const _fd    = parseInt(fecha.slice(6, 8), 10);
    const _dia   = Math.round((new Date(_fy, _fm - 1, _fd).getTime() - new Date(_fy, 0, 1).getTime()) / 86_400_000) + 1;
    const loteJul = String(_dia).padStart(3, "0") + String(_fy).slice(-2);

    const ppCodigo   = filtro.productoProceso?.trim() ?? "";
    const PP_CODIGOS = ppCodigo ? [ppCodigo] : [];
    const PP_CON_LOTE = ppCodigo ? [ppCodigo] : [];

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
      const newLog = await prisma.opgLog.create({
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
      log1Id = newLog.id;
    }

    // ── Cargar estados actuales de los logs para skip-on-retry ───────────────
    const log1State = await prisma.opgLog.findUnique({
      where:  { id: log1Id },
      select: {
        estadoOrdenProduccion:    true, estadoConsumoProduccion:    true, estadoEntregaProduccion:    true,
        respuestaOrdenProduccion: true, respuestaConsumoProduccion: true, respuestaEntregaProduccion: true,
        xml2: true, xml3: true,
      },
    });
    const log2State = bodyLogId2 ? await prisma.opgLog.findUnique({
      where:  { id: bodyLogId2 },
      select: {
        estadoOrdenProduccion:    true, estadoConsumoProduccion:    true, estadoEntregaProduccion:    true,
        respuestaOrdenProduccion: true, respuestaConsumoProduccion: true, respuestaEntregaProduccion: true,
        xml1: true, xml2: true, xml3: true,
      },
    }) : null;

    const skip = (respuesta: string | null | undefined = ""): DocResult => ({
      exitoso: true, printTipoError: -1, errores: [], respuestaRaw: respuesta ?? "",
    });

    // ── Marcar en BD los registros de consumo seleccionados ──────────────────
    // Solo se marcan los que el usuario seleccionó en la tabla Consumo OPG2.
    // Los no seleccionados quedan con bache = 0/NULL y aparecerán disponibles
    // la próxima vez que se ejecute el proceso.
    if (rowsConsumo.length > 0) {
      const consumoClauses = rowsConsumo
        .filter((r) => r.NRODCTO && r.TIPODCTO && r.ORIGEN)
        .map((r) =>
          `(B.Nrodcto  = '${s(r.NRODCTO)}'` +
          ` AND B.Tipodcto = '${s(r.TIPODCTO)}'` +
          ` AND B.Origen   = '${s(r.ORIGEN)}'` +
          ` AND B.CODIGO   = '${s(r.CODIGO_PRODUCTO)}'` +
          ` AND ISNULL(B.CODLOTE,'')   = '${s(r.LOTE_PRODUCTO)}'` +
          ` AND B.Bodega   = '${s(r.BODEGA)}'` +
          ` AND ISNULL(B.codubica,'')  = '${s(r.UBICACION ?? "")}')`
        );
      if (consumoClauses.length > 0) {
        const updateBacheSql = `
          UPDATE B
          SET    B.bache = ${bache}
          FROM   Mvdcto B
          WHERE  (B.bache = 0 OR B.bache IS NULL)
            AND  (${consumoClauses.join("\n            OR ")})
        `;
        await prisma.$executeRawUnsafe(updateBacheSql);
      }
    }

    // Resultado de verificación de existencias OPG1 (solo cuando son insuficientes)
    let existenciaCheck:     { items: ExistenciaComparacion[]; suficiente: boolean } | null = null;
    // Resultado de verificación de existencias OPG2 (solo cuando son insuficientes)
    let existenciaCheckOpg2: { items: ExistenciaComparacion[]; suficiente: boolean } | null = null;

    // Resultados
    let ordenOpg1Result:   DocResult = PENDIENTE;
    let ordenOpg2Result:   DocResult = PENDIENTE;
    let consumoOpg2Result: DocResult = PENDIENTE;
    let entregaOpg2Result: DocResult = PENDIENTE;
    let consumoOpg1Result: DocResult = PENDIENTE;
    let entregaOpg1Result: DocResult = PENDIENTE;

    let consecOpg2 = bodyLogId2 ? (prevConsecOpg2 ?? 0) : 0;
    let xml1b = log2State?.xml1 ?? "";
    let xml2b = log2State?.xml2 ?? "";
    let xml3b = log2State?.xml3 ?? "";
    let xml2  = log1State?.xml2 ?? "";
    let xml3  = log1State?.xml3 ?? "";

    let opg1Componentes: ComponenteOP[] = [];
    let ppItems:         PpItem[]       = [];   // solo PP00002 → decide si crear OPG2
    let ppEntregaItems:  PpItem[]       = [];   // PP00001+PP00002+PP00003 → van en EPG OPG2
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
          codigo, cantidad, unidad, lote: loteJul,
        }));
        ppEntregaItems = Object.entries(ppEntregaSums).map(([codigo, { cantidad, unidad }]) => ({
          codigo, cantidad, unidad, lote: loteJul,
        }));
      } catch {
        opg1Componentes = [];
        ppItems         = [];
        ppEntregaItems  = [];
      }

      // ── Recuperación ppItems en reintento ────────────────────────────────
      // Si OPG1 ya fue consumida (cantidadPendiente1=0 para PP), ppItems queda
      // vacío y la EPG de OPG2 no tendría líneas de producto. Se recupera desde
      // el XML1b almacenado en BD, que refleja exactamente lo que se planificó.
      if (ppItems.length === 0 && bodyLogId2 && log2State?.xml1) {
        ppItems        = parsePpItemsFromXml1b(log2State.xml1);
        ppEntregaItems = ppItems;
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
            if (lotesNuevos.length > 0) await enviarLotesIndividual(lotesNuevos, fecha);
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
          // clase_op=004 (sin lista de materiales): se consultan los lotes disponibles
          // en bodegaItemPadre por cada referencia seleccionada por el usuario, se
          // verifica que el stock total sea suficiente y se distribuye FIFO (lote más
          // antiguo primero) para construir el XML de consumo.
          if (log2State?.estadoConsumoProduccion === "ENVIADO") {
            consumoOpg2Result = skip(log2State.respuestaConsumoProduccion);
          } else {
            try {
              if (rowsConsumo.length > 0) {
                const bodegaConsulta = filtro.bodegaItemPadre?.trim() ?? "";
                const r4 = (n: number) => Math.round(n * 10000) / 10000;

                // ── A: sumar cantidades seleccionadas por referencia ──────────
                type NeedEntry = { total1: number; total2: number };
                const needByRef = new Map<string, NeedEntry>();
                for (const row of rowsConsumo) {
                  const ref  = row.CODIGO_PRODUCTO.trim();
                  const prev = needByRef.get(ref);
                  if (!prev) {
                    needByRef.set(ref, { total1: Number(row.KIL), total2: Number(row.UND) });
                  } else {
                    prev.total1 += Number(row.KIL);
                    prev.total2 += Number(row.UND);
                  }
                }

                // ── B: consultar lotes disponibles por referencia (WS_FENIX_INVENTARIO_REF_LOTE) ─
                // El WS devuelve los lotes ya ordenados por Fecha_creacion ascendente
                // (más antiguo primero) en queryInventarioRefLote.
                type LoteDisp = { lote: string; unidInv1: string; disponible1: number; disponible2: number };
                const lotesByRef = new Map<string, LoteDisp[]>();
                for (const ref of needByRef.keys()) {
                  const lotes = await queryInventarioRefLote(bodegaConsulta, ref);
                  lotesByRef.set(ref, lotes.map((l) => ({
                    lote:        l.lote,
                    unidInv1:    l.unidInv1,
                    disponible1: l.disponible1,
                    disponible2: l.disponible2,
                  })));
                }

                // ── C: verificar existencias — total disponible >= total a consumir ─
                // Se muestra una fila por lote para que el usuario vea la distribución.
                const itemsOpg2: ExistenciaComparacion[] = [];
                let existenciasOpg2Ok = true;

                for (const [ref, need] of needByRef.entries()) {
                  const lotes     = lotesByRef.get(ref) ?? [];
                  const totalDisp = lotes.reduce((s, l) => s + l.disponible1, 0);
                  const suficiente = r4(totalDisp) >= r4(need.total1);
                  if (!suficiente) existenciasOpg2Ok = false;

                  if (lotes.length > 0) {
                    for (const lote of lotes) {
                      itemsOpg2.push({
                        bodegaId:    bodegaConsulta,
                        referencia:  ref,
                        lote:        lote.lote,
                        disponible1: lote.disponible1,
                        disponible2: lote.disponible2,
                        aConsumir1:  need.total1,
                        suficiente,
                      });
                    }
                  } else {
                    // Sin lotes: mostrar fila con disponible = 0
                    itemsOpg2.push({
                      bodegaId:    bodegaConsulta,
                      referencia:  ref,
                      lote:        "",
                      disponible1: 0,
                      disponible2: 0,
                      aConsumir1:  need.total1,
                      suficiente:  false,
                    });
                    existenciasOpg2Ok = false;
                  }
                }

                if (!existenciasOpg2Ok) {
                  existenciaCheckOpg2 = { items: itemsOpg2, suficiente: false };
                  // consumoOpg2Result queda en PENDIENTE — no se envía el SPG
                } else {
                  // ── D: distribuir FIFO y construir XML de consumo OPG2 ────────
                  // Por cada referencia se consumen los lotes de más antiguo a más
                  // reciente hasta cubrir la cantidad total requerida. La cantidad2
                  // (UND) se distribuye proporcionalmente respecto a la cantidad1.
                  const fifoRows: RowXml3[] = [];

                  for (const [ref, need] of needByRef.entries()) {
                    const lotes  = lotesByRef.get(ref) ?? [];
                    let rem1     = need.total1;
                    const total1 = need.total1;

                    for (const lote of lotes) {
                      if (rem1 <= 0.00001) break;
                      if (lote.disponible1 <= 0.00001) continue;
                      const take1 = Math.min(lote.disponible1, rem1);
                      const take2 = total1 > 0 && need.total2 > 0
                        ? Math.round((need.total2 * (take1 / total1)) * 10000) / 10000
                        : 0;
                      fifoRows.push({
                        CODIGO_PRODUCTO: ref,
                        LOTE_PRODUCTO:   lote.lote,
                        BODEGA:          bodegaConsulta,
                        UNIDAD_PRODUCTO: lote.unidInv1,
                        KIL:             take1,
                        UND:             take2,
                      });
                      rem1 -= take1;
                    }
                  }

                  xml2b = buildXML2Consumo(
                    co, filtro.nombre, fecha, consecOpg2,
                    fifoRows,
                    bodegaConsulta,
                    ppCodigo,
                    filtro.motivoConsumo?.trim() ?? "",
                    ccostoConsumo,
                  );
                  await prisma.opgLog.update({ where: { id: log2Id }, data: { xml2: xml2b } });
                  consumoOpg2Result = await callSoap(xml2b);
                }
              } else {
                // Sin registros seleccionados: usar componentes del ERP (fallback)
                const opg2Componentes = await queryComponentesOP(co, "OPG", consecOpg2);
                xml2b = buildXML2(co, filtro.nombre, fecha, consecOpg2, opg2Componentes.filter((c) => c.cantidadPendiente1 > 0), PP_CON_LOTE, filtro.motivoConsumo?.trim() ?? "", ccostoConsumo);
                await prisma.opgLog.update({ where: { id: log2Id }, data: { xml2: xml2b } });
                consumoOpg2Result = await callSoap(xml2b);
              }
            } catch (e) { consumoOpg2Result = mkErr(e); }
          }

          if (consumoOpg2Result.exitoso) {

            // ── Paso 5: Filas EPG OPG2 — mismos ítems con los que se creó OPG2 ──
            // ppItems son exactamente los productos y cantidades enviados en la
            // orden de producción OPG2 (buildXML1b). La entrega debe coincidir
            // con esa planificación para que el consumo de OPG1 pueda ejecutarse.
            const rowsPP: RowXml3[] = ppItems.map((p) => ({
              CODIGO_PRODUCTO: p.codigo,
              LOTE_PRODUCTO:   p.lote,
              BODEGA:          filtro.bodegaItemPadre?.trim() ?? "",
              UNIDAD_PRODUCTO: p.unidad,
              KIL:             p.cantidad,
              UND:             0,
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
                if (lotesNuevos.length > 0) await enviarLotesIndividual(lotesNuevos, fecha);
              }
            } catch { /* continuar aunque falle la creación de lotes */ }

            // ── Paso 5b: EPG OPG2 (saltar si ya fue enviado) ────────────
            if (log2State?.estadoEntregaProduccion === "ENVIADO") {
              entregaOpg2Result = skip(log2State.respuestaEntregaProduccion);
            } else {
              try {
                xml3b = buildXML3b(co, filtro.nombre, fecha, consecOpg2, rowsPP, filtro.bodegaItemPadre, ppCodigo, filtro.motivoEntrega?.trim() ?? "", ccostoEntrega);
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
          const ppConLoteLotes: ProductoLote[] = PP_CON_LOTE.map((codigo) => ({ codigo, lote: loteJul }));
          const existentes = await prisma.loteCreado.findMany({
            where:  { OR: ppConLoteLotes.map((p) => ({ codigoProducto: p.codigo, lote: p.lote })) },
            select: { codigoProducto: true, lote: true },
          });
          const existenteSet = new Set(existentes.map((e) => `${e.codigoProducto}|${e.lote}`));
          const lotesNuevos  = ppConLoteLotes.filter((p) => !existenteSet.has(`${p.codigo}|${p.lote}`));
          if (lotesNuevos.length > 0) await enviarLotesIndividual(lotesNuevos, fecha);
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

            // ── Verificar existencias OPG1 antes de consumir ───────────────
            // Consulta WS_FENIX_EXISTENCIALOTE_OP con el número de OPG1.
            // La misma respuesta sirve tanto para saber cuánto se necesita
            // (sum Cantidad_pendiente por Bodega+Referencia) como para saber
            // cuánto hay disponible (Cantidad_disponible por Bodega+Referencia+Lote).
            // Si alguna (bodega, ref) no tiene stock suficiente se bloquea el SPG
            // y se devuelve existenciaCheck al cliente para que el usuario ajuste
            // en el ERP y reintente (transmitir(true)).
            let existenciasOk    = true;
            let lotesParaConsumo: Xml2Line[] | null = null;
            try {
              const existencias = await queryExistenciaLote(co, "OPG", consecOpg1);

              // ── Paso A: sumatoria de pendiente por (Bodega_id, Hijo_Referencia) ──
              // El WS devuelve una fila por cada línea de requerimiento de la OP;
              // las sumamos para obtener el total a consumir de esa bodega+referencia.
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

              // ── Paso B: existencias por (Bodega_id, Hijo_Referencia, Lote) ──────
              // El WS repite la misma posición de stock una vez por línea de
              // requerimiento → se deduplica conservando el mayor disponible1 visto.
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

              // ── Paso C: total disponible por (Bodega_id, Hijo_Referencia) ────────
              // Suma de disponible1 en todos los lotes de esa bodega+referencia.
              const availMap = new Map<string, number>();
              for (const pos of stockMap.values()) {
                const key = `${pos.bodegaId}\x00${pos.referencia}`;
                availMap.set(key, (availMap.get(key) ?? 0) + pos.disponible1);
              }

              // ── Paso D: construir items de comparación (uno por posición de stock) ─
              // Se redondea a 4 decimales antes de comparar para evitar falsos
              // negativos por errores de punto flotante (ej. 3494.9899999... < 3494.99).
              const r4 = (n: number) => Math.round(n * 10000) / 10000;
              const items: ExistenciaComparacion[] = [];
              for (const pos of stockMap.values()) {
                const needKey    = `${pos.bodegaId}\x00${pos.referencia}`;
                const aConsumir1 = needMap.get(needKey)?.pendiente1 ?? 0;
                const totalDisp  = availMap.get(needKey) ?? 0;
                items.push({
                  bodegaId:    pos.bodegaId,
                  referencia:  pos.referencia,
                  lote:        pos.lote,
                  disponible1: pos.disponible1,
                  disponible2: pos.disponible2,
                  aConsumir1,
                  suficiente:  r4(totalDisp) >= r4(aConsumir1),
                });
              }

              // Referencias requeridas sin ninguna posición de stock → disponible = 0
              for (const [key, need] of needMap.entries()) {
                const hasStock = [...stockMap.keys()].some((k) => k.startsWith(key + "\x00"));
                if (!hasStock && need.pendiente1 > 0) {
                  items.push({
                    bodegaId:    need.bodegaId,
                    referencia:  need.referencia,
                    lote:        "",
                    disponible1: 0,
                    disponible2: 0,
                    aConsumir1:  need.pendiente1,
                    suficiente:  false,
                  });
                }
              }

              const todoSuficiente = items.every((i) => i.suficiente);
              if (!todoSuficiente) {
                existenciaCheck = { items, suficiente: false };
                existenciasOk   = false;
                // consumoOpg1Result queda en PENDIENTE — no se envía el SPG
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
                xml2 = buildXML2ConLotes(co, filtro.nombre, fecha, consecOpg1, lotesParaConsumo, filtro.motivoConsumo?.trim() ?? "", ccostoConsumo);
              } else {
                xml2 = buildXML2(co, filtro.nombre, fecha, consecOpg1, componentes1ToConsume, PP_CON_LOTE, filtro.motivoConsumo?.trim() ?? "", ccostoConsumo);
              }
              await prisma.opgLog.update({ where: { id: log1Id }, data: { xml2 } });
              consumoOpg1Result = await callSoap(xml2);
            }
          } catch (e) { consumoOpg1Result = mkErr(e); }
        }

        // ── Paso 7: EPG OPG1 (saltar si ya fue enviado) ───────────────────
        if (consumoOpg1Result.exitoso) {
          if (log1State?.estadoEntregaProduccion === "ENVIADO") {
            entregaOpg1Result = skip(log1State.respuestaEntregaProduccion);
          } else {
            try {
              xml3 = buildXML3(co, filtro.nombre, fecha, consecOpg1, rows, filtro.bodegaItemPadre, filtro.motivoEntrega?.trim() ?? "", ccostoEntrega);
              await prisma.opgLog.update({ where: { id: log1Id }, data: { xml3 } });
              entregaOpg1Result = await callSoap(xml3);
            } catch (e) { entregaOpg1Result = mkErr(e); }
          }
        }
      }

    }

    // ── Actualizar logs ────────────────────────────────────────────────────
    // PENDIENTE const: printTipoError=-1, respuestaRaw=""  → siempre PENDIENTE
    // mkErr(e):        printTipoError=-1, respuestaRaw=msg → ERROR si depOk, PENDIENTE si no
    const mkEstado = (r: DocResult, depOk: boolean): string => {
      if (r.exitoso) return "ENVIADO";
      if (r.printTipoError === -1 && (r.respuestaRaw ?? "") === "") return "PENDIENTE";
      return depOk ? "ERROR" : "PENDIENTE";
    };

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
      xmls: { xml1b, xml2b, xml3b, xml2, xml3 },
      existenciaCheck:     existenciaCheck     ?? undefined,
      existenciaCheckOpg2: existenciaCheckOpg2 ?? undefined,
    });
  } catch (err) {
    console.error("[POST /api/export-produccion/[id]/transmit-desprese]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
