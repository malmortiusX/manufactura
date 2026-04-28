// src/app/api/export-produccion/historial-baches/[logId]/desmarcar/route.ts
// POST — Resetea bache = 0 en Mvdcto para todos los registros que tengan
//         el mismo numeroBache que el OpgLog indicado.
//         Guarda una auditoría con la observación, usuario y fecha.

import { NextResponse } from "next/server";
import { auth }          from "@/lib/auth";
import { prisma }        from "@/lib/prisma";
import { headers }       from "next/headers";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ logId: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { logId } = await params;
  const id = Number(logId);
  if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  // Leer observación del body
  let observacion = "";
  try {
    const body = await req.json();
    observacion = String(body.observacion ?? "").trim();
  } catch { /* body vacío */ }

  if (!observacion) {
    return NextResponse.json({ error: "La observación es obligatoria" }, { status: 400 });
  }

  const log = await prisma.opgLog.findUnique({ where: { id } });
  if (!log) return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });

  const bache = Number(log.numeroBache);
  if (!bache || isNaN(bache)) {
    return NextResponse.json({ error: "El registro no tiene un bache válido" }, { status: 400 });
  }

  // Resetea todos los registros de Mvdcto con ese bache y registra la auditoría
  const rowsAfectados = await prisma.$executeRawUnsafe(
    `UPDATE Mvdcto SET bache = 0 WHERE bache = ${bache}`,
  );

  await prisma.bacheDesmarque.create({
    data: {
      logId: id,
      numeroBache:   log.numeroBache,
      observacion,
      usuarioId:     session.user.id,
      usuarioEmail:  session.user.email,
      usuarioNombre: session.user.name ?? null,
      rowsAfectados,
    },
  });

  return NextResponse.json({ ok: true, bache, rowsAfectados });
}
