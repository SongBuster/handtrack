import { db, type AutomaticOutcome, type Section, type Situation, type Tag } from "./dbLocal";

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

type SituationsBundle = {
  situations: Array<Pick<Situation, "id" | "name" | "next_situation_id">>;
  sections: Array<
    Pick<Section, "id" | "situation_id" | "name" | "remember_selection">
  >;
  tags: Array<
    Pick<
      Tag,
      |
        "id"
        | "section_id"
        | "name"
        | "highlighted"
        | "default_selected"
        | "positive_value"
        | "negative_value"
        | "automatic_outcome"
        | "play_finishes"
    >
  >;
};

const allowedAutomaticOutcomes: AutomaticOutcome[] = ["positive", "negative"];

function toBoolean(value: unknown, defaultValue = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "sí", "si", "yes"].includes(normalized);
  }
  return defaultValue;
}

function toNumber(value: unknown, defaultValue = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return defaultValue;
}

function sanitizeAutomaticOutcome(value: unknown): AutomaticOutcome | null {
  if (typeof value !== "string") return null;
  return allowedAutomaticOutcomes.includes(value as AutomaticOutcome)
    ? (value as AutomaticOutcome)
    : null;
}

function assertString(value: unknown, errorMessage: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  throw new Error(errorMessage);
}

function omitMeta<T extends object>(record: T, keys: string[]) {
  const clone: Partial<T> = { ...(record as any) };
  for (const key of keys) {
    if (key in clone) {
      delete (clone as any)[key];
    }
  }
  return clone;
}

const situationOmit = ["synced", "pending_delete", "user_id"];
const sectionOmit = ["synced", "pending_delete"];
const tagOmit = ["synced", "pending_delete"];

export async function exportSituationsBundle(userId: string) {
  const situations = await db.situations
    .where("user_id")
    .equals(userId)
    .toArray();

  const situationIds = situations
    .map((situation) => situation.id)
    .filter((id): id is string => typeof id === "string");

  const sections = situationIds.length
    ? await db.sections
        .where("situation_id")
        .anyOf(situationIds)
        .toArray()
    : [];

  const sectionIds = sections
    .map((section) => section.id)
    .filter((id): id is string => typeof id === "string");

  const tags = sectionIds.length
    ? await db.tags
        .where("section_id")
        .anyOf(sectionIds)
        .toArray()
    : [];

  const bundle: SituationsBundle = {
    situations: situations.map((situation) =>
      omitMeta(situation, situationOmit) as SituationsBundle["situations"][number]
    ),
    sections: sections.map((section) =>
      omitMeta(section, sectionOmit) as SituationsBundle["sections"][number]
    ),
    tags: tags.map((tag) =>
      omitMeta(tag, tagOmit) as SituationsBundle["tags"][number]
    ),
  };

  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `situations_bundle_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  console.log(
    `✅ Exportadas ${situations.length} situaciones, ${sections.length} secciones y ${tags.length} etiquetas`
  );
}

type ImportSituationsResult = {
  situations: number;
  sectionsImported: number;
  sectionsSkipped: number;
  tagsImported: number;
  tagsSkipped: number;
};

export async function importSituationsBundle(
  file: File,
  options: { userId: string }
): Promise<ImportSituationsResult> {
  if (!options.userId) {
    throw new Error("Falta userId para importar situaciones");
  }

  const text = await file.text();
  const parsed = JSON.parse(text) as Partial<SituationsBundle> | undefined;

  const rawSituations = Array.isArray(parsed?.situations)
    ? parsed!.situations
    : [];
  const rawSections = Array.isArray(parsed?.sections) ? parsed!.sections : [];
  const rawTags = Array.isArray(parsed?.tags) ? parsed!.tags : [];

  if (rawSituations.length === 0 && rawSections.length === 0 && rawTags.length === 0) {
    throw new Error("El archivo no contiene datos de situaciones, secciones o etiquetas");
  }

  const situationIdMap = new Map<string, string>();
  for (const [index, situation] of rawSituations.entries()) {
    const oldId = assertString(
      situation.id,
      `Situación ${index + 1} sin identificador válido`
    );
    situationIdMap.set(oldId, crypto.randomUUID());
  }

  const preparedSituations: Situation[] = rawSituations.map((situation, index) => {
    const oldId = assertString(
      situation.id,
      `Situación ${index + 1} sin identificador válido`
    );
    const newId = situationIdMap.get(oldId)!;
    const nextOldId =
      typeof situation.next_situation_id === "string" && situation.next_situation_id.trim().length > 0
        ? situation.next_situation_id.trim()
        : null;
    const nextMappedId = nextOldId ? situationIdMap.get(nextOldId) ?? null : null;

    const name = typeof situation.name === "string" && situation.name.trim().length > 0
      ? situation.name.trim()
      : `Situación importada ${index + 1}`;

    return {
      id: newId,
      name,
      next_situation_id: nextMappedId,
      user_id: options.userId,
      synced: false,
      pending_delete: false,
    };
  });

  const sectionIdMap = new Map<string, string>();
  const preparedSections: Section[] = [];
  let skippedSections = 0;

  rawSections.forEach((section, index) => {
    try {
      const oldId = assertString(
        section.id,
        `Sección ${index + 1} sin identificador válido`
      );
      const oldSituationId = assertString(
        section.situation_id,
        `Sección ${index + 1} sin situación asociada`
      );
      const mappedSituationId = situationIdMap.get(oldSituationId);
      if (!mappedSituationId) {
        skippedSections += 1;
        return;
      }

      const newId = crypto.randomUUID();
      sectionIdMap.set(oldId, newId);

      preparedSections.push({
        id: newId,
        situation_id: mappedSituationId,
        name:
          typeof section.name === "string" && section.name.trim().length > 0
            ? section.name.trim()
            : `Sección importada ${index + 1}`,
        remember_selection: toBoolean(section.remember_selection, false),
        synced: false,
        pending_delete: false,
      });
    } catch (error) {
      skippedSections += 1;
    }
  });

  const preparedTags: Tag[] = [];
  let skippedTags = 0;

  rawTags.forEach((tag, index) => {
    try {
      assertString(tag.id, `Etiqueta ${index + 1} sin identificador válido`);
      const oldSectionId = assertString(
        tag.section_id,
        `Etiqueta ${index + 1} sin sección asociada`
      );
      const mappedSectionId = sectionIdMap.get(oldSectionId);
      if (!mappedSectionId) {
        skippedTags += 1;
        return;
      }

      preparedTags.push({
        id: crypto.randomUUID(),
        section_id: mappedSectionId,
        name:
          typeof tag.name === "string" && tag.name.trim().length > 0
            ? tag.name.trim()
            : `Etiqueta importada ${index + 1}`,
        highlighted: toBoolean(tag.highlighted, false),
        default_selected: toBoolean(tag.default_selected, false),
        positive_value: toNumber(tag.positive_value, 0),
        negative_value: toNumber(tag.negative_value, 0),
        automatic_outcome: sanitizeAutomaticOutcome(tag.automatic_outcome),
        play_finishes: toBoolean(tag.play_finishes, false),
        synced: false,
        pending_delete: false,
      });
    } catch (error) {
      skippedTags += 1;
    }
  });

  await db.transaction("rw", db.situations, db.sections, db.tags, async () => {
    if (preparedSituations.length > 0) {
      await db.situations.bulkAdd(preparedSituations);
    }
    if (preparedSections.length > 0) {
      await db.sections.bulkAdd(preparedSections);
    }
    if (preparedTags.length > 0) {
      await db.tags.bulkAdd(preparedTags);
    }
  });

  console.log(
    `✅ Importadas ${preparedSituations.length} situaciones, ${preparedSections.length} secciones y ${preparedTags.length} etiquetas`
  );

  return {
    situations: preparedSituations.length,
    sectionsImported: preparedSections.length,
    sectionsSkipped: skippedSections,
    tagsImported: preparedTags.length,
    tagsSkipped: skippedTags,
  };
}