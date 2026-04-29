// src/app/api/export-produccion/[id]/lotes/route.ts
// Subproceso previo a la transmisión de la orden de producción.
// Registra los lotes de cada producto en ERP (tipo 403) para garantizar
// que existan antes de crear la orden. Guarda los lotes creados en la
// tabla LoteCreado para evitar intentos duplicados en futuros envíos.

import { NextResponse }  from "next/server";
import { auth }          from "@/lib/auth";
import { prisma }        from "@/lib/prisma";
import { headers }       from "next/headers";
import { callSoap, type ErpError } from "@/lib/erp-soap";

// ── Tipos ──────────────────────────────────────────────────────────────────
interface ProductoLote {
  codigo: string;
  lote:   string;
}

// ── Utilidades de formato (duplicadas del cliente para uso server-side) ───
const pN = (val: string | number | null | undefined, len: number) =>
  String(Math.floor(Number(val) || 0)).padStart(len, "0").slice(-len);

const pA = (val: string | null | undefined, len: number) =>
  (val ?? "").slice(0, len).padEnd(len, " ");

// Suma N días a una fecha YYYYMMDD y devuelve YYYYMMDD
function sumarDias(fechaYMD: string, dias: number): string {
  const y = parseInt(fechaYMD.slice(0, 4), 10);
  const m = parseInt(fechaYMD.slice(4, 6), 10) - 1;
  const d = parseInt(fechaYMD.slice(6, 8), 10);
  const dt = new Date(y, m, d);
  dt.setDate(dt.getDate() + dias);
  return [
    String(dt.getFullYear()),
    String(dt.getMonth() + 1).padStart(2, "0"),
    String(dt.getDate()).padStart(2, "0"),
  ].join("");
}

// ── Construcción del texto de lotes (tipo 403) ────────────────────────────
// Estructura por línea (522 chars):
//   F_NUMERO_REG(7) F_TIPO_REG(4) F_SUBTIPO_REG(2) F_VERSION_REG(2)
//   F_CIA(3) F_ACTUALIZA_REG(1)
//   f403_id(15) f403_id_item(7) f403_referencia_item(50)
//   f403_codigo_barras(20) f403_id_ext1_detalle(20) f403_id_ext2_detalle(20)
//   f403_id_descripcion_tecnica(3) f403_ind_estado(1)
//   f403_fecha_creacion(8) f403_fecha_vcto(8)
//   f403_lote_prov(15) f403_id_tercero_prov(15) f403_id_sucursal_prov(3)
//   f403_fabricante(40) f403_num_lote_fabricante(15) f403_fecha_manufactura(8)
//   f403_notas(255)
function buildXMLLotes(productos: ProductoLote[], fechaYMD: string): string {
  const fechaVcto = sumarDias(fechaYMD, 30);
  const opening   = "000000100000001001";

  const lines = productos.map((p, i) =>
    pN(i + 2, 7) +                    // F_NUMERO_REG  (2, 3, 4…)
    pN(403,   4) +                    // F_TIPO_REG    = 403
    pN(0,     2) +                    // F_SUBTIPO_REG = 00
    pN(2,     2) +                    // F_VERSION_REG = 02
    pN(1,     3) +                    // F_CIA         = 1
    pN(0,     1) +                    // F_ACTUALIZA_REG = 0
    pA(p.lote,    15) +               // f403_id (lote)
    pN(0,      7) +                   // f403_id_item (vacío)
    pA(p.codigo,  50) +               // f403_referencia_item
    pA("",        20) +               // f403_codigo_barras
    pA("",        20) +               // f403_id_ext1_detalle
    pA("",        20) +               // f403_id_ext2_detalle
    pA("",         3) +               // f403_id_descripcion_tecnica
    pN(1,      1) +                   // f403_ind_estado = 1
    pA(fechaYMD,   8) +               // f403_fecha_creacion
    pA(fechaVcto,  8) +               // f403_fecha_vcto (+30 días)
    pA("",        15) +               // f403_lote_prov
    pA("",        15) +               // f403_id_tercero_prov
    pA("",         3) +               // f403_id_sucursal_prov
    pA("",        40) +               // f403_fabricante
    pA("",        15) +               // f403_num_lote_fabricante
    pA("",         8) +               // f403_fecha_manufactura
    pA("Creado por plano", 255)       // f403_notas
  );

  // Línea de cierre: N+2 (1 apertura + N productos + cierre)
  const closingNum = productos.length + 2;
  const closing = pN(closingNum, 7) + "9999" + "00" + "01" + "001";

  return [opening, ...lines, closing].join("\n");
}

// ── POST handler ───────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

    const body = await req.json() as { productos: ProductoLote[]; fecha: string };
    const { productos, fecha } = body;

    if (!productos?.length) {
      return NextResponse.json({ error: "Falta la lista de productos" }, { status: 400 });
    }
    if (!fecha) {
      return NextResponse.json({ error: "Falta la fecha (YYYYMMDD)" }, { status: 400 });
    }

    // ── 1. Filtrar los lotes que ya están registrados en nuestra DB ───────
    const existentes = await prisma.loteCreado.findMany({
      where: {
        OR: productos.map((p) => ({
          codigoProducto: p.codigo,
          lote:           p.lote,
        })),
      },
      select: { codigoProducto: true, lote: true },
    });

    const existenteSet = new Set(existentes.map((e) => `${e.codigoProducto}|${e.lote}`));
    const omitidos = productos.filter((p) =>  existenteSet.has(`${p.codigo}|${p.lote}`));
    const nuevos   = productos.filter((p) => !existenteSet.has(`${p.codigo}|${p.lote}`));

    // ── 2. Si todos ya existen, no hay nada que enviar ────────────────────
    if (nuevos.length === 0) {
      return NextResponse.json({
        exitoso:  true,
        omitidos,
        nuevos:   [],
        creados:  [],
        errores:  [] as ErpError[],
        xmlLotes: null,
      });
    }

    // ── 3. Construir y enviar XML de lotes al ERP ─────────────────────────
    const xmlLotes = buildXMLLotes(nuevos, fecha);
    const result   = await callSoap(xmlLotes);

    // ── 4. Persistir lotes ────────────────────────────────────────────────────
    // En el XML los productos van en líneas i+2 (base 0), por lo que
    // nuevos[nroLinea - 2] identifica el producto exacto de cada error.
    const LOTE_YA_EXISTE = "el lote que desea adicionar ya existe";

    // Productos cuyo error es "ya existe" → están en ERP, los registramos.
    const yaExistenEnErp: ProductoLote[] = result.errores
      .filter((e) => e.detalle.toLowerCase().includes(LOTE_YA_EXISTE))
      .map((e) => nuevos[e.nroLinea - 2])
      .filter((p): p is ProductoLote => p !== undefined);

    // Errores reales: los que NO son "ya existe".
    const erroresReales = result.errores.filter(
      (e) => !e.detalle.toLowerCase().includes(LOTE_YA_EXISTE)
    );

    // Persistir: los creados por ERP (exitoso) + los que ya existían en ERP.
    const aPersistir = result.exitoso ? nuevos : yaExistenEnErp;

    let creados: ProductoLote[] = [];
    if (aPersistir.length > 0) {
      await Promise.all(
        aPersistir.map((p) =>
          prisma.loteCreado.upsert({
            where:  { codigoProducto_lote: { codigoProducto: p.codigo, lote: p.lote } },
            create: { codigoProducto: p.codigo, lote: p.lote },
            update: {},
          })
        )
      );
      creados = aPersistir;
    }

    return NextResponse.json({
      exitoso:      result.exitoso || erroresReales.length === 0,
      omitidos,
      nuevos,
      creados,
      errores:      erroresReales,
      respuestaRaw: result.respuestaRaw,
      xmlLotes,
    });
  } catch (err) {
    console.error("[POST /api/export-produccion/[id]/lotes]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
