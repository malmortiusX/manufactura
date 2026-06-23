// src/lib/lotes-stream.ts
// Lee la respuesta NDJSON del endpoint de lotes y llama a los callbacks
// según el tipo de mensaje recibido.

export interface ProductoLote {
  codigo: string;
  lote:   string;
}

export interface ErpError {
  nroLinea: number;
  tipoReg:  string;
  subtipo:  string;
  version:  string;
  nivel:    string;
  valor:    string;
  detalle:  string;
}

export interface LoteCreacionResult {
  exitoso:      boolean;
  omitidos:     ProductoLote[];
  nuevos:       ProductoLote[];
  creados:      ProductoLote[];
  errores:      ErpError[];
  respuestaRaw: string;
  xmlLotes:     string | null;
  error?:       string;
}

export interface LotesStreamCallbacks {
  onStart?:    (total: number) => void;
  onProgress?: (completado: number, total: number) => void;
  onDone:      (result: LoteCreacionResult) => void;
  onError:     (message: string) => void;
}

export async function leerLotesStream(
  response: Response,
  callbacks: LotesStreamCallbacks,
): Promise<void> {
  if (!response.body) {
    callbacks.onError("Sin cuerpo en la respuesta del servidor");
    return;
  }

  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let   buffer  = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(trimmed);
        } catch {
          continue;
        }

        if (msg.type === "start") {
          callbacks.onStart?.(msg.total as number);
        } else if (msg.type === "progress") {
          callbacks.onProgress?.(msg.completado as number, msg.total as number);
        } else if (msg.type === "done") {
          callbacks.onDone(msg as unknown as LoteCreacionResult);
        } else if (msg.type === "error") {
          callbacks.onError(String(msg.error ?? "Error desconocido"));
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
