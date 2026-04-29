// src/app/api/export-produccion/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const modulo = req.nextUrl.searchParams.get("modulo");

  const registros = await prisma.exportProduccion.findMany({
    where: modulo ? { modulo } : undefined,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(registros);
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json();

  try {
    const registro = await prisma.exportProduccion.create({
      data: {
        identificador:          body.identificador,
        nombre:                 body.nombre,
        bodega:                 body.bodega                 || null,
        ubicacion:              body.ubicacion              || null,
        tipoDocumento:          body.tipoDocumento          || null,
        tipoMovimiento:         body.tipoMovimiento         || null,
        fecha:                  new Date(body.fecha),
        centroOperacion:        body.centroOperacion        || null,
        terceroPlanificador:    body.terceroPlanificador    || null,
        instalacion:            body.instalacion            || null,
        bodegaItemPadre:        body.bodegaItemPadre        || null,
        tipoDoctoOrden:         body.tipoDoctoOrden         || null,
        modulo:                 body.modulo                 || null,
        productoProceso:        body.productoProceso        || null,
        bodegaConsumo:          body.bodegaConsumo          || null,
        ubicacionConsumo:       body.ubicacionConsumo       || null,
        tipoDocumentoConsumo:   body.tipoDocumentoConsumo   || null,
        tipoMovimientoConsumo:  body.tipoMovimientoConsumo  || null,
        productosEnProceso:     body.productosEnProceso     || null,
        productosSinLote:       body.productosSinLote       || null,
      },
    });
    return NextResponse.json(registro, { status: 201 });
  } catch (err) {
    console.error("[POST /api/export-produccion]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
