import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import Navbar from "../components/Navbar";
import LoadingIndicator from "../components/LoadingIndicator";
import {
  db,
  type Situation,
  type Section,
  type Tag,
  type AutomaticOutcome,
} from "../services/dbLocal";
import { supabase } from "../services/dbCloud";
import { syncSituations, syncSections, syncTags } from "../services/syncQueue";
import {
  exportSituationsBundle,
  importSituationsBundle,
} from "../services/dataTransfer";

interface SituationFormState {
  name: string;
  nextSituationId: string;
}

interface SectionFormState {
  name: string;
  rememberSelection: string;
}

type AutomaticOutcomeOption = "" | AutomaticOutcome;

interface TagFormState {
  name: string;
  highlighted: string;
  defaultSelected: string;
  automaticOutcome: AutomaticOutcomeOption;
  playFinishes: string;
  positiveValue: string;
  negativeValue: string;
}

type ModalMode = "create" | "edit";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

function Modal({ title, onClose, children }: ModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-lg bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
        <div className="px-4 py-5">{children}</div>
      </div>
    </div>
  );
}

const defaultSituationForm: SituationFormState = {
  name: "",
  nextSituationId: "",
};

const defaultSectionForm: SectionFormState = {
  name: "",
  rememberSelection: "no",
};

const defaultTagForm: TagFormState = {
  name: "",
  highlighted: "no",
  defaultSelected: "no",
  automaticOutcome: "",
  playFinishes: "no",
  positiveValue: "0",
  negativeValue: "0",
};

export default function SituationsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [situations, setSituations] = useState<Situation[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  const [selectedSituationId, setSelectedSituationId] = useState<string | null>(
    null
  );
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    null
  );

  const [situationForm, setSituationForm] = useState(defaultSituationForm);
  const [sectionForm, setSectionForm] = useState(defaultSectionForm);
  const [tagForm, setTagForm] = useState(defaultTagForm);

  const [situationModalMode, setSituationModalMode] =
    useState<ModalMode>("create");
  const [isSituationModalOpen, setIsSituationModalOpen] = useState(false);
  const [activeSituationId, setActiveSituationId] = useState<string | null>(
    null
  );

  const [sectionModalMode, setSectionModalMode] = useState<ModalMode>("create");
  const [isSectionModalOpen, setIsSectionModalOpen] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  const [tagModalMode, setTagModalMode] = useState<ModalMode>("create");
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);

  const selectedSituation = useMemo(
    () =>
      situations.find((situation) => situation.id === selectedSituationId) ??
      null,
    [situations, selectedSituationId]
  );

  const selectedSection = useMemo(
    () => sections.find((section) => section.id === selectedSectionId) ?? null,
    [sections, selectedSectionId]
  );

  useEffect(() => {
    let canceled = false;

    const initialize = async () => {
      setIsLoading(true);
      try {
        const { data } = await supabase.auth.getUser();
        const currentUserId = data.user?.id ?? null;
        if (!currentUserId) {
          setUserId(null);
          setSituations([]);
          setSections([]);
          setTags([]);
          setSelectedSituationId(null);
          setSelectedSectionId(null);
          return;
        }

        setUserId(currentUserId);
        await loadSituations(currentUserId, canceled);
        try {
          await syncSituations();
        } catch (error) {
          console.warn(
            "Sincronización de situaciones fallida (offline?):",
            error
          );
        }
        await loadSituations(currentUserId, canceled);
      } finally {
        if (!canceled) {
          setIsLoading(false);
        }
      }
    };

    void initialize();

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedSituationId) {
      setSections([]);
      setSelectedSectionId(null);
      closeSectionModal();
      closeTagModal();
      return;
    }

    let canceled = false;
    const loadForSituation = async () => {
      try {
        await loadSections(selectedSituationId, canceled);
        try {
          await syncSections();
        } catch (error) {
          console.warn(
            "Sincronización de secciones fallida (offline?):",
            error
          );
        }
        await loadSections(selectedSituationId, canceled);
      } catch (error) {
        console.error("Error cargando secciones:", error);
      }
    };

    void loadForSituation();

    return () => {
      canceled = true;
    };
  }, [selectedSituationId]);

  useEffect(() => {
    if (!selectedSectionId) {
      setTags([]);
      closeTagModal();
      return;
    }

    let canceled = false;
    const loadForSection = async () => {
      try {
        await loadTags(selectedSectionId, canceled);
        try {
          await syncTags();
        } catch (error) {
          console.warn(
            "Sincronización de etiquetas fallida (offline?):",
            error
          );
        }
        await loadTags(selectedSectionId, canceled);
      } catch (error) {
        console.error("Error cargando etiquetas:", error);
      }
    };

    void loadForSection();

    return () => {
      canceled = true;
    };
  }, [selectedSectionId]);

  async function loadSituations(currentUserId: string, canceled: boolean) {
    const situationsFromDb = await db.situations
      .where("user_id")
      .equals(currentUserId)
      .filter((situation) => !situation.pending_delete)
      .toArray();

    if (!canceled) {
      setSituations(situationsFromDb);
      if (situationsFromDb.length > 0) {
        setSelectedSituationId((prev) => {
          if (prev && situationsFromDb.some((s) => s.id === prev)) {
            return prev;
          }
          return situationsFromDb[0]?.id ?? null;
        });
      } else {
        setSelectedSituationId(null);
      }
    }
  }

  async function loadSections(situationId: string, canceled: boolean) {
    const sectionsFromDb = await db.sections
      .where("situation_id")
      .equals(situationId)
      .filter((section) => !section.pending_delete)
      .toArray();

    if (!canceled) {
      setSections(sectionsFromDb);
      if (sectionsFromDb.length > 0) {
        setSelectedSectionId((prev) => {
          if (prev && sectionsFromDb.some((section) => section.id === prev)) {
            return prev;
          }
          return sectionsFromDb[0]?.id ?? null;
        });
      } else {
        setSelectedSectionId(null);
      }
    }
  }

  async function loadTags(sectionId: string, canceled: boolean) {
    const tagsFromDb = await db.tags
      .where("section_id")
      .equals(sectionId)
      .filter((tag) => !tag.pending_delete)
      .toArray();

    if (!canceled) {
      setTags(tagsFromDb);
    }
  }

  function openCreateSituationModal() {
    setSituationModalMode("create");
    setActiveSituationId(null);
    setSituationForm(defaultSituationForm);
    setIsSituationModalOpen(true);
  }

  function openEditSituationModal(situation: Situation) {
    setSituationModalMode("edit");
    setActiveSituationId(situation.id ?? null);
    setSituationForm({
      name: situation.name,
      nextSituationId: situation.next_situation_id ?? "",
    });
    setIsSituationModalOpen(true);
  }

  function closeSituationModal() {
    setIsSituationModalOpen(false);
    setSituationModalMode("create");
    setActiveSituationId(null);
    setSituationForm(defaultSituationForm);
  }

  async function handleSituationSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!situationForm.name.trim()) {
      return;
    }

    if (situationModalMode === "create") {
      if (!userId) return;

      const newSituation: Situation = {
        id: crypto.randomUUID(),
        name: situationForm.name.trim(),
        next_situation_id: situationForm.nextSituationId || null,
        user_id: userId,
        synced: false,
        pending_delete: false,
      };

      await db.situations.add(newSituation);

      try {
        await syncSituations();
      } catch (error) {
        console.warn(
          "Sincronización de situaciones fallida (offline?):",
          error
        );
      }

      await loadSituations(userId, false);
    } else if (situationModalMode === "edit" && activeSituationId) {
      await db.situations.update(activeSituationId, {
        name: situationForm.name.trim(),
        next_situation_id: situationForm.nextSituationId || null,
        synced: false,
      });

      try {
        await syncSituations();
      } catch (error) {
        console.warn(
          "Sincronización de situaciones fallida (offline?):",
          error
        );
      }

      if (userId) {
        await loadSituations(userId, false);
      }
    }

    closeSituationModal();
  }

  async function deleteSituation(situation: Situation) {
    if (!situation.id) return;

    if (
      isSituationModalOpen &&
      situationModalMode === "edit" &&
      activeSituationId === situation.id
    ) {
      closeSituationModal();
    }

    const relatedSections = await db.sections
      .where("situation_id")
      .equals(situation.id)
      .toArray();

    for (const section of relatedSections) {
      await deleteSection(section, { skipSync: true });
    }

    if (!situation.synced) {
      await db.situations.delete(situation.id);
    } else {
      await db.situations.update(situation.id, {
        pending_delete: true,
        synced: false,
      });
    }

    try {
      await syncSituations();
      await syncSections();
      await syncTags();
    } catch (error) {
      console.warn("Sincronización fallida tras borrar situación:", error);
    }

    if (userId) {
      await loadSituations(userId, false);
    }
  }

  function openCreateSectionModal() {
    if (!selectedSituationId) return;

    setSectionModalMode("create");
    setActiveSectionId(null);
    setSectionForm(defaultSectionForm);
    setIsSectionModalOpen(true);
  }

  function openEditSectionModal(section: Section) {
    setSectionModalMode("edit");
    setActiveSectionId(section.id ?? null);
    setSectionForm({
      name: section.name,
      rememberSelection: section.remember_selection ? "yes" : "no",
    });
    setIsSectionModalOpen(true);
  }

  function closeSectionModal() {
    setIsSectionModalOpen(false);
    setSectionModalMode("create");
    setActiveSectionId(null);
    setSectionForm(defaultSectionForm);
  }

  async function handleSectionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!sectionForm.name.trim()) {
      return;
    }

    if (sectionModalMode === "create") {
      if (!selectedSituationId) return;

      const newSection: Section = {
        id: crypto.randomUUID(),
        situation_id: selectedSituationId,
        name: sectionForm.name.trim(),
        remember_selection: sectionForm.rememberSelection === "yes",
        synced: false,
        pending_delete: false,
      };

      await db.sections.add(newSection);

      try {
        await syncSections();
      } catch (error) {
        console.warn("Sincronización de secciones fallida (offline?):", error);
      }

      await loadSections(selectedSituationId, false);
    } else if (sectionModalMode === "edit" && activeSectionId) {
      await db.sections.update(activeSectionId, {
        name: sectionForm.name.trim(),
        remember_selection: sectionForm.rememberSelection === "yes",
        synced: false,
      });

      try {
        await syncSections();
      } catch (error) {
        console.warn("Sincronización de secciones fallida (offline?):", error);
      }

      if (selectedSituationId) {
        await loadSections(selectedSituationId, false);
      }
    }

    closeSectionModal();
  }

  async function deleteSection(
    section: Section,
    options?: { skipSync?: boolean }
  ) {
    if (!section.id) return;

    if (
      isSectionModalOpen &&
      sectionModalMode === "edit" &&
      activeSectionId === section.id
    ) {
      closeSectionModal();
    }

    const relatedTags = await db.tags
      .where("section_id")
      .equals(section.id)
      .toArray();

    for (const tag of relatedTags) {
      await deleteTag(tag, { skipSync: true });
    }

    if (!section.synced) {
      await db.sections.delete(section.id);
    } else {
      await db.sections.update(section.id, {
        pending_delete: true,
        synced: false,
      });
    }

    if (!options?.skipSync) {
      try {
        await syncSections();
        await syncTags();
      } catch (error) {
        console.warn("Sincronización fallida tras borrar sección:", error);
      }
    }

    if (selectedSituationId) {
      await loadSections(selectedSituationId, false);
    }
  }

  function openCreateTagModal() {
    if (!selectedSectionId) return;

    setTagModalMode("create");
    setActiveTagId(null);
    setTagForm(defaultTagForm);
    setIsTagModalOpen(true);
  }

  function openEditTagModal(tag: Tag) {
    setTagModalMode("edit");
    setActiveTagId(tag.id ?? null);
    setTagForm({
      name: tag.name,
      highlighted: tag.highlighted ? "yes" : "no",
      defaultSelected: tag.default_selected ? "yes" : "no",
      automaticOutcome: (tag.automatic_outcome ?? "") as AutomaticOutcomeOption,
      playFinishes: tag.play_finishes ? "yes" : "no",
      positiveValue: String(tag.positive_value ?? 0),
      negativeValue: String(tag.negative_value ?? 0),
    });
    setIsTagModalOpen(true);
  }

  function closeTagModal() {
    setIsTagModalOpen(false);
    setTagModalMode("create");
    setActiveTagId(null);
    setTagForm(defaultTagForm);
  }

  async function handleTagSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!tagForm.name.trim()) {
      return;
    }

    if (tagModalMode === "create") {
      if (!selectedSectionId) return;

      const newTag: Tag = {
        id: crypto.randomUUID(),
        section_id: selectedSectionId,
        name: tagForm.name.trim(),
        highlighted: tagForm.highlighted === "yes",
        default_selected: tagForm.defaultSelected === "yes",
        automatic_outcome: tagForm.automaticOutcome || null,
        play_finishes: tagForm.playFinishes === "yes",
        positive_value: Number(tagForm.positiveValue) || 0,
        negative_value: Number(tagForm.negativeValue) || 0,
        synced: false,
        pending_delete: false,
      };

      await db.tags.add(newTag);

      try {
        await syncTags();
      } catch (error) {
        console.warn("Sincronización de etiquetas fallida (offline?):", error);
      }

      await loadTags(selectedSectionId, false);
    } else if (tagModalMode === "edit" && activeTagId) {
      await db.tags.update(activeTagId, {
        name: tagForm.name.trim(),
        highlighted: tagForm.highlighted === "yes",
        default_selected: tagForm.defaultSelected === "yes",
        automatic_outcome: tagForm.automaticOutcome || null,
        play_finishes: tagForm.playFinishes === "yes",
        positive_value: Number(tagForm.positiveValue) || 0,
        negative_value: Number(tagForm.negativeValue) || 0,
        synced: false,
      });

      try {
        await syncTags();
      } catch (error) {
        console.warn("Sincronización de etiquetas fallida (offline?):", error);
      }

      if (selectedSectionId) {
        await loadTags(selectedSectionId, false);
      }
    }

    closeTagModal();
  }

  async function deleteTag(tag: Tag, options?: { skipSync?: boolean }) {
    if (!tag.id) return;

    if (isTagModalOpen && tagModalMode === "edit" && activeTagId === tag.id) {
      closeTagModal();
    }

    if (!tag.synced) {
      await db.tags.delete(tag.id);
    } else {
      await db.tags.update(tag.id, {
        pending_delete: true,
        synced: false,
      });
    }

    if (!options?.skipSync) {
      try {
        await syncTags();
      } catch (error) {
        console.warn("Sincronización fallida tras borrar etiqueta:", error);
      }
    }

    if (selectedSectionId) {
      await loadTags(selectedSectionId, false);
    }
  }

  function renderSituationActions(situation: Situation) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={(event) => {
            event.stopPropagation();
            openEditSituationModal(situation);
          }}
          className="rounded bg-yellow-100 px-2 py-1 text-sm text-yellow-700"
        >
          Editar
        </button>
        <button
          onClick={(event) => {
            event.stopPropagation();
            void deleteSituation(situation);
          }}
          className="rounded bg-red-100 px-2 py-1 text-sm text-red-600"
        >
          Eliminar
        </button>
      </div>
    );
  }

  function renderSectionActions(section: Section) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={(event) => {
            event.stopPropagation();
            openEditSectionModal(section);
          }}
          className="rounded bg-yellow-100 px-2 py-1 text-sm text-yellow-700"
        >
          Editar
        </button>
        <button
          onClick={(event) => {
            event.stopPropagation();
            void deleteSection(section);
          }}
          className="rounded bg-red-100 px-2 py-1 text-sm text-red-600"
        >
          Eliminar
        </button>
      </div>
    );
  }

  function renderTagActions(tag: Tag) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={(event) => {
            event.stopPropagation();
            openEditTagModal(tag);
          }}
          className="rounded bg-yellow-100 px-2 py-1 text-sm text-yellow-700"
        >
          Editar
        </button>
        <button
          onClick={(event) => {
            event.stopPropagation();
            void deleteTag(tag);
          }}
          className="rounded bg-red-100 px-2 py-1 text-sm text-red-600"
        >
          Eliminar
        </button>
      </div>
    );
  }

  const isSituationSubmitDisabled = !situationForm.name.trim();
  const isSectionSubmitDisabled =
    !sectionForm.name.trim() ||
    (sectionModalMode === "create" && !selectedSituationId);
  const isTagSubmitDisabled =
    !tagForm.name.trim() || (tagModalMode === "create" && !selectedSectionId);

  if (isLoading) {
    return (
      <>
        <Navbar />
        <LoadingIndicator
          className="min-h-[50vh]"
          message="Cargando situaciones..."
        />
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="px-4 py-6">
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              Gestión de situaciones, secciones y etiquetas
            </h1>
            <p className="text-sm text-gray-600">
              Administra tus situaciones y sincronízalas entre dispositivos.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                if (!userId) {
                  alert("❌ Debes iniciar sesión para exportar tus datos.");
                  return;
                }
                setIsTransferring(true);
                try {
                  await exportSituationsBundle(userId);
                } catch (error) {
                  console.error("❌ Error al exportar situaciones:", error);
                  alert(
                    error instanceof Error
                      ? `❌ Error al exportar: ${error.message}`
                      : "❌ Error desconocido al exportar"
                  );
                } finally {
                  setIsTransferring(false);
                }
              }}
              disabled={!userId || isTransferring}
              className={`rounded border border-gray-300 px-3 py-2 text-sm transition-colors ${
                !userId || isTransferring
                  ? "cursor-not-allowed bg-gray-100 text-gray-400"
                  : "bg-gray-50 text-gray-700 hover:bg-gray-100"
              }`}
            >
              📤 Exportar todo
            </button>
            <label
              className={`rounded border border-gray-300 px-3 py-2 text-sm transition-colors ${
                !userId || isTransferring
                  ? "cursor-not-allowed bg-gray-100 text-gray-400"
                  : "bg-gray-50 text-gray-700 hover:bg-gray-100 cursor-pointer"
              }`}
            >
              📥 Importar todo
              <input
                type="file"
                accept="application/json"
                className="hidden"
                disabled={!userId || isTransferring}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (!userId) {
                    alert("❌ Debes iniciar sesión para importar tus datos.");
                    event.target.value = "";
                    return;
                  }

                  setIsTransferring(true);
                  try {
                    const result = await importSituationsBundle(file, {
                      userId,
                    });
                    await loadSituations(userId, false);
                    try {
                      await syncSituations();
                      await syncSections();
                      await syncTags();
                    } catch (syncError) {
                      console.warn(
                        "Sincronización tras importar situaciones fallida (offline?):",
                        syncError
                      );
                    }
                    if (userId) {
                      await loadSituations(userId, false);
                    }
                    alert(
                      `✅ Importadas ${result.situations} situaciones, ${
                        result.sectionsImported
                      } secciones y ${result.tagsImported} etiquetas${
                        result.sectionsSkipped || result.tagsSkipped
                          ? `. Se omitieron ${
                              result.sectionsSkipped + result.tagsSkipped
                            } elementos sin relación válida.`
                          : ""
                      }`
                    );
                  } catch (error) {
                    console.error("❌ Error al importar situaciones:", error);
                    alert(
                      error instanceof Error
                        ? `❌ Error al importar: ${error.message}`
                        : "❌ Error desconocido al importar"
                    );
                  } finally {
                    setIsTransferring(false);
                    event.target.value = "";
                  }
                }}
              />
            </label>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-xl font-semibold">Situaciones</h2>
              <button
                onClick={openCreateSituationModal}
                className="rounded bg-blue-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
              >
                Crear situación
              </button>
            </div>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {situations.map((situation) => {
                const isSelected = situation.id === selectedSituationId;
                return (
                  <div
                    key={situation.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedSituationId(situation.id ?? null)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedSituationId(situation.id ?? null);
                      }
                    }}
                    className={`rounded border p-3 transition focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                      isSelected
                        ? "border-blue-500 bg-blue-50"
                        : "cursor-pointer hover:border-blue-300 hover:bg-blue-50/40"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{situation.name}</p>
                        {situation.next_situation_id && (
                          <p className="text-sm text-gray-500">
                            Siguiente:{" "}
                            {situations.find(
                              (s) => s.id === situation.next_situation_id
                            )?.name ?? "-"}
                          </p>
                        )}
                      </div>
                      {renderSituationActions(situation)}
                    </div>
                  </div>
                );
              })}
              {situations.length === 0 && (
                <p className="text-sm text-gray-500">
                  No hay situaciones creadas todavía.
                </p>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-xl font-semibold">Secciones</h2>
              <button
                onClick={openCreateSectionModal}
                disabled={!selectedSituation}
                className={`rounded px-3 py-2 text-sm font-medium transition-colors ${
                  selectedSituation
                    ? "bg-blue-500 text-white hover:bg-blue-600"
                    : "cursor-not-allowed bg-gray-200 text-gray-500"
                }`}
              >
                Crear sección
              </button>
            </div>
            {selectedSituation ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-500">
                  Situación seleccionada:{" "}
                  <span className="font-semibold">
                    {selectedSituation.name}
                  </span>
                </p>
                <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                  {sections.map((section) => {
                    const isSelected = section.id === selectedSectionId;
                    return (
                      <div
                        key={section.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedSectionId(section.id ?? null)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedSectionId(section.id ?? null);
                          }
                        }}
                        className={`rounded border p-3 transition focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                          isSelected
                            ? "border-blue-500 bg-blue-50"
                            : "cursor-pointer hover:border-blue-300 hover:bg-blue-50/40"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold">{section.name}</p>
                            <p className="text-sm text-gray-500">
                              Recordar selección:{" "}
                              {section.remember_selection ? "Sí" : "No"}
                            </p>
                          </div>
                          {renderSectionActions(section)}
                        </div>
                      </div>
                    );
                  })}
                  {sections.length === 0 && (
                    <p className="text-sm text-gray-500">
                      No hay secciones para esta situación.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                Selecciona una situación para gestionar sus secciones.
              </p>
            )}
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-xl font-semibold">Etiquetas</h2>
              <button
                onClick={openCreateTagModal}
                disabled={!selectedSection}
                className={`rounded px-3 py-2 text-sm font-medium transition-colors ${
                  selectedSection
                    ? "bg-blue-500 text-white hover:bg-blue-600"
                    : "cursor-not-allowed bg-gray-200 text-gray-500"
                }`}
              >
                Crear etiqueta
              </button>
            </div>
            {selectedSection ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-500">
                  Sección seleccionada:{" "}
                  <span className="font-semibold">{selectedSection.name}</span>
                </p>
                <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                  {tags.map((tag) => (
                    <div key={tag.id} className="rounded border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-semibold">{tag.name}</p>
                        {renderTagActions(tag)}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-gray-600">
                        <p className="font-medium text-gray-700">
                          Destacada: {tag.highlighted ? "Sí" : "No"}
                        </p>
                        <p className="font-medium text-gray-700">
                          Por defecto: {tag.default_selected ? "Sí" : "No"}
                        </p>
                        <p className="font-medium text-gray-700">
                          Finaliza jugada: {tag.play_finishes ? "Sí" : "No"}
                        </p>
                        <p className="font-medium text-gray-700">
                          Resultado automático:{" "}
                          {tag.automatic_outcome
                            ? tag.automatic_outcome === "positive"
                              ? "Positivo"
                              : "Negativo"
                            : "Ninguno"}
                        </p>
                        <p className="font-medium text-gray-700">
                          Valor positivo: {tag.positive_value ?? 0}
                        </p>
                        <p className="font-medium text-gray-700">
                          Valor negativo: {tag.negative_value ?? 0}
                        </p>
                      </div>
                    </div>
                  ))}
                  {tags.length === 0 && (
                    <p className="text-sm text-gray-500">
                      No hay etiquetas para esta sección.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                Selecciona una sección para gestionar sus etiquetas.
              </p>
            )}
          </div>
        </div>
      </div>

      {isSituationModalOpen && (
        <Modal
          title={
            situationModalMode === "create"
              ? "Crear situación"
              : "Editar situación"
          }
          onClose={closeSituationModal}
        >
          <form className="space-y-4" onSubmit={handleSituationSubmit}>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="situation-name">
                Nombre
              </label>
              <input
                id="situation-name"
                className="rounded border px-3 py-2"
                placeholder="Nombre de la situación"
                value={situationForm.name}
                onChange={(event) =>
                  setSituationForm((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="situation-next">
                Siguiente situación sugerida
              </label>
              <select
                id="situation-next"
                className="rounded border px-3 py-2"
                value={situationForm.nextSituationId}
                onChange={(event) =>
                  setSituationForm((prev) => ({
                    ...prev,
                    nextSituationId: event.target.value,
                  }))
                }
              >
                <option value="">Ninguna</option>
                {situations
                  .filter((situation) => situation.id !== activeSituationId)
                  .map((situation) => (
                    <option key={situation.id} value={situation.id}>
                      {situation.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeSituationModal}
                className="rounded px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSituationSubmitDisabled}
                className={`rounded px-4 py-2 text-sm font-medium ${
                  isSituationSubmitDisabled
                    ? "cursor-not-allowed bg-blue-200 text-blue-700"
                    : "bg-blue-500 text-white transition-colors hover:bg-blue-600"
                }`}
              >
                {situationModalMode === "create" ? "Crear" : "Guardar"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {isSectionModalOpen && (
        <Modal
          title={
            sectionModalMode === "create" ? "Crear sección" : "Editar sección"
          }
          onClose={closeSectionModal}
        >
          <form className="space-y-4" onSubmit={handleSectionSubmit}>
            {selectedSituation && (
              <p className="text-sm text-gray-500">
                Situación:{" "}
                <span className="font-semibold">{selectedSituation.name}</span>
              </p>
            )}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="section-name">
                Nombre
              </label>
              <input
                id="section-name"
                className="rounded border px-3 py-2"
                placeholder="Nombre de la sección"
                value={sectionForm.name}
                onChange={(event) =>
                  setSectionForm((prev) => ({
                    ...prev,
                    name: event.target.value,
                  }))
                }
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="section-remember">
                Recordar selección
              </label>
              <select
                id="section-remember"
                className="rounded border px-3 py-2"
                value={sectionForm.rememberSelection}
                onChange={(event) =>
                  setSectionForm((prev) => ({
                    ...prev,
                    rememberSelection: event.target.value,
                  }))
                }
              >
                <option value="no">No</option>
                <option value="yes">Sí</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeSectionModal}
                className="rounded px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSectionSubmitDisabled}
                className={`rounded px-4 py-2 text-sm font-medium ${
                  isSectionSubmitDisabled
                    ? "cursor-not-allowed bg-blue-200 text-blue-700"
                    : "bg-blue-500 text-white transition-colors hover:bg-blue-600"
                }`}
              >
                {sectionModalMode === "create" ? "Crear" : "Guardar"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {isTagModalOpen && (
        <Modal
          title={
            tagModalMode === "create" ? "Crear etiqueta" : "Editar etiqueta"
          }
          onClose={closeTagModal}
        >
          <form className="space-y-4" onSubmit={handleTagSubmit}>
            {selectedSection && (
              <p className="text-sm text-gray-500">
                Sección:{" "}
                <span className="font-semibold">{selectedSection.name}</span>
              </p>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="flex flex-col gap-2 md:col-span-4">
                <label className="text-sm font-medium" htmlFor="tag-name">
                  Nombre
                </label>
                <input
                  id="tag-name"
                  className="rounded border px-3 py-2"
                  placeholder="Nombre de la etiqueta"
                  value={tagForm.name}
                  onChange={(event) =>
                    setTagForm((prev) => ({
                      ...prev,
                      name: event.target.value,
                    }))
                  }
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="tag-highlighted"
                >
                  Destacada
                </label>
                <select
                  id="tag-highlighted"
                  className="rounded border px-3 py-2"
                  value={tagForm.highlighted}
                  onChange={(event) =>
                    setTagForm((prev) => ({
                      ...prev,
                      highlighted: event.target.value,
                    }))
                  }
                >
                  <option value="no">No</option>
                  <option value="yes">Sí</option>
                </select>
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <label className="text-sm font-medium" htmlFor="tag-default">
                  Seleccionada por defecto
                </label>
                <select
                  id="tag-default"
                  className="rounded border px-3 py-2"
                  value={tagForm.defaultSelected}
                  onChange={(event) =>
                    setTagForm((prev) => ({
                      ...prev,
                      defaultSelected: event.target.value,
                    }))
                  }
                >
                  <option value="no">No</option>
                  <option value="yes">Sí</option>
                </select>
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="tag-play-finishes"
                >
                  Finaliza la jugada
                </label>
                <select
                  id="tag-play-finishes"
                  className="rounded border px-3 py-2"
                  value={tagForm.playFinishes}
                  onChange={(event) =>
                    setTagForm((prev) => ({
                      ...prev,
                      playFinishes: event.target.value,
                    }))
                  }
                >
                  <option value="no">No</option>
                  <option value="yes">Sí</option>
                </select>
              </div>
              <div className="flex flex-col gap-2  md:col-span-2">
                <label className="text-sm font-medium" htmlFor="tag-outcome">
                  Resultado automático
                </label>
                <select
                  id="tag-outcome"
                  className="rounded border px-3 py-2"
                  value={tagForm.automaticOutcome}
                  onChange={(event) =>
                    setTagForm((prev) => ({
                      ...prev,
                      automaticOutcome: event.target
                        .value as AutomaticOutcomeOption,
                    }))
                  }
                >
                  <option value="">Ninguno</option>
                  <option value="positive">Positivo</option>
                  <option value="negative">Negativo</option>
                </select>
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <label className="text-sm font-medium" htmlFor="tag-positive">
                  Valor positivo
                </label>
                <div className="flex gap-2">
                  <select
                    id="tag-positive"
                    className="rounded border px-3 py-2"
                    value={tagForm.positiveValue}
                    onChange={(event) =>
                      setTagForm((prev) => ({
                        ...prev,
                        positiveValue: event.target.value,
                      }))
                    }
                  >
                    <option value="0">0</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                    <option value="5">5</option>
                  </select>
                  <input
                    id="tag-positive"
                    type="number"
                    className="rounded border px-3 py-2"
                    value={tagForm.positiveValue}
                    onChange={(event) =>
                      setTagForm((prev) => ({
                        ...prev,
                        positiveValue: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2 md:col-span-2">
                <label className="text-sm font-medium" htmlFor="tag-negative">
                  Valor negativo
                </label>
                <div className="flex gap-2">
                  <select
                    id="tag-negative"
                    className="rounded border px-3 py-2"
                    value={tagForm.negativeValue}
                    onChange={(event) =>
                      setTagForm((prev) => ({
                        ...prev,
                        negativeValue: event.target.value,
                      }))
                    }
                  >
                    <option value="0">0</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                    <option value="5">5</option>
                  </select>
                  <input
                    id="tag-negative"
                    type="number"
                    className="rounded border px-3 py-2"
                    value={tagForm.negativeValue}
                    onChange={(event) =>
                      setTagForm((prev) => ({
                        ...prev,
                        negativeValue: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeTagModal}
                className="rounded px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isTagSubmitDisabled}
                className={`rounded px-4 py-2 text-sm font-medium ${
                  isTagSubmitDisabled
                    ? "cursor-not-allowed bg-blue-200 text-blue-700"
                    : "bg-blue-500 text-white transition-colors hover:bg-blue-600"
                }`}
              >
                {tagModalMode === "create" ? "Crear" : "Guardar"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
