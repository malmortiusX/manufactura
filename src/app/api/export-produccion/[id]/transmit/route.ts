// src/app/api/export-produccion/[id]/transmit/route.ts
// Flujo:
//  1. Incrementa el consecutivo OPG de forma atómica
//  2. Crea un registro en OpgLog con los XMLs y el bache
//  3. Envía cada XML al ERP vía SOAP y parsea la respuesta
//  4. Actualiza el OpgLog con el estado y los errores de cada documento

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { headers } from "next/headers";

// ── Tipos ──────────────────────────────────────────────────────────────────
export interface ErpError {
  nroLinea: number;
  tipoReg: string;
  subtipo: string;
  version: string;
  nivel: string;
  valor: string;
  detalle: string;
}

export interface DocResult {
  exitoso: boolean;
  printTipoError: number;
  errores: ErpError[];
  respuestaRaw: string;
}

// ── Parser de respuesta SOAP del ERP ──────────────────────────────────────
// Lee <printTipoError> y extrae los bloques <Table> del diffgram si hay error.
function parseSoapRespuesta(xml: string): DocResult {
  const tipoErrorMatch = xml.match(/<printTipoError>(\d+)<\/printTipoError>/);
  const printTipoError = tipoErrorMatch ? parseInt(tipoErrorMatch[1], 10) : 1;
  const exitoso = printTipoError === 0;

  const errores: ErpError[] = [];

  if (!exitoso) {
    const tableRegex = /<Table[\s\S]*?>([\s\S]*?)<\/Table>/g;
    let match: RegExpExecArray | null;
    const get = (block: string, tag: string): string => {
      const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
      return m ? m[1].trim() : "";
    };
    while ((match = tableRegex.exec(xml)) !== null) {
      const block = match[1];
      errores.push({
        nroLinea: parseInt(get(block, "f_nro_linea"), 10) || 0,
        tipoReg:  get(block, "f_tipo_reg"),
        subtipo:  get(block, "f_subtipo_reg"),
        version:  get(block, "f_version"),
        nivel:    get(block, "f_nivel"),
        valor:    get(block, "f_valor"),
        detalle:  get(block, "f_detalle"),
      });
    }
  }

  return { exitoso, printTipoError, errores, respuestaRaw: xml };
}

// ── Construcción del envelope SOAP ────────────────────────────────────────
function buildEnvelope(lineasTexto: string): string {
  const conexion = process.env.ERP_CONEXION ?? "";
  const cia      = process.env.ERP_CIA      ?? "1";
  const usuario  = process.env.ERP_USUARIO  ?? "";
  const clave    = process.env.ERP_CLAVE    ?? "";

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

// ── Llamada al SOAP → DocResult ────────────────────────────────────────────
async function callSoap(lineasTexto: string): Promise<DocResult> {
  const url = process.env.ERP_SOAP_URL ?? "";
  if (!url) throw new Error("ERP_SOAP_URL no está configurada en .env");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml;charset=utf-8",
      SOAPAction: `"http://tempuri.org/ImportarXML"`,
    },
    body: buildEnvelope(lineasTexto),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status} al llamar al servicio SOAP`);
  const text = await res.text();
  return parseSoapRespuesta(text);
}

// ── POST handler ───────────────────────────────────────────────────────────
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  const filtroId = Number(id);

  const body = await req.json() as { bache: number; consecOpg: number; xml1: string; xml2: string; xml3: string };
  const { bache, consecOpg, xml1, xml2, xml3 } = body;

  if (!bache)     return NextResponse.json({ error: "Falta el número de lote (bache)" }, { status: 400 });
  if (!consecOpg) return NextResponse.json({ error: "Falta el consecutivo del documento (consecOpg)" }, { status: 400 });

  // El consecutivo ya fue incrementado por /api/export-produccion/seq-opg
  // antes de construir el XML; lo usamos directamente como numeroOpg.
  const numeroOpg = consecOpg;

  // 2. Crear registro inicial en OpgLog
  const log = await prisma.opgLog.create({
    data: {
      tipoDocumento: "OPG",
      numeroOpg,
      consecDocto:  consecOpg,
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

  // 3. Enviar los 3 documentos al ERP y parsear respuestas
  const pendiente: DocResult = {
    exitoso: false,
    printTipoError: -1,
    errores: [],
    respuestaRaw: "",
  };

  let ordenResult:  DocResult = pendiente;
  let consumoResult: DocResult = pendiente;
  let entregaResult: DocResult = pendiente;

  try {
    ordenResult = await callSoap(xml1);
  } catch (e) {
    ordenResult = { exitoso: false, printTipoError: -1, errores: [], respuestaRaw: String(e) };
  }

  // Solo continúa con consumo/entrega si la orden fue exitosa
  if (ordenResult.exitoso) {
    try {
      consumoResult = await callSoap(xml2);
    } catch (e) {
      consumoResult = { exitoso: false, printTipoError: -1, errores: [], respuestaRaw: String(e) };
    }
  }

  if (ordenResult.exitoso && consumoResult.exitoso) {
    try {
      entregaResult = await callSoap(xml3);
    } catch (e) {
      entregaResult = { exitoso: false, printTipoError: -1, errores: [], respuestaRaw: String(e) };
    }
  }

  const estadoOrden   = ordenResult.exitoso   ? "ENVIADO" : "ERROR";
  const estadoConsumo = consumoResult.exitoso  ? "ENVIADO" : (consumoResult.printTipoError === -1 && !ordenResult.exitoso ? "PENDIENTE" : "ERROR");
  const estadoEntrega = entregaResult.exitoso  ? "ENVIADO" : (entregaResult.printTipoError === -1 && (!ordenResult.exitoso || !consumoResult.exitoso) ? "PENDIENTE" : "ERROR");

  // 4. Actualizar el log con los resultados
  await prisma.opgLog.update({
    where: { id: log.id },
    data: {
      estadoOrdenProduccion:      estadoOrden,
      estadoConsumoProduccion:    estadoConsumo,
      estadoEntregaProduccion:    estadoEntrega,
      respuestaOrdenProduccion:   ordenResult.respuestaRaw,
      respuestaConsumoProduccion: consumoResult.respuestaRaw,
      respuestaEntregaProduccion: entregaResult.respuestaRaw,
      intentos: { increment: 1 },
    },
  });

  return NextResponse.json({
    logId: log.id,
    numeroOpg,
    orden:   { exitoso: ordenResult.exitoso,   errores: ordenResult.errores,   estado: estadoOrden },
    consumo: { exitoso: consumoResult.exitoso,  errores: consumoResult.errores,  estado: estadoConsumo },
    entrega: { exitoso: entregaResult.exitoso,  errores: entregaResult.errores,  estado: estadoEntrega },
  });
}
