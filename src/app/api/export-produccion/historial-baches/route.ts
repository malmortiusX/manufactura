// src/app/api/export-produccion/historial-baches/route.ts
// GET — lista todos los registros de OpgLog con su filtro asociado,
//        ordenados del más reciente al más antiguo.

import { NextResponse } from "next/server";
import { auth }          from "@/lib/auth";
import { prisma }        from "@/lib/prisma";
import { headers }       from "next/headers";

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const url    = new URL(req.url);
  const modulo = url.searchParams.get("modulo") ?? "";
  const search = url.searchParams.get("search") ?? "";
  const page   = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const limit  = 50;
  const skip   = (page - 1) * limit;

  const where: Record<string, unknown> = {};

  if (modulo) {
    where.filtro = { modulo };
  }

  if (search) {
    where.OR = [
      { numeroBache: { contains: search } },
      { filtro: { nombre:    { contains: search } } },
      { filtro: { modulo:    { contains: search } } },
    ];
  }

  const [total, logs] = await Promise.all([
    prisma.opgLog.count({ where }),
    prisma.opgLog.findMany({
      where,
      include: {
        filtro: {
          select: {
            id:             true,
            nombre:         true,
            modulo:         true,
            centroOperacion: true,
            fecha:          true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
  ]);

  return NextResponse.json({ logs, total, page, limit });
}
