// src/app/api/export-produccion/[id]/transmit/route.ts
// Flujo:
//  1. Crea un registro en OpgLog con los XMLs y el bache
//  2. Envía cada XML al ERP vía SOAP y parsea la respuesta
//  3. Actualiza el OpgLog con el estado y los errores de cada documento

import { NextResponse } from "next/server";
import { auth }         from "@/lib/auth";
import { prisma }       from "@/lib/prisma";
import { headers }      from "next/headers";
import { callSoap, type DocResult } from "@/lib/erp-soap";

export type { ErpError, DocResult } from "@/lib/erp-soap";

// ── POST handler ───────────────────────────────────────────────────────────
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { id } = await params;
    const filtroId = Number(id);

    const body = await req.json() as {
      bache: number; consecOpg: number;
      xml1: string; xml2: string; xml3: string;
    };
    const { bache, consecOpg, xml1, xml2, xml3 } = body;

    if (!bache)     return NextResponse.json({ error: "Falta el número de lote (bache)" },    { status: 400 });
    if (!consecOpg) return NextResponse.json({ error: "Falta el consecutivo (consecOpg)" },   { status: 400 });

    const numeroOpg = consecOpg;

    // 1. Crear registro inicial en OpgLog
    const log = await prisma.opgLog.create({
      data: {
        tipoDocumento: "OPG",
        numeroOpg,
        numeroBache:  String(bache),
        filtroId,
        xml1,
        xml2,
        xml3,
        estadoOrdenProduccion:   "PENDIENTE",
        estadoConsumoProduccion: "PENDIENTE",
        estadoEntregaProduccion: "PENDIENTE",
      },
    });

    // 2. Enviar documentos al ERP
    const pendiente: DocResult = { exitoso: false, printTipoError: -1, errores: [], respuestaRaw: "" };
    let ordenResult:   DocResult = pendiente;
    let consumoResult: DocResult = pendiente;
    let entregaResult: DocResult = pendiente;

    try { ordenResult  = await callSoap(xml1); }
    catch (e) { ordenResult  = { exitoso: false, printTipoError: -1, errores: [], respuestaRaw: String(e) }; }

    if (ordenResult.exitoso) {
      try { consumoResult = await callSoap(xml2); }
      catch (e) { consumoResult = { exitoso: false, printTipoError: -1, errores: [], respuestaRaw: String(e) }; }
    }

    if (ordenResult.exitoso && consumoResult.exitoso) {
      try { entregaResult = await callSoap(xml3); }
      catch (e) { entregaResult = { exitoso: false, printTipoError: -1, errores: [], respuestaRaw: String(e) }; }
    }

    const estadoOrden   = ordenResult.exitoso   ? "ENVIADO" : "ERROR";
    const estadoConsumo = consumoResult.exitoso  ? "ENVIADO"
      : (consumoResult.printTipoError === -1 && !ordenResult.exitoso ? "PENDIENTE" : "ERROR");
    const estadoEntrega = entregaResult.exitoso  ? "ENVIADO"
      : (entregaResult.printTipoError === -1 && (!ordenResult.exitoso || !consumoResult.exitoso) ? "PENDIENTE" : "ERROR");

    // 3. Actualizar log
    await prisma.opgLog.update({
      where: { id: log.id },
      data: {
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
      orden:   { exitoso: ordenResult.exitoso,   errores: ordenResult.errores,   estado: estadoOrden },
      consumo: { exitoso: consumoResult.exitoso,  errores: consumoResult.errores, estado: estadoConsumo },
      entrega: { exitoso: entregaResult.exitoso,  errores: entregaResult.errores, estado: estadoEntrega },
    });
  } catch (err) {
    console.error("[POST /api/export-produccion/[id]/transmit]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
