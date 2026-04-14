# 🚀 Next.js + Better Auth + Prisma + SQL Server

Template de dashboard empresarial con autenticación completa y conexión a Microsoft SQL Server.

## Stack tecnológico

| Tecnología | Versión | Propósito |
|---|---|---|
| Next.js | 15 | Framework React (App Router) |
| Better Auth | 1.x | Autenticación (email/password, sesiones) |
| Prisma | 6.x | ORM para SQL Server |
| Tailwind CSS | 3.x | Estilos |
| Recharts | 2.x | Gráficas en el dashboard |
| TypeScript | 5.x | Tipado estático |

---

## ⚡ Inicio rápido

### 1. Clonar e instalar dependencias

```bash
git clone <tu-repo>
cd nextjs-sqlserver-starter
npm install
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Editar `.env` con tus datos de SQL Server:

```env
# Autenticación SQL (usuario y contraseña)
DATABASE_URL="sqlserver://localhost:1433;database=MiDB;user=sa;password=MiPass;trustServerCertificate=true"

# Instancia nombrada (ej: MSSQLSERVER)
# DATABASE_URL="sqlserver://SERVIDOR\\INSTANCIA:1433;database=MiDB;user=sa;password=MiPass;trustServerCertificate=true"

# Windows Integrated Security
# DATABASE_URL="sqlserver://localhost:1433;database=MiDB;integratedSecurity=true;trustServerCertificate=true"

BETTER_AUTH_SECRET="genera-con-openssl-rand-base64-32"
BETTER_AUTH_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NEXT_PUBLIC_APP_NAME="Mi Dashboard"
```

### 3. Crear tablas en SQL Server

```bash
# Opción A — Sin historial de migraciones (recomendado para inicio)
npx prisma db push

# Opción B — Con historial de migraciones (recomendado para producción)
npx prisma migrate dev --name init
```

### 4. Iniciar el servidor de desarrollo

```bash
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000) — redirige automáticamente al login.

---

## 📁 Estructura del proyecto

```
src/
├── app/
│   ├── login/              # Página de login
│   ├── register/           # Página de registro
│   ├── dashboard/
│   │   ├── layout.tsx      # Layout con Sidebar + Topbar
│   │   ├── page.tsx        # Dashboard principal (stats + gráfica)
│   │   ├── employees/      # Tabla de empleados
│   │   ├── users/          # Usuarios del sistema (desde SQL Server)
│   │   ├── reports/        # Reportes (personalizar)
│   │   └── settings/       # Configuración
│   └── api/
│       ├── auth/           # Better Auth handler
│       └── users/          # API ejemplo con Prisma + SQL Server
├── components/
│   └── layout/
│       ├── Sidebar.tsx     # Navegación lateral
│       └── Topbar.tsx      # Barra superior con usuario
├── lib/
│   ├── auth.ts             # Configuración Better Auth (servidor)
│   ├── auth-client.ts      # Configuración Better Auth (cliente)
│   ├── prisma.ts           # Singleton de PrismaClient
│   └── utils.ts            # Utilidades (cn)
├── middleware.ts            # Protección de rutas
prisma/
└── schema.prisma            # Schema para SQL Server
```

---

## 🔐 Autenticación

Better Auth maneja automáticamente:
- Registro con email y contraseña
- Inicio de sesión con cookie segura (httpOnly)
- Renovación automática de sesión
- Cierre de sesión

### Verificar sesión en Server Components

```typescript
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

const session = await auth.api.getSession({ headers: await headers() });
if (!session) redirect("/login");
```

### Verificar sesión en Client Components

```typescript
import { useSession } from "@/lib/auth-client";

const { data: session } = useSession();
```

---

## 🗄️ Consultas SQL Server con Prisma

### ORM estándar

```typescript
// Buscar empleados activos
const employees = await prisma.employee.findMany({
  where: { active: true },
  orderBy: { name: "asc" },
});
```

### SQL crudo (para consultas complejas del negocio)

```typescript
// Consulta directa — útil para vistas, stored procedures, etc.
const result = await prisma.$queryRaw`
  SELECT TOP 10 name, department, salary
  FROM Employee
  WHERE active = 1
  ORDER BY salary DESC
`;

// Ejecutar stored procedure
await prisma.$executeRaw`EXEC sp_ActualizarInventario @FechaCorte = ${fecha}`;
```

---

## 🧩 Agregar nuevas tablas

1. Editar `prisma/schema.prisma` y agregar el modelo
2. Ejecutar `npx prisma db push` (o `migrate dev`)
3. Ejecutar `npx prisma generate` para regenerar el cliente
4. Usar `prisma.tuModelo.findMany()` en la API route

---

## 📦 Scripts disponibles

```bash
npm run dev          # Servidor de desarrollo
npm run build        # Build de producción
npm run start        # Servidor de producción
npm run db:push      # Sincronizar schema con SQL Server
npm run db:migrate   # Crear migración con historial
npm run db:studio    # Explorador visual de la BD
npm run db:generate  # Regenerar cliente Prisma
```

---

## 🛠️ Personalización rápida

- **Nombre de la app**: variable `NEXT_PUBLIC_APP_NAME` en `.env`
- **Menú del sidebar**: editar array `navItems` en `src/components/layout/Sidebar.tsx`
- **Colores**: variables CSS en `src/app/globals.css`
- **Tablas del negocio**: agregar modelos en `prisma/schema.prisma`
