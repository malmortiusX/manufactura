// src/app/api/export-produccion/[id]/results/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";

// Escapa comillas simples para SQL Server (evita inyección SQL)
function s(val: string | null | undefined): string {
  return (val ?? "").replace(/'/g, "''").trim();
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;

  const filtro = await prisma.exportProduccion.findUnique({ where: { id: Number(id) } });
  if (!filtro) return NextResponse.json({ error: "Filtro no encontrado" }, { status: 404 });

  try {
    // Manejar fecha como string o Date según lo que devuelva Prisma
    const rawFecha = filtro.fecha;
    let fecha: string;
    if (typeof rawFecha === "string") {
      fecha = (rawFecha as string).slice(0, 10);
    } else {
      const d = rawFecha as Date;
      fecha = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    }
    console.log("[FECHA RAW]", rawFecha, "[FECHA]", fecha);

    const conditions = [
      `CAST(A.Fecha AS DATE) = CAST('${s(fecha)}' AS DATE)`,
      `A.Origen = 'INV'`,
      `A.Origen = B.Origen`,
      `A.Tipodcto = B.Tipodcto`,
      `(B.CANTIDAD <> 0 OR B.CANTEMPAQ <> 0)`,
      `A.Nrodcto = B.Nrodcto`,
    ];

    // Filtros opcionales — solo se aplican si están rellenos
    if (filtro.tipoDocumento?.trim()) conditions.push(`A.Tipodcto = '${s(filtro.tipoDocumento)}'`);
    if (filtro.tipoMovimiento?.trim()) conditions.push(`B.TIPOMVTO = '${s(filtro.tipoMovimiento)}'`);
    if (filtro.bodega?.trim())         conditions.push(`B.BODEGA = '${s(filtro.bodega)}'`);
    if (filtro.ubicacion?.trim())      conditions.push(`B.CODUBICA = '${s(filtro.ubicacion)}'`);

    const sql = `
      SELECT
        B.UNDBASE                                                              AS UNIDAD_PRODUCTO,
        B.Bodega                                                               AS BODEGA,
        B.codubica                                                             AS UBICACION,
        B.CODIGO                                                               AS CODIGO_PRODUCTO,
        B.NOMBRE                                                               AS DESCRIPCION_PRODUCTO,
        B.CODLOTE                                                              AS LOTE_PRODUCTO,
        B.TRASMIT,
        SUM(CASE B.UNDBASE WHEN 'UND' THEN B.CANTEMPAQ ELSE B.CANTIDAD  END)  AS KIL,
        SUM(CASE B.UNDBASE WHEN 'UND' THEN B.CANTIDAD  ELSE B.CANTEMPAQ END)  AS UND,
        CASE
          WHEN SUM(CASE B.UNDBASE WHEN 'UND' THEN B.CANTIDAD ELSE B.CANTEMPAQ END) = 0 THEN 0
          ELSE SUM(CASE B.UNDBASE WHEN 'UND' THEN B.CANTEMPAQ ELSE B.CANTIDAD  END)
             / SUM(CASE B.UNDBASE WHEN 'UND' THEN B.CANTIDAD  ELSE B.CANTEMPAQ END)
        END                                                                    AS PROMEDIO_PESO
      FROM Dcto A, Mvdcto B
      WHERE ${conditions.join(" AND ")}
      GROUP BY B.UNDBASE, B.Bodega, B.codubica, B.CODIGO, B.NOMBRE, B.CODLOTE, B.TRASMIT
      ORDER BY B.Bodega, B.codubica, B.CODIGO
    `;

    const rows = await prisma.$queryRawUnsafe(sql);

    return NextResponse.json({ filtro, rows, sql });
  } catch (err) {
    console.error("[GET /api/export-produccion/[id]/results]", err);
    return NextResponse.json({ error: String(err), sql: err instanceof Error ? (err as unknown as Record<string, unknown>)._sql ?? null : null }, { status: 500 });
  }
}
