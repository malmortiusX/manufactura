// src/app/api/export-produccion/seq-opg/route.ts
// Incrementa y devuelve el siguiente consecutivo OPG de la tabla Consecutivo.
// Se llama justo antes de construir el XML para tener el número real del documento.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const rec = await prisma.consecutivo.upsert({
      where:  { tipoDocumento: "OPG" },
      create: { tipoDocumento: "OPG", consecutivo: 1 },
      update: { consecutivo: { increment: 1 } },
    });
    return NextResponse.json({ consecOpg: rec.consecutivo });
  } catch (err) {
    console.error("[POST /api/export-produccion/seq-opg]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
