// src/app/api/users/[id]/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  return u?.role === "admin" ? session : null;
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const { name, email, role } = await request.json();

  if (!name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: "Nombre y email son requeridos" }, { status: 400 });
  }

  const existing = await prisma.user.findFirst({ where: { email, NOT: { id } } });
  if (existing) {
    return NextResponse.json({ error: "El email ya está en uso" }, { status: 409 });
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { name: name.trim(), email: email.trim(), role: role === "admin" ? "admin" : "user" },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  // Sincronizar accountId si cambió el email
  await prisma.account.updateMany({
    where: { userId: id, providerId: "credential" },
    data: { accountId: email.trim() },
  });

  return NextResponse.json(updated);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await params;
  const { active } = await request.json();

  const updated = await prisma.user.update({
    where: { id },
    data: { active: Boolean(active) },
    select: { id: true, active: true },
  });

  // Al bloquear, eliminar todas las sesiones activas del usuario
  if (!active) {
    await prisma.session.deleteMany({ where: { userId: id } });
  }

  return NextResponse.json(updated);
}
