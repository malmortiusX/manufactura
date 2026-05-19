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

// ── Tipo: componente de una OP consultado al ERP ──────────────────────────
export interface ComponenteOP {
  padreReferencia:   string;   // Padre_Referencia  (trimmed)
  bodegaId:          string;   // Bodega_id         (trimmed)
  hijoReferencia:    string;   // Hijo_Referencia   (trimmed)
  hijoUnidad:        string;   // Hijo_unidadMedida (trimmed)
  cantidadPendiente1: number;   // Cantidad_pendiente1
  cantidadPendiente2: number;   // Cantidad_pendiente2
}

// ── Envelope para EjecutarConsultaXML (consulta de componentes) ───────────
function buildQueryEnvelope(idCo: string, tipoDoc: string, nroDoc: number): string {
  const conexion = process.env.ERP_CONEXION ?? "";
  const cia      = process.env.ERP_CIA      ?? "1";
  const usuario  = process.env.ERP_USUARIO  ?? "";
  const clave    = process.env.ERP_CLAVE    ?? "";

  const consulta = `<Consulta>
<NombreConexion>${conexion}</NombreConexion>
<IdCia>${cia}</IdCia>
<IdProveedor>FENIX</IdProveedor>
<IdConsulta>WS_FENIX_COMPONENTES_OP</IdConsulta>
<Usuario>${usuario}</Usuario>
<Clave>${clave}</Clave>
<Parametros>
<idCia>${cia}</idCia>
<idCo>${idCo}</idCo>
<tipoDoc>${tipoDoc}</tipoDoc>
<nroDoc>${nroDoc}</nroDoc>
</Parametros>
</Consulta>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
<soapenv:Header/>
<soapenv:Body>
<tem:EjecutarConsultaXML>
<tem:pvstrxmlParametros><![CDATA[${consulta}]]></tem:pvstrxmlParametros>
</tem:EjecutarConsultaXML>
</soapenv:Body>
</soapenv:Envelope>`;
}

// ── Parser de respuesta de componentes ────────────────────────────────────
function parseComponentesRespuesta(xml: string): ComponenteOP[] {
  const dsStart = xml.indexOf("<NewDataSet");
  const dsEnd   = xml.indexOf("</NewDataSet>");
  if (dsStart === -1 || dsEnd === -1) return [];

  const dataset = xml.slice(dsStart, dsEnd + "</NewDataSet>".length);
  const chunks  = dataset.split(/<Resultado\b[^>]*>/);

  const get = (block: string, tag: string): string => {
    const open  = `<${tag}>`;
    const close = `</${tag}>`;
    const i = block.indexOf(open);
    if (i === -1) return "";
    return block.slice(i + open.length, block.indexOf(close, i)).trim();
  };

  const componentes: ComponenteOP[] = [];
  for (let k = 1; k < chunks.length; k++) {
    const content = chunks[k].split("</Resultado>")[0];
    componentes.push({
      padreReferencia:   get(content, "Padre_Referencia"),
      bodegaId:          get(content, "Bodega_id"),
      hijoReferencia:    get(content, "Hijo_Referencia"),
      hijoUnidad:        get(content, "Hijo_unidadMedida"),
      cantidadPendiente1: parseFloat(get(content, "Cantidad_pendiente1")) || 0,
      cantidadPendiente2: parseFloat(get(content, "Cantidad_pendiente2")) || 0,
    });
  }
  return componentes;
}

// ── Tipo: fila de existencia por lote consultada al ERP ──────────────────
export interface ExistenciaLoteItem {
  bodegaId:    string;   // Bodega_id         (trimmed)
  referencia:  string;   // Hijo_Referencia   (trimmed)
  unidad:      string;   // Hijo_unidadMedida (trimmed)
  pendiente1:  number;   // Cantidad_pendiente1
  pendiente2:  number;   // Cantidad_pendiente2
  lote:        string;   // Lote              (trimmed)
  disponible1: number;   // Cantidad_disponible1
  disponible2: number;   // Cantidad_disponible2
}

// ── Envelope para EjecutarConsultaXML (existencia por lote) ──────────────
function buildExistenciaEnvelope(idCo: string, tipoDoc: string, nroDoc: number): string {
  const conexion = process.env.ERP_CONEXION ?? "";
  const cia      = process.env.ERP_CIA      ?? "1";
  const usuario  = process.env.ERP_USUARIO  ?? "";
  const clave    = process.env.ERP_CLAVE    ?? "";

  const consulta = `<Consulta>
<NombreConexion>${conexion}</NombreConexion>
<IdCia>${cia}</IdCia>
<IdProveedor>FENIX</IdProveedor>
<IdConsulta>WS_FENIX_EXISTENCIALOTE_OP</IdConsulta>
<Usuario>${usuario}</Usuario>
<Clave>${clave}</Clave>
<Parametros>
<idCia>${cia}</idCia>
<idCo>${idCo}</idCo>
<tipoDoc>${tipoDoc}</tipoDoc>
<nroDoc>${nroDoc}</nroDoc>
</Parametros>
</Consulta>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
<soapenv:Header/>
<soapenv:Body>
<tem:EjecutarConsultaXML>
<tem:pvstrxmlParametros><![CDATA[${consulta}]]></tem:pvstrxmlParametros>
</tem:EjecutarConsultaXML>
</soapenv:Body>
</soapenv:Envelope>`;
}

// ── Parser de respuesta de existencias por lote ───────────────────────────
function parseExistenciaRespuesta(xml: string): ExistenciaLoteItem[] {
  const dsStart = xml.indexOf("<NewDataSet");
  const dsEnd   = xml.indexOf("</NewDataSet>");
  if (dsStart === -1 || dsEnd === -1) return [];

  const dataset = xml.slice(dsStart, dsEnd + "</NewDataSet>".length);
  const chunks  = dataset.split(/<Resultado\b[^>]*>/);

  const get = (block: string, tag: string): string => {
    const open  = `<${tag}>`;
    const close = `</${tag}>`;
    const i = block.indexOf(open);
    if (i === -1) return "";
    return block.slice(i + open.length, block.indexOf(close, i)).trim();
  };

  const items: ExistenciaLoteItem[] = [];
  for (let k = 1; k < chunks.length; k++) {
    const content = chunks[k].split("</Resultado>")[0];
    items.push({
      bodegaId:    get(content, "Bodega_id"),
      referencia:  get(content, "Hijo_Referencia"),
      unidad:      get(content, "Hijo_unidadMedida"),
      pendiente1:  parseFloat(get(content, "Cantidad_pendiente1")) || 0,
      pendiente2:  parseFloat(get(content, "Cantidad_pendiente2")) || 0,
      lote:        get(content, "Lote"),
      disponible1: parseFloat(get(content, "Cantidad_disponible1")) || 0,
      disponible2: parseFloat(get(content, "Cantidad_disponible2")) || 0,
    });
  }
  return items;
}

// ── Consulta de existencias por lote de una OP al ERP ────────────────────
export async function queryExistenciaLote(
  idCo:    string,
  tipoDoc: string,
  nroDoc:  number,
): Promise<ExistenciaLoteItem[]> {
  const url = process.env.ERP_SOAP_URL ?? "";
  if (!url) throw new Error("ERP_SOAP_URL no está configurada en .env");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: {
        "Content-Type": "text/xml;charset=utf-8",
        SOAPAction: `"http://tempuri.org/EjecutarConsultaXML"`,
      },
      body:   buildExistenciaEnvelope(idCo, tipoDoc, nroDoc),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!text) throw new Error("Sin respuesta al consultar existencias de la OP");
    return parseExistenciaRespuesta(text);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Tiempo de espera agotado al consultar existencias de la OP");
    }
    if (
      err instanceof TypeError &&
      err.message === "fetch failed" &&
      "cause" in err &&
      err.cause instanceof Error
    ) {
      throw new Error(`Error de red al consultar existencias [${(err as TypeError & { cause: Error }).cause.message}]`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Tipo: ítem de inventario por referencia ──────────────────────────────
export interface InventarioRefItem {
  referencia:  string;   // Referencia  (trimmed)
  descripcion: string;   // Descripcion (trimmed)
  bodegaId:    string;   // Bodega      (trimmed)
  unidad1:     string;   // Unid_Inv1   (trimmed)
  exist1:      number;   // Exist1
  exist2:      number;   // Exist2
}

// ── Envelope para WS_FENIX_INVENTARIO_REF ────────────────────────────────
function buildInventarioRefEnvelope(bodegaId: string, referencia: string): string {
  const conexion = process.env.ERP_CONEXION ?? "";
  const cia      = process.env.ERP_CIA      ?? "1";
  const usuario  = process.env.ERP_USUARIO  ?? "";
  const clave    = process.env.ERP_CLAVE    ?? "";

  const consulta = `<Consulta>
<NombreConexion>${conexion}</NombreConexion>
<IdCia>${cia}</IdCia>
<IdProveedor>FENIX</IdProveedor>
<IdConsulta>WS_FENIX_INVENTARIO_REF</IdConsulta>
<Usuario>${usuario}</Usuario>
<Clave>${clave}</Clave>
<Parametros>
<p_id_cia>${cia}</p_id_cia>
<p_id_bodega>${bodegaId}</p_id_bodega>
<p_Referencia>${referencia}</p_Referencia>
</Parametros>
</Consulta>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
<soapenv:Header/>
<soapenv:Body>
<tem:EjecutarConsultaXML>
<tem:pvstrxmlParametros><![CDATA[${consulta}]]></tem:pvstrxmlParametros>
</tem:EjecutarConsultaXML>
</soapenv:Body>
</soapenv:Envelope>`;
}

// ── Parser de respuesta de WS_FENIX_INVENTARIO_REF ───────────────────────
function parseInventarioRefRespuesta(xml: string): InventarioRefItem[] {
  const dsStart = xml.indexOf("<NewDataSet");
  const dsEnd   = xml.indexOf("</NewDataSet>");
  if (dsStart === -1 || dsEnd === -1) return [];

  const dataset = xml.slice(dsStart, dsEnd + "</NewDataSet>".length);
  const chunks  = dataset.split(/<Resultado\b[^>]*>/);

  const get = (block: string, tag: string): string => {
    const open  = `<${tag}>`;
    const close = `</${tag}>`;
    const i = block.indexOf(open);
    if (i === -1) return "";
    return block.slice(i + open.length, block.indexOf(close, i)).trim();
  };

  const items: InventarioRefItem[] = [];
  for (let k = 1; k < chunks.length; k++) {
    const content = chunks[k].split("</Resultado>")[0];
    items.push({
      referencia:  get(content, "Referencia"),
      descripcion: get(content, "Descripcion"),
      bodegaId:    get(content, "Bodega"),
      unidad1:     get(content, "Unid_Inv1"),
      exist1:      parseFloat(get(content, "Exist1")) || 0,
      exist2:      parseFloat(get(content, "Exist2")) || 0,
    });
  }
  return items;
}

// ── Consulta de inventario por bodega + referencia ───────────────────────
export async function queryInventarioRef(
  bodegaId:   string,
  referencia: string,
): Promise<InventarioRefItem[]> {
  const url = process.env.ERP_SOAP_URL ?? "";
  if (!url) throw new Error("ERP_SOAP_URL no está configurada en .env");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: {
        "Content-Type": "text/xml;charset=utf-8",
        SOAPAction: `"http://tempuri.org/EjecutarConsultaXML"`,
      },
      body:   buildInventarioRefEnvelope(bodegaId, referencia),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!text) throw new Error("Sin respuesta al consultar inventario de referencia");
    return parseInventarioRefRespuesta(text);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Tiempo de espera agotado al consultar inventario de referencia");
    }
    if (
      err instanceof TypeError &&
      err.message === "fetch failed" &&
      "cause" in err &&
      err.cause instanceof Error
    ) {
      throw new Error(`Error de red al consultar inventario [${(err as TypeError & { cause: Error }).cause.message}]`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Consulta de componentes de una OP al ERP ──────────────────────────────
export async function queryComponentesOP(
  idCo:    string,
  tipoDoc: string,
  nroDoc:  number,
): Promise<ComponenteOP[]> {
  const url = process.env.ERP_SOAP_URL ?? "";
  if (!url) throw new Error("ERP_SOAP_URL no está configurada en .env");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: {
        "Content-Type": "text/xml;charset=utf-8",
        SOAPAction: `"http://tempuri.org/EjecutarConsultaXML"`,
      },
      body:   buildQueryEnvelope(idCo, tipoDoc, nroDoc),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!text) throw new Error("Sin respuesta al consultar componentes de la OP");
    return parseComponentesRespuesta(text);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Tiempo de espera agotado al consultar componentes de la OP");
    }
    if (
      err instanceof TypeError &&
      err.message === "fetch failed" &&
      "cause" in err &&
      err.cause instanceof Error
    ) {
      throw new Error(`Error de red al consultar componentes [${(err as TypeError & { cause: Error }).cause.message}]`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Tipo: ítem de inventario por referencia y lote ──────────────────────────
export interface InventarioRefLoteItem {
  lote:          string;   // Lote                  (trimmed)
  fechaCreacion: string;   // Fecha_creacion ISO     (trimmed, para ordenar FIFO)
  unidInv1:      string;   // Unid_Inv1             (trimmed)
  unidInv2:      string;   // Unid_Inv2             (trimmed)
  disponible1:   number;   // Cantidad_disponible1
  disponible2:   number;   // Cantidad_disponible2
}

// ── Envelope para WS_FENIX_INVENTARIO_REF_LOTE ────────────────────────────
function buildInventarioRefLoteEnvelope(bodegaId: string, referencia: string): string {
  const conexion = process.env.ERP_CONEXION ?? "";
  const cia      = process.env.ERP_CIA      ?? "1";
  const usuario  = process.env.ERP_USUARIO  ?? "";
  const clave    = process.env.ERP_CLAVE    ?? "";

  const consulta = `<Consulta>
<NombreConexion>${conexion}</NombreConexion>
<IdCia>${cia}</IdCia>
<IdProveedor>FENIX</IdProveedor>
<IdConsulta>WS_FENIX_INVENTARIO_REF_LOTE</IdConsulta>
<Usuario>${usuario}</Usuario>
<Clave>${clave}</Clave>
<Parametros>
<p_id_cia>${cia}</p_id_cia>
<p_id_bodega>${bodegaId}</p_id_bodega>
<p_Referencia>${referencia}</p_Referencia>
</Parametros>
</Consulta>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
<soapenv:Header/>
<soapenv:Body>
<tem:EjecutarConsultaXML>
<tem:pvstrxmlParametros><![CDATA[${consulta}]]></tem:pvstrxmlParametros>
</tem:EjecutarConsultaXML>
</soapenv:Body>
</soapenv:Envelope>`;
}

// ── Parser de respuesta de WS_FENIX_INVENTARIO_REF_LOTE ──────────────────
function parseInventarioRefLoteRespuesta(xml: string): InventarioRefLoteItem[] {
  const dsStart = xml.indexOf("<NewDataSet");
  const dsEnd   = xml.indexOf("</NewDataSet>");
  if (dsStart === -1 || dsEnd === -1) return [];

  const dataset = xml.slice(dsStart, dsEnd + "</NewDataSet>".length);
  const chunks  = dataset.split(/<Resultado\b[^>]*>/);

  const get = (block: string, tag: string): string => {
    const open  = `<${tag}>`;
    const close = `</${tag}>`;
    const i = block.indexOf(open);
    if (i === -1) return "";
    return block.slice(i + open.length, block.indexOf(close, i)).trim();
  };

  const items: InventarioRefLoteItem[] = [];
  for (let k = 1; k < chunks.length; k++) {
    const content = chunks[k].split("</Resultado>")[0];
    items.push({
      lote:          get(content, "Lote"),
      fechaCreacion: get(content, "Fecha_creacion"),
      unidInv1:      get(content, "Unid_Inv1"),
      unidInv2:      get(content, "Unid_Inv2"),
      disponible1:   parseFloat(get(content, "Cantidad_disponible1")) || 0,
      disponible2:   parseFloat(get(content, "Cantidad_disponible2")) || 0,
    });
  }
  return items;
}

// ── Consulta de inventario por bodega + referencia + lote ────────────────
// Devuelve los lotes ya ordenados de más antiguo a más reciente (FIFO).
export async function queryInventarioRefLote(
  bodegaId:   string,
  referencia: string,
): Promise<InventarioRefLoteItem[]> {
  const url = process.env.ERP_SOAP_URL ?? "";
  if (!url) throw new Error("ERP_SOAP_URL no está configurada en .env");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: {
        "Content-Type": "text/xml;charset=utf-8",
        SOAPAction: `"http://tempuri.org/EjecutarConsultaXML"`,
      },
      body:   buildInventarioRefLoteEnvelope(bodegaId, referencia),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!text) throw new Error("Sin respuesta al consultar inventario por lote");
    const items = parseInventarioRefLoteRespuesta(text);
    // Ordenar FIFO: fecha_creacion ascendente (lote más antiguo primero)
    items.sort((a, b) => a.fechaCreacion.localeCompare(b.fechaCreacion));
    return items;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Tiempo de espera agotado al consultar inventario por lote");
    }
    if (
      err instanceof TypeError &&
      err.message === "fetch failed" &&
      "cause" in err &&
      err.cause instanceof Error
    ) {
      throw new Error(`Error de red al consultar inventario por lote [${(err as TypeError & { cause: Error }).cause.message}]`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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
// Se usa AbortController para cortar la espera a los 60 s y exponer la causa
// real del error de red (ECONNREFUSED, ETIMEDOUT, etc.).
export async function callSoap(lineasTexto: string): Promise<DocResult> {
  const url = process.env.ERP_SOAP_URL ?? "";
  if (!url) throw new Error("ERP_SOAP_URL no está configurada en .env");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000); // 60 s

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml;charset=utf-8",
        SOAPAction: `"http://tempuri.org/ImportarXML"`,
      },
      body: buildEnvelope(lineasTexto),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!text) throw new Error(`HTTP ${res.status} — sin cuerpo en la respuesta SOAP`);
    return parseSoapRespuesta(text);
  } catch (err) {
    // AbortController disparado: tiempo de espera agotado
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Tiempo de espera agotado al conectar con el ERP (60 s). URL: ${url}`);
    }
    // fetch failed: exponer la causa subyacente (ECONNREFUSED, ENOTFOUND, etc.)
    if (
      err instanceof TypeError &&
      err.message === "fetch failed" &&
      "cause" in err &&
      err.cause instanceof Error
    ) {
      throw new Error(`Error de red SOAP [${err.cause.message}] → ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
