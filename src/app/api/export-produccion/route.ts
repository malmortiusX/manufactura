// src/app/api/export-produccion/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const registros = await prisma.exportProduccion.findMany({
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
        tipoDoc:                body.tipoDoc                || null,
        motivo:                 body.motivo                 || null,
        centroCostos:           body.centroCostos           || null,
        origenCentroOperacion:  body.origenCentroOperacion  || null,
        origenBodega:           body.origenBodega           || null,
        origenUbicacion:        body.origenUbicacion        || null,
        destinoCentroOperacion: body.destinoCentroOperacion || null,
        destinoBodega:          body.destinoBodega          || null,
        destinoUbicacion:       body.destinoUbicacion       || null,
        unidadNegocio:          body.unidadNegocio          || null,
      },
    });
    return NextResponse.json(registro, { status: 201 });
  } catch (err) {
    console.error("[POST /api/export-produccion]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
