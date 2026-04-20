// src/lib/erp-soap.ts
// Utilidades SOAP compartidas para integración con ERP.

// ── Tipos ──────────────────────────────────────────────────────────────────
export interface ErpError {
  nroLinea: number;
  tipoReg:  string;
  subtipo:  string;
  version:  string;
  nivel:    string;
  valor:    string;
  detalle:  string;
}

export interface DocResult {
  exitoso:       boolean;
  printTipoError: number;
  errores:       ErpError[];
  respuestaRaw:  string;
}

// ── Parser de respuesta SOAP ───────────────────────────────────────────────
// 1. Lee <printTipoError> — 0 = éxito, cualquier otro = error.
// 2. Si hay error, extrae los bloques <Table> del diffgram con indexOf/split
//    para evitar problemas con namespaces (diffgr:, msdata:, xs:).
export function parseSoapRespuesta(xml: string): DocResult {
  const tipoErrorMatch = xml.match(/<printTipoError>(\d+)<\/printTipoError>/);
  const printTipoError = tipoErrorMatch ? parseInt(tipoErrorMatch[1], 10) : 1;
  const exitoso = printTipoError === 0;

  const errores: ErpError[] = [];

  if (!exitoso) {
    const dsStart = xml.indexOf("<NewDataSet ");
    const dsEnd   = xml.indexOf("</NewDataSet>");
    if (dsStart !== -1 && dsEnd !== -1) {
      const dataset = xml.slice(dsStart, dsEnd + "</NewDataSet>".length);
      const chunks  = dataset.split(/<Table\b[^>]*>/);

      const get = (block: string, tag: string): string => {
        const open  = `<${tag}>`;
        const close = `</${tag}>`;
        const i = block.indexOf(open);
        if (i === -1) return "";
        return block.slice(i + open.length, block.indexOf(close, i)).trim();
      };

      for (let k = 1; k < chunks.length; k++) {
        const content = chunks[k].split("</Table>")[0];
        errores.push({
          nroLinea: parseInt(get(content, "f_nro_linea"), 10) || 0,
          tipoReg:  get(content, "f_tipo_reg"),
          subtipo:  get(content, "f_subtipo_reg"),
          version:  get(content, "f_version"),
          nivel:    get(content, "f_nivel"),
          valor:    get(content, "f_valor"),
          detalle:  get(content, "f_detalle"),
        });
      }
    }
  }

  return { exitoso, printTipoError, errores, respuestaRaw: xml };
}

// ── Construcción del envelope SOAP ────────────────────────────────────────
export function buildEnvelope(lineasTexto: string): string {
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

// ── Llamada SOAP → DocResult ───────────────────────────────────────────────
// SOAP devuelve HTTP 500 para faults pero el cuerpo sigue siendo XML válido.
// Siempre se lee el texto; parseSoapRespuesta determina éxito/error.
export async function callSoap(lineasTexto: string): Promise<DocResult> {
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

  const text = await res.text();
  if (!text) throw new Error(`HTTP ${res.status} — sin cuerpo en la respuesta SOAP`);
  return parseSoapRespuesta(text);
}
