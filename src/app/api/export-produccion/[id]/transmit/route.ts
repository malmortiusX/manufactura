// src/app/api/export-produccion/[id]/transmit/route.ts
// Flujo:
//  1. Obtiene / incrementa el consecutivo OPG de forma atómica
//  2. Crea un registro en OpgLog con los XMLs y el bache
//  3. Envía cada XML al ERP vía SOAP (un documento por llamada)
//  4. Actualiza el OpgLog con el estado y la respuesta de cada documento
//  Devuelve { numeroOpg, estadoOrden, estadoConsumo, estadoEntrega, logId }

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";

// ── Construcción del envelope SOAP ────────────────────────────────────────
// Recibe el contenido de ancho fijo (líneas separadas por \n) y lo envuelve
// en <Linea> dentro de <Datos>, luego en el sobre SOAP con CDATA.
function buildEnvelope(lineasTexto: string): string {
  const url      = process.env.ERP_SOAP_URL  ?? "";
  const conexion = process.env.ERP_CONEXION  ?? "";
  const cia      = process.env.ERP_CIA       ?? "1";
  const usuario  = process.env.ERP_USUARIO   ?? "";
  const clave    = process.env.ERP_CLAVE     ?? "";

  // Cada línea del texto fijo se envuelve en <Linea>
  const lineas = lineasTexto
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => `<Linea>${l}</Linea>`)
    .join("\n");

  const importar = `<Importar>
<NombreConexion>${conexion}</NombreConexion>
<IdCia>${cia}</IdCia>
<Usuario>${usuario}</Usuario>
<Clave>${clave}</Clave>
<Datos>
${lineas}
</Datos>
</Importar>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
<soapenv:Header/>
<soapenv:Body>
<tem:ImportarXML>
<tem:pvstrDatos><![CDATA[${importar}]]></tem:pvstrDatos>
<tem:printTipoError>0</tem:printTipoError>
</tem:ImportarXML>
</soapenv:Body>
</soapenv:Envelope>`;
}

// ── Llamada al SOAP ────────────────────────────────────────────────────────
async function callSoap(lineasTexto: string): Promise<string> {
  const url = process.env.ERP_SOAP_URL ?? "";
  if (!url) throw new Error("ERP_SOAP_URL no está configurada en .env");

  const body = buildEnvelope(lineasTexto);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml;charset=utf-8",
      SOAPAction: `"http://tempuri.org/ImportarXML"`,
    },
    body,
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} al llamar al servicio SOAP`);
  return await res.text();
}

// ── POST handler ───────────────────────────────────────────────────────────
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  const filtroId = Number(id);

  const body = await req.json() as { bache: number; xml1: string; xml2: string; xml3: string };
  const { bache, xml1, xml2, xml3 } = body;

  if (!bache) return NextResponse.json({ error: "Falta el número de lote (bache)" }, { status: 400 });

  // 1. Incrementar consecutivo OPG de forma atómica
  const consecutivoRec = await prisma.consecutivo.upsert({
    where:  { tipoDocumento: "OPG" },
    create: { tipoDocumento: "OPG", consecutivo: 1 },
    update: { consecutivo: { increment: 1 } },
  });
  const numeroOpg = consecutivoRec.consecutivo;

  // 2. Crear registro en OpgLog
  const log = await prisma.opgLog.create({
    data: {
      tipoDocumento: "OPG",
      numeroOpg,
      numeroBache:  String(bache),
      filtroId,
      xml1,
      xml2,
      xml3,
      estadoOrdenProduccion:   "PENDIENTE",
      estadoConsumoProduccion: "PENDIENTE",
      estadoEntregaProduccion: "PENDIENTE",
    },
  });

  // 3. Enviar los 3 documentos al ERP
  type DocEstado = "ENVIADO" | "ERROR";

  let estadoOrden:   DocEstado = "ERROR";
  let estadoConsumo: DocEstado = "ERROR";
  let estadoEntrega: DocEstado = "ERROR";
  let respuestaOrden   = "";
  let respuestaConsumo = "";
  let respuestaEntrega = "";

  try {
    respuestaOrden = await callSoap(xml1);
    estadoOrden = "ENVIADO";
  } catch (e) {
    respuestaOrden = String(e);
  }

  try {
    respuestaConsumo = await callSoap(xml2);
    estadoConsumo = "ENVIADO";
  } catch (e) {
    respuestaConsumo = String(e);
  }

  try {
    respuestaEntrega = await callSoap(xml3);
    estadoEntrega = "ENVIADO";
  } catch (e) {
    respuestaEntrega = String(e);
  }

  // 4. Actualizar el log con los resultados
  await prisma.opgLog.update({
    where: { id: log.id },
    data: {
      estadoOrdenProduccion:      estadoOrden,
      estadoConsumoProduccion:    estadoConsumo,
      estadoEntregaProduccion:    estadoEntrega,
      respuestaOrdenProduccion:   respuestaOrden,
      respuestaConsumoProduccion: respuestaConsumo,
      respuestaEntregaProduccion: respuestaEntrega,
      intentos: { increment: 1 },
    },
  });

  return NextResponse.json({
    logId: log.id,
    numeroOpg,
    estadoOrden,
    estadoConsumo,
    estadoEntrega,
    respuestaOrden,
    respuestaConsumo,
    respuestaEntrega,
  });
}
