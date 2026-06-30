// src/app/api/export-produccion/[id]/resume-bache/route.ts
// Lee los datos de un bache ya marcado sin crear nuevas marcas.
// GET ?bache=X
// Devuelve: filtro, bache, logId1, consecOpg1, logId2?, consecOpg2?, log1, log2?, rows, rowsOpg1, rowsConsumo

import { NextResponse }        from "next/server";
import { auth }                from "@/lib/auth";
import { prisma }              from "@/lib/prisma";
import { headers }             from "next/headers";
import { queryExistenciaLote } from "@/lib/erp-soap";

function s(val: string | null | undefined): string {
  return (val ?? "").replace(/'/g, "''").trim();
}

function parseFecha(raw: Date | string): string {
  if (typeof raw === "string") return raw.slice(0, 10);
  return `${raw.getUTCFullYear()}-${String(raw.getUTCMonth() + 1).padStart(2, "0")}-${String(raw.getUTCDate()).padStart(2, "0")}`;
}

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

const selectColsOpg1 = `
  B.UNDBASE   AS UNIDAD_PRODUCTO,
  B.CODIGO    AS CODIGO_PRODUCTO,
  B.bache,
  SUM(CASE B.UNDBASE WHEN 'UND' THEN B.CANTEMPAQ ELSE B.CANTIDAD  END) AS KIL,
  SUM(CASE B.UNDBASE WHEN 'UND' THEN B.CANTIDAD  ELSE B.CANTEMPAQ END) AS UND`;
const groupByOpg1 = `B.UNDBASE, B.CODIGO, B.bache`;

const selectColsIndividual = `
  B.IDMVDCTO  AS IDMVDCTO,
  B.UNDBASE   AS UNIDAD_PRODUCTO,
  B.Bodega    AS BODEGA,
  B.codubica  AS UBICACION,
  B.CODIGO    AS CODIGO_PRODUCTO,
  B.NOMBRE    AS DESCRIPCION_PRODUCTO,
  B.CODLOTE   AS LOTE_PRODUCTO,
  B.Nrodcto   AS NRODCTO,
  B.Tipodcto  AS TIPODCTO,
  B.Origen    AS ORIGEN,
  B.bache,
  CASE B.UNDBASE WHEN 'UND' THEN B.CANTEMPAQ ELSE B.CANTIDAD  END AS KIL,
  CASE B.UNDBASE WHEN 'UND' THEN B.CANTIDAD  ELSE B.CANTEMPAQ END AS UND,
  CASE
    WHEN (CASE B.UNDBASE WHEN 'UND' THEN B.CANTIDAD ELSE B.CANTEMPAQ END) = 0 THEN 0
    ELSE (CASE B.UNDBASE WHEN 'UND' THEN B.CANTEMPAQ ELSE B.CANTIDAD  END)
       / (CASE B.UNDBASE WHEN 'UND' THEN B.CANTIDAD  ELSE B.CANTEMPAQ END)
  END AS PROMEDIO_PESO`;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const { id }   = await params;
    const filtroId = Number(id);

    const url        = new URL(req.url);
    const bacheParam = url.searchParams.get("bache");
    if (!bacheParam) return NextResponse.json({ error: "Falta el parámetro bache" }, { status: 400 });
    const bache = Number(bacheParam);
    if (!bache || isNaN(bache)) return NextResponse.json({ error: "Bache inválido" }, { status: 400 });
    const filtro = await prisma.exportProduccion.findUnique({ where: { id: filtroId } });
    if (!filtro) return NextResponse.json({ error: "Filtro no encontrado" }, { status: 404 });

    // Obtener logs del bache (log[0] = OPG1, log[último] = OPG2 si existe)
    const logs = await prisma.opgLog.findMany({
      where:   { filtroId, numeroBache: String(bache) },
      orderBy: { id: "asc" },
    });
    if (logs.length === 0) {
      return NextResponse.json(
        { error: "No se encontraron registros de log para este bache" },
        { status: 404 },
      );
    }

    const log1 = logs[0];
    const log2 = logs.length > 1 ? logs[logs.length - 1] : null;

    // Condiciones de desambiguación (igual que en results)
    const mainExtra: string[] = [];
    if (filtro.bodega?.trim())         mainExtra.push(`B.BODEGA   = '${s(filtro.bodega)}'`);
    if (filtro.ubicacion?.trim())      mainExtra.push(`B.CODUBICA = '${s(filtro.ubicacion)}'`);
    if (filtro.tipoMovimiento?.trim()) mainExtra.push(`B.TIPOMVTO = '${s(filtro.tipoMovimiento)}'`);
    if (filtro.tipoDocumento?.trim())  mainExtra.push(`B.Tipodcto = '${s(filtro.tipoDocumento)}'`);
    const mainExtraWhere = mainExtra.length ? "\n  AND " + mainExtra.join("\n  AND ") : "";

    // Registros principales ya marcados con este bache
    const rows = await prisma.$queryRawUnsafe(`
      SELECT ${selectCols}
      FROM Mvdcto B
      WHERE B.bache = ${bache}
        AND (B.CANTIDAD <> 0 OR B.CANTEMPAQ <> 0)${mainExtraWhere}
      GROUP BY ${groupBy}
      ORDER BY ${orderBy}
    `);

    // Registros OPG1 agrupados
    const rowsOpg1 = await prisma.$queryRawUnsafe(`
      SELECT ${selectColsOpg1}
      FROM Mvdcto B
      WHERE B.bache = ${bache}
        AND (B.CANTIDAD <> 0 OR B.CANTEMPAQ <> 0)${mainExtraWhere}
      GROUP BY ${groupByOpg1}
      ORDER BY B.CODIGO
    `);

    // Registros de consumo (solo para módulos con consumo configurado)
    let rowsConsumo: unknown[] = [];
    const hasConsumo =
      !!(filtro.bodegaConsumo?.trim() || filtro.ubicacionConsumo?.trim() ||
         filtro.tipoDocumentoConsumo?.trim() || filtro.tipoMovimientoConsumo?.trim());

    if (hasConsumo) {
      const fecha = parseFecha(filtro.fecha);

      const consumoExtra: string[] = [];
      if (filtro.bodegaConsumo?.trim())         consumoExtra.push(`B.BODEGA   = '${s(filtro.bodegaConsumo)}'`);
      if (filtro.ubicacionConsumo?.trim())      consumoExtra.push(`B.CODUBICA = '${s(filtro.ubicacionConsumo)}'`);
      if (filtro.tipoMovimientoConsumo?.trim()) consumoExtra.push(`B.TIPOMVTO = '${s(filtro.tipoMovimientoConsumo)}'`);
      if (filtro.tipoDocumentoConsumo?.trim())  consumoExtra.push(`B.Tipodcto = '${s(filtro.tipoDocumentoConsumo)}'`);
      const consumoExtraWhere = consumoExtra.length ? "\n  AND " + consumoExtra.join("\n  AND ") : "";

      // 1º intento: filas ya marcadas con este bache
      const markedRows = await prisma.$queryRawUnsafe<unknown[]>(`
        SELECT ${selectColsIndividual}
        FROM Mvdcto B
        INNER JOIN Dcto A
          ON  A.Nrodcto  = B.Nrodcto
          AND A.Origen   = B.Origen
          AND A.Tipodcto = B.Tipodcto
        WHERE B.bache = ${bache}
          AND (B.CANTIDAD <> 0 OR B.CANTEMPAQ <> 0)${consumoExtraWhere}
        ORDER BY ${orderBy}
      `);

      if (markedRows.length > 0) {
        rowsConsumo = markedRows;
      } else {
        // Fallback: filas aún sin marcar
        const whereConsumoConditions = [
          `CAST(A.Fecha AS DATE) = CAST('${s(fecha)}' AS DATE)`,
          `A.Origen = 'INV'`,
          `A.Origen   = B.Origen`,
          `A.Tipodcto = B.Tipodcto`,
          `A.Nrodcto  = B.Nrodcto`,
          `(B.CANTIDAD <> 0 OR B.CANTEMPAQ <> 0)`,
          `(B.bache = 0 OR B.bache IS NULL)`,
        ];
        if (filtro.tipoDocumentoConsumo?.trim())  whereConsumoConditions.push(`A.Tipodcto  = '${s(filtro.tipoDocumentoConsumo)}'`);
        if (filtro.tipoMovimientoConsumo?.trim()) whereConsumoConditions.push(`B.TIPOMVTO  = '${s(filtro.tipoMovimientoConsumo)}'`);
        if (filtro.bodegaConsumo?.trim())         whereConsumoConditions.push(`B.BODEGA    = '${s(filtro.bodegaConsumo)}'`);
        if (filtro.ubicacionConsumo?.trim())      whereConsumoConditions.push(`B.CODUBICA  = '${s(filtro.ubicacionConsumo)}'`);
        const whereConsumo = whereConsumoConditions.join("\n  AND ");

        rowsConsumo = await prisma.$queryRawUnsafe(`
          SELECT ${selectColsIndividual}
          FROM Mvdcto B
          INNER JOIN Dcto A
            ON  A.Nrodcto  = B.Nrodcto
            AND A.Origen   = B.Origen
            AND A.Tipodcto = B.Tipodcto
          WHERE ${whereConsumo}${consumoExtraWhere}
          ORDER BY ${orderBy}
        `);
      }
    }

    // ── Verificación de existencias OPG1 (solo si el consumo aún no fue enviado) ──
    // Se re-consulta al ERP en tiempo real para que el usuario vea el estado actual
    // del stock al cargar desde historial, igual que después de un primer intento.
    type ExistenciaComparacion = {
      bodegaId: string; referencia: string; lote: string;
      disponible1: number; disponible2: number; aConsumir1: number; suficiente: boolean;
    };
    let existenciaCheck: { items: ExistenciaComparacion[]; suficiente: boolean } | null = null;

    if (log1.estadoConsumoProduccion !== "ENVIADO") {
      try {
        const co          = filtro.centroOperacion?.trim() ?? "";
        const consecOpg1n = log1.numeroOpg;
        const existencias = await queryExistenciaLote(co, "OPG", consecOpg1n);

        type NeedEntry = { bodegaId: string; referencia: string; pendiente1: number; pendiente2: number };
        const needMap = new Map<string, NeedEntry>();
        for (const e of existencias) {
          const bId = e.bodegaId.trim();
          const ref = e.referencia.trim();
          const key = `${bId}\x00${ref}`;
          const prev = needMap.get(key);
          if (!prev) needMap.set(key, { bodegaId: bId, referencia: ref, pendiente1: e.pendiente1, pendiente2: e.pendiente2 });
          else { prev.pendiente1 += e.pendiente1; prev.pendiente2 += e.pendiente2; }
        }

        type StockEntry = { bodegaId: string; referencia: string; lote: string; disponible1: number; disponible2: number };
        const stockMap = new Map<string, StockEntry>();
        for (const e of existencias) {
          const bId  = e.bodegaId.trim();
          const ref  = e.referencia.trim();
          const lote = e.lote.trim();
          const key  = `${bId}\x00${ref}\x00${lote}`;
          const prev = stockMap.get(key);
          if (!prev || e.disponible1 > prev.disponible1)
            stockMap.set(key, { bodegaId: bId, referencia: ref, lote, disponible1: e.disponible1, disponible2: e.disponible2 });
        }

        const availMap = new Map<string, number>();
        for (const pos of stockMap.values()) {
          const key = `${pos.bodegaId}\x00${pos.referencia}`;
          availMap.set(key, (availMap.get(key) ?? 0) + pos.disponible1);
        }

        const r4 = (n: number) => Math.round(n * 10000) / 10000;
        const items: ExistenciaComparacion[] = [];
        for (const pos of stockMap.values()) {
          const needKey    = `${pos.bodegaId}\x00${pos.referencia}`;
          const aConsumir1 = needMap.get(needKey)?.pendiente1 ?? 0;
          const totalDisp  = availMap.get(needKey) ?? 0;
          items.push({ bodegaId: pos.bodegaId, referencia: pos.referencia, lote: pos.lote,
            disponible1: pos.disponible1, disponible2: pos.disponible2, aConsumir1,
            suficiente: r4(totalDisp) >= r4(aConsumir1) });
        }
        for (const [key, need] of needMap.entries()) {
          const hasStock = [...stockMap.keys()].some((k) => k.startsWith(key + "\x00"));
          if (!hasStock && need.pendiente1 > 0)
            items.push({ bodegaId: need.bodegaId, referencia: need.referencia, lote: "",
              disponible1: 0, disponible2: 0, aConsumir1: need.pendiente1, suficiente: false });
        }

        const todoSuficiente = items.every((i) => i.suficiente);
        existenciaCheck = todoSuficiente ? null : { items, suficiente: false };
      } catch {
        // Si el WS falla no bloqueamos la carga del resume
      }
    }

    return NextResponse.json({
      filtro,
      bache,
      logId1:     log1.id,
      consecOpg1: log1.numeroOpg,
      logId2:     log2?.id        ?? null,
      consecOpg2: log2?.numeroOpg ?? null,
      log1: {
        id:                         log1.id,
        numeroOpg:                  log1.numeroOpg,
        estadoOrdenProduccion:      log1.estadoOrdenProduccion,
        estadoConsumoProduccion:    log1.estadoConsumoProduccion,
        estadoEntregaProduccion:    log1.estadoEntregaProduccion,
        xml1: log1.xml1 ?? "",
        xml2: log1.xml2 ?? "",
        xml3: log1.xml3 ?? "",
      },
      log2: log2 ? {
        id:                         log2.id,
        numeroOpg:                  log2.numeroOpg,
        estadoOrdenProduccion:      log2.estadoOrdenProduccion,
        estadoConsumoProduccion:    log2.estadoConsumoProduccion,
        estadoEntregaProduccion:    log2.estadoEntregaProduccion,
        xml1: log2.xml1 ?? "",
        xml2: log2.xml2 ?? "",
        xml3: log2.xml3 ?? "",
      } : null,
      rows,
      rowsOpg1,
      rowsConsumo,
      existenciaCheck,
    });

  } catch (err) {
    console.error("[GET /api/export-produccion/[id]/resume-bache]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
