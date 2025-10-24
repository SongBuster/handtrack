import { db } from "./dbLocal";

// ---- opciones tipadas
type ImportOptions<T = any> = {
  /** Campos a forzar/inyectar al importar (p.ej. user_id, team_id) */
  setFields?: Partial<T>;
  /** Regenerar IDs para evitar colisiones (por defecto: false) */
  regenerateIds?: boolean;
  /** Nombre del campo id (por defecto: "id") */
  idField?: string;
  /** Transformación adicional por registro (normalizar mayúsculas, etc.) */
  map?: (item: T) => T;
};

type ExportOptions = {
  /** Campos a omitir al exportar (por defecto: ver defaultOmit) */
  omitFields?: string[];
};

// ---- omisiones por defecto (para que sea portable entre usuarios/equipos)
const defaultOmit = ["synced", "pending_delete", "user_id", "team_id"];

function omit<T extends Record<string, any>>(obj: T, keys: string[]): Partial<T> {
  const out: Record<string, any> = {};
  for (const k of Object.keys(obj)) {
    if (!keys.includes(k)) out[k] = obj[k];
  }
  return out as Partial<T>;
}

/** Exporta una tabla Dexie a JSON limpio y portable (sin user/equipo). */
export async function exportTableToJSON(tableName: keyof typeof db, options?: ExportOptions) {
  if (!db[tableName]) throw new Error(`Tabla ${String(tableName)} no existe en Dexie`);
  // @ts-ignore
  const data = await db[tableName].toArray();
  const omitFields = options?.omitFields ?? defaultOmit;
  const cleaned = data.map((item: any) => omit(item, omitFields));

  const blob = new Blob([JSON.stringify(cleaned, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${String(tableName)}_backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  console.log(`✅ Exportados ${cleaned.length} registros de ${String(tableName)}`);
}

/** Importa JSON a una tabla Dexie. Inyecta user/equipo y marca como no sincronizado. */
export async function importTableFromJSON<T = any>(
  tableName: keyof typeof db,
  file: File,
  options?: ImportOptions<T>
) {
  if (!db[tableName]) throw new Error(`Tabla ${String(tableName)} no existe en Dexie`);

  const text = await file.text();
  const raw = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error("El archivo no contiene un array de objetos válido");

  const idField = options?.idField ?? "id";
  const regenerateIds = options?.regenerateIds ?? false;

  const enriched = raw.map((item: any) => {
    let base: any = {
      ...item,
      ...options?.setFields,     // inyecta user_id, team_id, etc.
      synced: false,
      pending_delete: false,
    };
    if (regenerateIds) {
      base[idField] = crypto.randomUUID();
    }
    if (options?.map) base = options.map(base);
    return base;
  });

  // @ts-ignore
  await db[tableName].bulkPut(enriched);

  console.log(`✅ Importados ${enriched.length} registros a ${String(tableName)}`);
  return enriched.length;
}
