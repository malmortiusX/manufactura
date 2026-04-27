// src/app/api/export-produccion/[id]/transmit/route.ts
// Flujo:
//  1. Crea un registro inicial en OpgLog
//  2. Envía XML1 (Orden de Producción) al ERP
//  3. Si es exitoso, consulta los componentes de la OP creada
//  4. Construye y envía XML2 (Consumo de Producción) con los componentes
//  5. Envía XML3 (Entrega de Producción) — pendiente de definición
//  6. Actualiza el OpgLog con todos los estados y respuestas

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

// ── Utilidades de formato (server-side) ───────────────────────────────────
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

// ── XML2 — Consumo de Producción (tipo 450 / 470) ────────────────────────
// Estructura:
//   Línea 1 : 000000100000001001  (fija)
//   Línea 2 : encabezado tipo 450 (344 chars)
//   Líneas 3…N+2 : componentes tipo 470 (2673 chars cada uno)
//   Línea N+3 : cierre
function buildXML2(
  centroOperacion:  string,
  nombre:           string,
  fecha:            string,                    // YYYYMMDD
  consecOpg:        number,
  componentes:      ComponenteOP[],
  lotesPorProducto: Record<string, string>,   // { codigoProducto: lote }
  productoProceso: string[] = ["PI00001"],   // códigos de productos en proceso que llevan lote
): string {
  const opening = "000000100000001001";

  // ── Encabezado tipo 450 (344 chars) ─────────────────────────────────────
  // Longitudes: 7+4+2+2+3+1+3+3+8+8+1+1+3+15+255+2+15+3+8 = 344
  const encabezado =
    pN(2,   7) +                   // F_NUMERO-REG        = 2
    pN(450, 4) +                   // F_TIPO-REG          = 450
    pN(3,   2) +                   // F_SUBTIPO-REG       = 3
    pN(1,   2) +                   // F_VERSION-REG       = 1
    pN(1,   3) +                   // F_CIA               = 1
    pN(1,   1) +                   // F_CONSEC_AUTO_REG   = 1 (automático)
    pA(centroOperacion, 3) +       // f350_id_co
    pA("SCG",           3) +       // f350_id_tipo_docto  = SCG
    pN(1,   8) +                   // f350_consec_docto   = 1 (ERP asigna)
    pA(fecha,           8) +       // f350_id_fecha       YYYYMMDD
    pN(1,   1) +                   // f350_ind_estado     = 1
    pN(0,   1) +                   // f350_ind_impresion  = 0
    pN(710, 3) +                   // f350_id_clase_docto = 710
    pA("",             15) +       // f350_docto_alterno
    pA(nombre,        255) +       // f350_notas
    pA("01",            2) +       // f350_id_motivo      = 01
    pA("",             15) +       // f350_id_proyecto
    pA("OPG",           3) +       // f850_tipo_docto     = OPG
    pN(consecOpg,       8);        // f850_consec_docto   (nro de la OP creada)

  // ── Líneas de componentes tipo 470 (2673 chars c/u) ──────────────────────
  // Longitudes: 7+4+2+2+3+3+3+8+10+7+50+20+20+20+10+7+50+20+20+20+5+10+15+3+2+3+20+15+15+4+20+20+255+2000 = 2673
  const productLines = componentes.map((comp, i) => {
    // Solo los productos en proceso llevan lote; los demás componentes van en blanco.
    const esPi = productoProceso.includes(comp.hijoReferencia.trim());
    const lotePadre = esPi ? (lotesPorProducto[comp.padreReferencia.trim()] ?? "") : "";

    return (
    pN(i + 3,  7) +                // F_NUMERO-REG        (3, 4, 5…)
    pN(470,    4) +                // F_TIPO-REG          = 470
    pN(0,      2) +                // F_SUBTIPO-REG       = 00
    pN(4,      2) +                // F_VERSION-REG       = 4
    pN(1,      3) +                // F_CIA               = 1
    pA(centroOperacion,  3) +      // f470_id_co
    pA("SCG",            3) +      // f470_id_tipo_docto  = SCG
    pN(1,      8) +                // f470_consec_docto   = 1 (coincide con encabezado)
    pN(i + 1, 10) +                // f470_nro_registro   (1, 2, 3…)
    pN(0,      7) +                // f470_id_item_padre  (vacío)
    pA(comp.padreReferencia, 50) + // f470_referencia_item_padre
    pA("",    20) +                // f470_codigo_barras_padre
    pA("",    20) +                // f470_id_ext1_detalle_padre
    pA("",    20) +                // f470_id_ext2_detalle_padre
    pN(0,     10) +                // f470_numero_operacion (vacío)
    pN(0,      7) +                // f470_id_item_comp   (vacío)
    pA(comp.hijoReferencia,  50) + // f470_referencia_item_comp
    pA("",    20) +                // f470_codigo_barras_comp
    pA("",    20) +                // f470_id_ext1_detalle_comp
    pA("",    20) +                // f470_id_ext2_detalle_comp
    pA(comp.bodegaId,   5) +       // f470_id_bodega
    pA("",    10) +                // f470_id_ubicacion_aux
    pA(lotePadre,       15) +      // f470_id_lote  ← lote del Padre_Referencia
    pN(701,    3) +                // f470_id_concepto    = 701
    pA("01",   2) +                // f470_id_motivo      = 01
    pA(centroOperacion,  3) +      // f470_id_co_movto
    pA("31",  20) +                // f470_id_un_movto
    pA("70010401", 15) +           // f470_id_ccosto_movto
    pA("",    15) +                // f470_id_proyecto
    pA(comp.hijoUnidad,  4) +      // f470_id_unidad_medida
    pQ(comp.cantidadPendiente1, 15, 4) + // f470_cant_base  (20 chars)
    pQ(0,     15, 4) +             // f470_cant_2         (20 chars)
    pA("",   255) +                // f470_notas
    pA("",  2000)                  // f470_desc_varible
  );});

  const closingNum = componentes.length + 3;
  const closing = pN(closingNum, 7) + "9999" + "00" + "01" + "001";

  return [opening, encabezado, ...productLines, closing].join("\n");
}

// ── XML3 — Entrega de Producción (tipo 450-01 / 470-02) ──────────────────
// Usa las mismas filas de la orden (XML1): mismos productos, mismas cantidades.
// Estructura:
//   Línea 1   : 000000100000001001  (fija)
//   Línea 2   : encabezado tipo 450 subtipo 01 (816 chars)
//   Líneas 3…N+2 : productos tipo 470 subtipo 02 (2766 chars cada uno)
//   Línea N+3 : cierre

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
  fecha:           string,          // YYYYMMDD
  consecOpg:       number,
  rows:            RowXml3[],
  bodegaItemPadre: string | null | undefined,
): string {
  const opening = "000000100000001001";

  // ── Encabezado tipo 450, subtipo 01, versión 01 (816 chars) ─────────────
  // Longitudes: 7+4+2+2+3+1+3+3+8+8+1+1+255+3+15+10+15+3+15+50+15+30+15+20+20+20+255+2+15+15 = 816
  const encabezado =
    pN(2,    7) +                  // F_NUMERO-REG        = 2
    pN(450,  4) +                  // F_TIPO-REG          = 450
    pN(1,    2) +                  // F_SUBTIPO-REG       = 01
    pN(1,    2) +                  // F_VERSION-REG       = 01
    pN(1,    3) +                  // F_CIA               = 1
    pN(1,    1) +                  // F_CONSEC_AUTO_REG   = 1 (automático)
    pA(centroOperacion,   3) +     // f350_id_co
    pA("EPG",             3) +     // f350_id_tipo_docto  = EPG
    pN(1,    8) +                  // f350_consec_docto   = 1 (ERP asigna)
    pA(fecha,             8) +     // f350_fecha          YYYYMMDD
    pN(1,    1) +                  // f350_ind_estado     = 1
    pN(0,    1) +                  // f350_ind_impresion  = 0
    pA(nombre,          255) +     // f350_notas
    pN(720,  3) +                  // f350_id_clase_docto = 720
    pA("",   15) +                 // f450_docto_alterno
    pA("",   10) +                 // f462_id_vehiculo
    pA("",   15) +                 // f462_id_tercero_transp
    pA("",    3) +                 // f462_id_sucursal_transp
    pA("",   15) +                 // f462_id_tercero_conductor
    pA("",   50) +                 // f462_nombre_conductor
    pA("",   15) +                 // f462_identif_conductor
    pA("",   30) +                 // f462_numero_guia
    pN(0,    15) +                 // f462_cajas
    pQ(0,    15, 4) +              // f462_peso           (20 chars)
    pQ(0,    15, 4) +              // f462_volumen        (20 chars)
    pQ(0,    15, 4) +              // f462_valor_seguros  (20 chars)
    pA("",  255) +                 // f462_notas
    pA("01",  2) +                 // f350_id_motivo_consumo = 01
    pA("",   15) +                 // f350_id_proyecto_consumo
    pA("70010101", 15);            // f350_id_ccosto_consumo = 70010101

  // ── Líneas de producto tipo 470, subtipo 02, versión 02 (2766 chars c/u) ──
  // Longitudes: 7+4+2+2+3+3+3+8+10+3+8+7+50+20+20+20+7+50+20+20+20+5+10+15+3+2+2+3+20+15+15+20+20+20+20+255+2000+40+4+10 = 2766
  const productLines = rows.map((row, i) => {
    const bodega = pA((bodegaItemPadre ?? row.BODEGA)?.trim(), 5);
    return (
      pN(i + 3,  7) +              // F_NUMERO-REG        (3, 4, 5…)
      pN(470,    4) +              // F_TIPO-REG          = 470
      pN(2,      2) +              // F_SUBTIPO-REG       = 02
      pN(2,      2) +              // F_VERSION-REG       = 02
      pN(1,      3) +              // F_CIA               = 1
      pA(centroOperacion,   3) +   // f470_id_co
      pA("EPG",             3) +   // f470_id_tipo_docto  = EPG
      pN(1,      8) +              // f470_consec_docto   = 1 (coincide con encabezado)
      pN(i + 1, 10) +              // f470_nro_registro   (1, 2, 3…)
      pA("OPG",             3) +   // f850_id_tipo_docto  = OPG
      pN(consecOpg,         8) +   // f850_consec_docto   (nro de la OP)
      pN(0,      7) +              // f470_id_item        (vacío)
      pA(row.CODIGO_PRODUCTO, 50) + // f470_referencia_item
      pA("",    20) +              // f470_codigo_barras
      pA("",    20) +              // f470_id_ext1_detalle
      pA("",    20) +              // f470_id_ext2_detalle
      pN(0,      7) +              // f470_id_item_otros  (vacío)
      pA("",    50) +              // f470_referencia_item_otros
      pA("",    20) +              // f470_codigo_barras_otros
      pA("",    20) +              // f470_id_ext1_detalle_otros
      pA("",    20) +              // f470_id_ext2_detalle_otros
      bodega +                     // f470_id_bodega      (5 chars)
      pA("",    10) +              // f470_id_ubicacion_aux
      pA(row.LOTE_PRODUCTO, 15) +  // f470_id_lote
      pN(701,    3) +              // f470_id_concepto    = 701
      pA("03",   2) +              // f470_id_motivo_entrega = 03
      pA("",     2) +              // f470_id_motivo_rechazo
      pA(centroOperacion,   3) +   // f470_id_co_movto
      pA("31",  20) +              // f470_id_un_movto
      pA("70010401",       15) +   // f470_id_ccosto_movto
      pA("",    15) +              // f470_id_proyecto
      pQ(Number(row.KIL), 15, 4) + // f470_cant_base_entrega  (20 chars)
      pQ(Number(row.UND), 15, 4) + // f470_cant_2_entrega     (20 chars)
      pQ(0,     15, 4) +           // f470_cant_base_rechazo  (20 chars)
      pQ(0,     15, 4) +           // f470_cant_2_rechazo     (20 chars)
      pA("",   255) +              // f470_notas
      pA("",  2000) +              // f470_desc_varible
      pA("",    40) +              // f_desc_item
      pA(row.UNIDAD_PRODUCTO, 4) + // f_id_um_inventario
      pN(0,     10)                // f_nro_reg_item_padre
    );
  });

  const closingNum = rows.length + 3;
  const closing = pN(closingNum, 7) + "9999" + "00" + "01" + "001";

  return [opening, encabezado, ...productLines, closing].join("\n");
}

// ── POST handler ───────────────────────────────────────────────────────────
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { id } = await params;
    const filtroId = Number(id);

    // Obtener el filtro para construir XML2 server-side
    const filtro = await prisma.exportProduccion.findUnique({ where: { id: filtroId } });
    if (!filtro) return NextResponse.json({ error: "Filtro no encontrado" }, { status: 404 });

    const body = await req.json() as {
      bache:             number;
      consecOpg:         number;
      xml1:              string;
      lotesPorProducto:  Record<string, string>; // { codigoProducto: lote }
      rows:              RowXml3[];              // filas de la orden (para XML3)
      productoProceso?:  string[];               // códigos que llevan lote en XML2 vía SOAP (default ["PI00001"])
      xml2Prefabricado?: string;                 // XML2 ya construido (omite consulta SOAP — usado por Entrada Desprese)
    };
    const { bache, consecOpg, xml1, lotesPorProducto = {}, rows = [], productoProceso = ["PI00001"], xml2Prefabricado } = body;

    if (!bache)     return NextResponse.json({ error: "Falta el número de lote (bache)" },  { status: 400 });
    if (!consecOpg) return NextResponse.json({ error: "Falta el consecutivo (consecOpg)" }, { status: 400 });

    const numeroOpg = consecOpg;

    // Fecha del filtro en YYYYMMDD
    const fechaYMD = (raw: Date | string): string => {
      const s = typeof raw === "string" ? raw : raw.toISOString();
      return s.slice(0, 10).replace(/-/g, "");
    };
    const fecha = fechaYMD(filtro.fecha);

    // 1. Crear registro inicial en OpgLog (xml2/xml3 se actualizarán después)
    const log = await prisma.opgLog.create({
      data: {
        tipoDocumento: "OPG",
        numeroOpg,
        numeroBache:  String(bache),
        filtroId,
        xml1,
        estadoOrdenProduccion:   "PENDIENTE",
        estadoConsumoProduccion: "PENDIENTE",
        estadoEntregaProduccion: "PENDIENTE",
      },
    });

    // 2. Enviar XML1 — Orden de Producción
    const pendiente: DocResult = { exitoso: false, printTipoError: -1, errores: [], respuestaRaw: "" };
    let ordenResult:   DocResult = pendiente;
    let consumoResult: DocResult = pendiente;
    let entregaResult: DocResult = pendiente;
    let xml2 = "";
    let xml3 = "";
    let componentes: ComponenteOP[] = [];

    try { ordenResult = await callSoap(xml1); }
    catch (e) { ordenResult = { exitoso: false, printTipoError: -1, errores: [], respuestaRaw: String(e) }; }

    // 3. Si la orden fue exitosa, construir/usar XML2 y enviarlo
    if (ordenResult.exitoso) {
      try {
        if (xml2Prefabricado) {
          // Entrada Desprese: XML2 llega ya construido desde el cliente (sin consulta SOAP)
          xml2 = xml2Prefabricado;
        } else {
          // Salida Desprese / Salida Beneficio: consultar componentes en ERP y construir XML2
          componentes = await queryComponentesOP(
            filtro.centroOperacion?.trim() ?? "",
            "OPG",
            consecOpg,
          );

          xml2 = buildXML2(
            filtro.centroOperacion?.trim() ?? "",
            filtro.nombre,
            fecha,
            consecOpg,
            componentes,
            lotesPorProducto,
            productoProceso,
          );
        }

        // Persistir XML2 en el log
        await prisma.opgLog.update({ where: { id: log.id }, data: { xml2 } });

        consumoResult = await callSoap(xml2);
      } catch (e) {
        consumoResult = { exitoso: false, printTipoError: -1, errores: [], respuestaRaw: String(e) };
      }
    }

    // 4. Si consumo fue exitoso, construir y enviar XML3 — Entrega de Producción
    if (ordenResult.exitoso && consumoResult.exitoso) {
      try {
        xml3 = buildXML3(
          filtro.centroOperacion?.trim() ?? "",
          filtro.nombre,
          fecha,
          consecOpg,
          rows,
          filtro.bodegaItemPadre,
        );

        // Persistir XML3 en el log
        await prisma.opgLog.update({ where: { id: log.id }, data: { xml3 } });

        entregaResult = await callSoap(xml3);
      } catch (e) {
        entregaResult = { exitoso: false, printTipoError: -1, errores: [], respuestaRaw: String(e) };
      }
    }

    const estadoOrden   = ordenResult.exitoso   ? "ENVIADO" : "ERROR";
    const estadoConsumo = consumoResult.exitoso  ? "ENVIADO"
      : (consumoResult.printTipoError === -1 && !ordenResult.exitoso ? "PENDIENTE" : "ERROR");
    const estadoEntrega = entregaResult.exitoso  ? "ENVIADO"
      : (entregaResult.printTipoError === -1 && (!ordenResult.exitoso || !consumoResult.exitoso) ? "PENDIENTE" : "ERROR");

    // 5. Actualizar log con todos los resultados
    await prisma.opgLog.update({
      where: { id: log.id },
      data: {
        xml3,
        estadoOrdenProduccion:      estadoOrden,
        estadoConsumoProduccion:    estadoConsumo,
        estadoEntregaProduccion:    estadoEntrega,
        respuestaOrdenProduccion:   ordenResult.respuestaRaw,
        respuestaConsumoProduccion: consumoResult.respuestaRaw,
        respuestaEntregaProduccion: entregaResult.respuestaRaw,
        intentos: { increment: 1 },
      },
    });

    return NextResponse.json({
      logId: log.id,
      numeroOpg,
      xml2,   // devueltos para que la página los muestre
      xml3,
      orden:   { exitoso: ordenResult.exitoso,   errores: ordenResult.errores,   estado: estadoOrden },
      consumo: { exitoso: consumoResult.exitoso,  errores: consumoResult.errores, estado: estadoConsumo },
      entrega: { exitoso: entregaResult.exitoso,  errores: entregaResult.errores, estado: estadoEntrega },
    });
  } catch (err) {
    console.error("[POST /api/export-produccion/[id]/transmit]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
