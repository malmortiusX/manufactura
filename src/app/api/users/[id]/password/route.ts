// src/app/api/users/[id]/password/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";
import { hashPassword } from "@/lib/password";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (currentUser?.role !== "admin") return NextResponse.json({ error: "Sin permiso" }, { status: 403 });

  const { id } = await params;
  const { password } = await request.json();

  if (!password || password.length < 8) {
    return NextResponse.json(
      { error: "La contraseña debe tener al menos 8 caracteres" },
      { status: 400 }
    );
  }

  const hashed = await hashPassword(password);

  const updated = await prisma.account.updateMany({
    where: { userId: id, providerId: "credential" },
    data: { password: hashed },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
