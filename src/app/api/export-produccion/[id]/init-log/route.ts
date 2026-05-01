// src/app/api/export-produccion/[id]/init-log/route.ts
// Crea (o reutiliza) el OpgLog de OPG1 tan pronto como se determina el bache,
// antes de que el usuario pulse "Transmitir al ERP".
// Todos los estados quedan en PENDIENTE.

import { NextResponse } from "next/server";
import { auth }         from "@/lib/auth";
import { prisma }       from "@/lib/prisma";
import { headers }      from "next/headers";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { id }   = await params;
    const filtroId = Number(id);
    const body     = await req.json() as { bache: number };
    const { bache } = body;

    if (!bache) return NextResponse.json({ error: "Falta el número de lote (bache)" }, { status: 400 });

    // Reutilizar log existente completamente pendiente para este filtro + bache
    const existente = await prisma.opgLog.findFirst({
      where: {
        filtroId,
        numeroBache:             String(bache),
        estadoOrdenProduccion:   "PENDIENTE",
        estadoConsumoProduccion: "PENDIENTE",
        estadoEntregaProduccion: "PENDIENTE",
      },
      orderBy: { id: "desc" },
      select:  { id: true, numeroOpg: true },
    });

    if (existente) {
      return NextResponse.json({ logId: existente.id, consecOpg: existente.numeroOpg });
    }

    // Obtener siguiente consecutivo OPG
    const rec = await prisma.consecutivo.upsert({
      where:  { tipoDocumento: "OPG" },
      create: { tipoDocumento: "OPG", consecutivo: 1 },
      update: { consecutivo: { increment: 1 } },
    });

    // Crear log con todos los estados en PENDIENTE
    const log = await prisma.opgLog.create({
      data: {
        tipoDocumento:           "OPG",
        numeroOpg:               rec.consecutivo,
        numeroBache:             String(bache),
        filtroId,
        xml1:                    "",   // se actualizará al transmitir
        estadoOrdenProduccion:   "PENDIENTE",
        estadoConsumoProduccion: "PENDIENTE",
        estadoEntregaProduccion: "PENDIENTE",
      },
    });

    return NextResponse.json({ logId: log.id, consecOpg: rec.consecutivo });
  } catch (err) {
    console.error("[POST /api/export-produccion/[id]/init-log]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
