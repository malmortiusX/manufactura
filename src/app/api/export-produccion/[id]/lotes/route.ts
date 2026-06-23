// src/app/api/export-produccion/[id]/lotes/route.ts
// Subproceso previo a la transmisión de la orden de producción.
// Registra los lotes de cada producto en ERP (tipo 403) para garantizar
// que existan antes de crear la orden. Guarda los lotes creados en la
// tabla LoteCreado para evitar intentos duplicados en futuros envíos.
//
// Responde con NDJSON streaming (una línea JSON por evento) para evitar
// que nginx corte la conexión con 504 cuando hay muchos lotes.

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
function buildXMLLotes(productos: ProductoLote[], fechaYMD: string): string {
  const fechaVcto = sumarDias(fechaYMD, 30);
  const opening   = "000000100000001001";

  function trimStart(str: string, char: string): string {
    if (char.length !== 1) {
      throw new Error("El carácter de referencia debe ser exactamente un carácter");
    }
    let i = 0;
    while (i < str.length && str[i] === char) i++;
    return str.slice(i);
  }

  const lines = productos.map((p, i) =>
    pN(i + 2, 7) +
    pN(403,   4) +
    pN(0,     2) +
    pN(2,     2) +
    pN(1,     3) +
    pN(0,     1) +
    pA(p.lote,    15) +
    pN(0,      7) +
    pA(trimStart(p.codigo, "0"),  50) +
    pA("",        20) +
    pA("",        20) +
    pA("",        20) +
    pA("",         3) +
    pN(1,      1) +
    pA(fechaYMD,   8) +
    pA(fechaVcto,  8) +
    pA("",        15) +
    pA("",        15) +
    pA("",         3) +
    pA("",        40) +
    pA("",        15) +
    pA("",         8) +
    pA("Creado por plano", 255)
  );

  const closingNum = productos.length + 2;
  const closing = pN(closingNum, 7) + "9999" + "00" + "01" + "001";

  return [opening, ...lines, closing].join("\n");
}

// ── POST handler (NDJSON streaming) ───────────────────────────────────────
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { productos: ProductoLote[]; fecha: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON inválido" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { productos, fecha } = body;

  if (!productos?.length) {
    return new Response(JSON.stringify({ error: "Falta la lista de productos" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!fecha) {
    return new Response(JSON.stringify({ error: "Falta la fecha (YYYYMMDD)" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
      };

      try {
        // ── 1. Deduplicar input y filtrar los ya registrados en DB ─────────
        const uniqueInput = Array.from(
          new Map(productos.map((p) => [`${p.codigo}|${p.lote}`, p])).values()
        );

        const existentes = await prisma.loteCreado.findMany({
          where: { OR: uniqueInput.map((p) => ({ codigoProducto: p.codigo, lote: p.lote })) },
          select: { codigoProducto: true, lote: true },
        });

        const existenteSet = new Set(existentes.map((e) => `${e.codigoProducto}|${e.lote}`));
        const omitidos = uniqueInput.filter((p) =>  existenteSet.has(`${p.codigo}|${p.lote}`));
        const nuevos   = uniqueInput.filter((p) => !existenteSet.has(`${p.codigo}|${p.lote}`));

        // ── 2. Si todos ya existen, responder de inmediato ─────────────────
        if (nuevos.length === 0) {
          send({
            type:         "done",
            exitoso:      true,
            omitidos,
            nuevos:       [],
            creados:      [],
            errores:      [] as ErpError[],
            respuestaRaw: "",
            xmlLotes:     null,
          });
          controller.close();
          return;
        }

        send({ type: "start", total: nuevos.length });

        // ── 3. Enviar un XML por lote con concurrencia limitada ────────────
        const LOTE_YA_EXISTE = "el lote que desea adicionar ya existe";
        const CONCURRENCY    = 10;

        const xmlsEnviados:  string[]       = [];
        const creados:       ProductoLote[] = [];
        const erroresReales: ErpError[]     = [];
        let   completado = 0;

        type LoteResult = {
          lote:   ProductoLote;
          xml:    string;
          result: Awaited<ReturnType<typeof callSoap>>;
        };

        const tasks = nuevos.map((lote) => async (): Promise<LoteResult> => {
          const xml    = buildXMLLotes([lote], fecha);
          const result = await callSoap(xml);
          return { lote, xml, result };
        });

        const settled: PromiseSettledResult<LoteResult>[] = new Array(tasks.length);
        let idx = 0;

        async function worker() {
          while (idx < tasks.length) {
            const i = idx++;
            try {
              settled[i] = { status: "fulfilled", value: await tasks[i]() };
            } catch (e) {
              settled[i] = { status: "rejected", reason: e };
            }
            completado++;
            send({ type: "progress", completado, total: nuevos.length });
          }
        }

        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker)
        );

        // ── 4. Persistir creados y recopilar errores ───────────────────────
        for (const s of settled) {
          if (s.status === "rejected") continue;
          const { lote, xml, result } = s.value;
          xmlsEnviados.push(xml);
          const yaExiste = result.errores.some((e) =>
            e.detalle.toLowerCase().includes(LOTE_YA_EXISTE)
          );
          if (result.exitoso || yaExiste) {
            await prisma.loteCreado.upsert({
              where:  { codigoProducto_lote: { codigoProducto: lote.codigo, lote: lote.lote } },
              create: { codigoProducto: lote.codigo, lote: lote.lote },
              update: {},
            });
            creados.push(lote);
          } else {
            erroresReales.push(...result.errores);
          }
        }

        send({
          type:         "done",
          exitoso:      erroresReales.length === 0,
          omitidos,
          nuevos,
          creados,
          errores:      erroresReales,
          respuestaRaw: "",
          xmlLotes:     xmlsEnviados.length > 0 ? xmlsEnviados.join("\n\n") : null,
        });

      } catch (err) {
        console.error("[POST /api/export-produccion/[id]/lotes]", err);
        send({ type: "error", error: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
