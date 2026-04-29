// src/app/api/export-produccion/[id]/results/route.ts
// Flujo:
//  1. Obtiene el siguiente valor de SEQ_BACHE (secuencia del ERP)
//  2. Marca los registros de Mvdcto (principales) con ese bache según los filtros
//  3. Si el filtro tiene campos de consumo, marca también esos registros con el mismo bache
//  4. Consulta los registros principales marcados (con condiciones del filtro para desambiguar)
//  5. Consulta los registros de consumo marcados (si aplica)
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

// Columnas agrupadas (para productos terminados)
const selectCols = `
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
  END AS PROMEDIO_PESO`;

const groupBy = `B.UNDBASE, B.Bodega, B.codubica, B.CODIGO, B.NOMBRE, B.CODLOTE, B.bache`;
const orderBy = `B.Bodega, B.codubica, B.CODIGO`;

// Columnas OPG1 — agrupadas solo por UNDBASE+CODIGO+bache (sin bodega/ubicación/lote)
const selectColsOpg1 = `
  B.UNDBASE   AS UNIDAD_PRODUCTO,
  B.CODIGO    AS CODIGO_PRODUCTO,
  B.bache,
  SUM(CASE B.UNDBASE WHEN 'UND' THEN B.CANTEMPAQ ELSE B.CANTIDAD  END) AS KIL,
  SUM(CASE B.UNDBASE WHEN 'UND' THEN B.CANTIDAD  ELSE B.CANTEMPAQ END) AS UND`;
const groupByOpg1 = `B.UNDBASE, B.CODIGO, B.bache`;

// Columnas individuales (para consumo — sin GROUP BY)
const selectColsIndividual = `
  B.UNDBASE   AS UNIDAD_PRODUCTO,
  B.Bodega    AS BODEGA,
  B.codubica  AS UBICACION,
  B.CODIGO    AS CODIGO_PRODUCTO,
  B.NOMBRE    AS DESCRIPCION_PRODUCTO,
  B.CODLOTE   AS LOTE_PRODUCTO,
  B.bache,
  CASE B.UNDBASE WHEN 'UND' THEN B.CANTEMPAQ ELSE B.CANTIDAD  END AS KIL,
  CASE B.UNDBASE WHEN 'UND' THEN B.CANTIDAD  ELSE B.CANTEMPAQ END AS UND,
  CASE
    WHEN (CASE B.UNDBASE WHEN 'UND' THEN B.CANTIDAD ELSE B.CANTEMPAQ END) = 0 THEN 0
    ELSE (CASE B.UNDBASE WHEN 'UND' THEN B.CANTEMPAQ ELSE B.CANTIDAD  END)
       / (CASE B.UNDBASE WHEN 'UND' THEN B.CANTIDAD  ELSE B.CANTEMPAQ END)
  END AS PROMEDIO_PESO`;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;

  const filtro = await prisma.exportProduccion.findUnique({ where: { id: Number(id) } });
  if (!filtro) return NextResponse.json({ error: "Filtro no encontrado" }, { status: 404 });

  const fecha = parseFecha(filtro.fecha);

  // ── WHERE principal ────────────────────────────────────────────────────────
  const whereConditions = [
    `CAST(A.Fecha AS DATE) = CAST('${s(fecha)}' AS DATE)`,
    `A.Origen = 'INV'`,
    `A.Origen   = B.Origen`,
    `A.Tipodcto = B.Tipodcto`,
    `A.Nrodcto  = B.Nrodcto`,
    `(B.CANTIDAD <> 0 OR B.CANTEMPAQ <> 0)`,
    `(B.bache = 0 OR B.bache IS NULL)`,   // excluir registros ya exportados
  ];
  if (filtro.tipoDocumento?.trim()) whereConditions.push(`A.Tipodcto  = '${s(filtro.tipoDocumento)}'`);
  if (filtro.tipoMovimiento?.trim()) whereConditions.push(`B.TIPOMVTO  = '${s(filtro.tipoMovimiento)}'`);
  if (filtro.bodega?.trim())         whereConditions.push(`B.BODEGA    = '${s(filtro.bodega)}'`);
  if (filtro.ubicacion?.trim())      whereConditions.push(`B.CODUBICA  = '${s(filtro.ubicacion)}'`);

  const where = whereConditions.join("\n  AND ");

  // ── WHERE consumo (si tiene campos de consumo configurados) ───────────────
  const hasConsumo =
    !!(filtro.bodegaConsumo?.trim() || filtro.ubicacionConsumo?.trim() ||
       filtro.tipoDocumentoConsumo?.trim() || filtro.tipoMovimientoConsumo?.trim());

  const whereConsumoConditions = [
    `CAST(A.Fecha AS DATE) = CAST('${s(fecha)}' AS DATE)`,
    `A.Origen = 'INV'`,
    `A.Origen   = B.Origen`,
    `A.Tipodcto = B.Tipodcto`,
    `A.Nrodcto  = B.Nrodcto`,
    `(B.CANTIDAD <> 0 OR B.CANTEMPAQ <> 0)`,
    `(B.bache = 0 OR B.bache IS NULL)`,   // excluir registros ya exportados
  ];
  if (filtro.tipoDocumentoConsumo?.trim())  whereConsumoConditions.push(`A.Tipodcto  = '${s(filtro.tipoDocumentoConsumo)}'`);
  if (filtro.tipoMovimientoConsumo?.trim()) whereConsumoConditions.push(`B.TIPOMVTO  = '${s(filtro.tipoMovimientoConsumo)}'`);
  if (filtro.bodegaConsumo?.trim())         whereConsumoConditions.push(`B.BODEGA    = '${s(filtro.bodegaConsumo)}'`);
  if (filtro.ubicacionConsumo?.trim())      whereConsumoConditions.push(`B.CODUBICA  = '${s(filtro.ubicacionConsumo)}'`);

  const whereConsumo = whereConsumoConditions.join("\n  AND ");

  // Condiciones extra para el SELECT principal (desambiguación cuando hay registros de consumo)
  const mainExtra: string[] = [];
  if (filtro.bodega?.trim())         mainExtra.push(`B.BODEGA   = '${s(filtro.bodega)}'`);
  if (filtro.ubicacion?.trim())      mainExtra.push(`B.CODUBICA = '${s(filtro.ubicacion)}'`);
  if (filtro.tipoMovimiento?.trim()) mainExtra.push(`B.TIPOMVTO = '${s(filtro.tipoMovimiento)}'`);
  if (filtro.tipoDocumento?.trim())  mainExtra.push(`B.Tipodcto = '${s(filtro.tipoDocumento)}'`);
  const mainExtraWhere = mainExtra.length ? "\n  AND " + mainExtra.join("\n  AND ") : "";

  // Condiciones extra para el SELECT consumo
  const consumoExtra: string[] = [];
  if (filtro.bodegaConsumo?.trim())         consumoExtra.push(`B.BODEGA   = '${s(filtro.bodegaConsumo)}'`);
  if (filtro.ubicacionConsumo?.trim())      consumoExtra.push(`B.CODUBICA = '${s(filtro.ubicacionConsumo)}'`);
  if (filtro.tipoMovimientoConsumo?.trim()) consumoExtra.push(`B.TIPOMVTO = '${s(filtro.tipoMovimientoConsumo)}'`);
  if (filtro.tipoDocumentoConsumo?.trim())  consumoExtra.push(`B.Tipodcto = '${s(filtro.tipoDocumentoConsumo)}'`);
  const consumoExtraWhere = consumoExtra.length ? "\n  AND " + consumoExtra.join("\n  AND ") : "";

  try {
    const { bache, rows, rowsConsumo, rowsOpg1 } = await prisma.$transaction(async (tx) => {

      // 1. Obtener el siguiente bache de la secuencia del ERP
      const [bacheRow] = await tx.$queryRawUnsafe<{ bache: number | bigint }[]>(
        "SELECT NEXT VALUE FOR SEQ_BACHE AS bache"
      );
      const bache = Number(bacheRow.bache);

      // 2. Marcar los registros principales con el bache
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

      // 3. Marcar los registros de consumo con el mismo bache (si aplica)
      if (hasConsumo) {
        const updateConsumoSql = `
          UPDATE B
          SET    B.bache = ${bache}
          FROM   Mvdcto B
          INNER JOIN Dcto A
            ON  A.Nrodcto  = B.Nrodcto
            AND A.Origen   = B.Origen
            AND A.Tipodcto = B.Tipodcto
          WHERE ${whereConsumo}
        `;
        await tx.$executeRawUnsafe(updateConsumoSql);
      }

      // 4. Consultar registros principales (con condiciones de desambiguación)
      const selectSql = `
        SELECT ${selectCols}
        FROM Mvdcto B
        WHERE B.bache = ${bache}
          AND (B.CANTIDAD <> 0 OR B.CANTEMPAQ <> 0)${mainExtraWhere}
        GROUP BY ${groupBy}
        ORDER BY ${orderBy}
      `;
      const rows = await tx.$queryRawUnsafe(selectSql);

      // 4b. Consultar agrupado para OPG1 XML (sin bodega/ubicación/lote)
      const selectOpg1Sql = `
        SELECT ${selectColsOpg1}
        FROM Mvdcto B
        WHERE B.bache = ${bache}
          AND (B.CANTIDAD <> 0 OR B.CANTEMPAQ <> 0)${mainExtraWhere}
        GROUP BY ${groupByOpg1}
        ORDER BY B.CODIGO
      `;
      const rowsOpg1 = await tx.$queryRawUnsafe(selectOpg1Sql);

      // 5. Consultar registros de consumo individualmente (sin GROUP BY)
      let rowsConsumo: unknown[] = [];
      if (hasConsumo) {
        const selectConsumoSql = `
          SELECT ${selectColsIndividual}
          FROM Mvdcto B
          WHERE B.bache = ${bache}
            AND (B.CANTIDAD <> 0 OR B.CANTEMPAQ <> 0)${consumoExtraWhere}
          ORDER BY ${orderBy}
        `;
        rowsConsumo = await tx.$queryRawUnsafe(selectConsumoSql);
      }

      return { bache, rows, rowsConsumo, rowsOpg1 };
    }, { timeout: 30_000 });

    return NextResponse.json({ filtro, bache, rows, rowsConsumo, rowsOpg1 });

  } catch (err) {
    console.error("[POST /api/export-produccion/[id]/results]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
