// src/app/api/export-produccion/[id]/results/route.ts
// Flujo:
//  1. Obtiene el siguiente valor de SEQ_BACHE (secuencia del ERP)
//  2. Marca los registros de Mvdcto con ese bache según los filtros
//  3. Consulta los registros marcados con el bache
// Todo dentro de una transacción para garantizar consistencia.

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";

function s(val: string | null | undefined): string {
  return (val ?? "").replace(/'/g, "''").trim();
}

function parseFecha(raw: Date | string): string {
  if (typeof raw === "string") return raw.slice(0, 10);
  return `${raw.getUTCFullYear()}-${String(raw.getUTCMonth() + 1).padStart(2, "0")}-${String(raw.getUTCDate()).padStart(2, "0")}`;
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;

  const filtro = await prisma.exportProduccion.findUnique({ where: { id: Number(id) } });
  if (!filtro) return NextResponse.json({ error: "Filtro no encontrado" }, { status: 404 });

  const fecha = parseFecha(filtro.fecha);

  // Condiciones WHERE compartidas por el UPDATE y usadas para descripción
  const whereConditions = [
    `CAST(A.Fecha AS DATE) = CAST('${s(fecha)}' AS DATE)`,
    `A.Origen = 'INV'`,
    `A.Origen   = B.Origen`,
    `A.Tipodcto = B.Tipodcto`,
    `A.Nrodcto  = B.Nrodcto`,
    `(B.CANTIDAD <> 0 OR B.CANTEMPAQ <> 0)`,
  ];

  if (filtro.tipoDocumento?.trim()) whereConditions.push(`A.Tipodcto  = '${s(filtro.tipoDocumento)}'`);
  if (filtro.tipoMovimiento?.trim()) whereConditions.push(`B.TIPOMVTO  = '${s(filtro.tipoMovimiento)}'`);
  if (filtro.bodega?.trim())         whereConditions.push(`B.BODEGA    = '${s(filtro.bodega)}'`);
  if (filtro.ubicacion?.trim())      whereConditions.push(`B.CODUBICA  = '${s(filtro.ubicacion)}'`);

  const where = whereConditions.join("\n  AND ");

  try {
    const { bache, rows } = await prisma.$transaction(async (tx) => {

      // 1. Obtener el siguiente bache de la secuencia del ERP
      const [bacheRow] = await tx.$queryRawUnsafe<{ bache: number | bigint }[]>(
        "SELECT NEXT VALUE FOR SEQ_BACHE AS bache"
      );
      const bache = Number(bacheRow.bache);

      // 2. Marcar los registros de Mvdcto con el bache
      const updateSql = `
        UPDATE B
        SET    B.bache = ${bache}
        FROM   Mvdcto B
        INNER JOIN Dcto A
          ON  A.Nrodcto  = B.Nrodcto
          AND A.Origen   = B.Origen
          AND A.Tipodcto = B.Tipodcto
        WHERE ${where}
      `;
      await tx.$executeRawUnsafe(updateSql);

      // 3. Consultar los registros recién marcados con el bache
      const selectSql = `
        SELECT
          B.UNDBASE   AS UNIDAD_PRODUCTO,
          B.Bodega    AS BODEGA,
          B.codubica  AS UBICACION,
          B.CODIGO    AS CODIGO_PRODUCTO,
          B.NOMBRE    AS DESCRIPCION_PRODUCTO,
          B.CODLOTE   AS LOTE_PRODUCTO,
          B.bache,
          SUM(CASE B.UNDBASE WHEN 'UND' THEN B.CANTEMPAQ ELSE B.CANTIDAD  END) AS KIL,
          SUM(CASE B.UNDBASE WHEN 'UND' THEN B.CANTIDAD  ELSE B.CANTEMPAQ END) AS UND,
          CASE
            WHEN SUM(CASE B.UNDBASE WHEN 'UND' THEN B.CANTIDAD ELSE B.CANTEMPAQ END) = 0 THEN 0
            ELSE SUM(CASE B.UNDBASE WHEN 'UND' THEN B.CANTEMPAQ ELSE B.CANTIDAD  END)
               / SUM(CASE B.UNDBASE WHEN 'UND' THEN B.CANTIDAD  ELSE B.CANTEMPAQ END)
          END AS PROMEDIO_PESO
        FROM Mvdcto B
        WHERE B.bache = ${bache}
          AND (B.CANTIDAD <> 0 OR B.CANTEMPAQ <> 0)
        GROUP BY B.UNDBASE, B.Bodega, B.codubica, B.CODIGO, B.NOMBRE, B.CODLOTE, B.bache
        ORDER BY B.Bodega, B.codubica, B.CODIGO
      `;
      const rows = await tx.$queryRawUnsafe(selectSql);

      return { bache, rows };
    });

    return NextResponse.json({ filtro, bache, rows });

  } catch (err) {
    console.error("[POST /api/export-produccion/[id]/results]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
