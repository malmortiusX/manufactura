// src/app/api/export-produccion/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const registro = await prisma.exportProduccion.update({
    where: { id: Number(id) },
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
      ppCodigos:              body.ppCodigos              || null,
      ppConLote:              body.ppConLote              || null,
    },
  });

  return NextResponse.json(registro);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;

  await prisma.exportProduccion.delete({ where: { id: Number(id) } });

  return new NextResponse(null, { status: 204 });
}
