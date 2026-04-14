// src/lib/auth.ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "sqlserver",
  }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Cambiar a true en producción con SMTP configurado
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 días
    updateAge: 60 * 60 * 24,      // Renovar si tiene más de 1 día
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,             // Cache de 5 minutos
    },
  },

  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "user",
        input: false, // No permitir que el usuario lo cambie
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;
