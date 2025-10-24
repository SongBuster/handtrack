import {
  db,
  type Player,
  type Match,
  type Situation,
  type Section,
  type Tag,
} from "./dbLocal";
import { supabase } from "./dbCloud";

export async function syncTeams() {
  const { data: userData } = await supabase.auth.getUser();
  const user_id = userData?.user?.id;
  if (!user_id) return;

  // 1️⃣ Procesar borrados pendientes
  const pendingDeletion = await db.teams
    .filter((t) => Boolean(t.pending_delete) && t.user_id === user_id)
    .toArray();

  if (pendingDeletion.length > 0) {
    console.log(
      `🗑️ Eliminando ${pendingDeletion.length} equipos en Supabase...`
    );
    const idsToDelete = pendingDeletion
      .map((team) => team.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    console.log("IDs a eliminar:", idsToDelete);
    console.log("User ID:", user_id);

    if (idsToDelete.length > 0) {
      const { data: error } = await supabase
        .from("teams")
        .delete()
        .in("id", idsToDelete)
        .eq("user_id", user_id);

      if (!error) {
        await db.teams.bulkDelete(idsToDelete);

        console.log("✅ Equipos eliminados en Supabase");
      } else {
        console.error("❌ Error al eliminar equipos:", error);
      }
    } else {
      // Si algún equipo no tiene id (nunca sincronizó) lo eliminamos localmente
      await db.teams
        .filter((team) => Boolean(team.pending_delete) && !team.id)
        .delete();
    }
  }

  // 2️⃣ Subir equipos locales no sincronizados ni marcados para borrar
  const unsynced = await db.teams
    .filter((t) => !t.synced && !t.pending_delete && t.user_id === user_id)
    .toArray();
  if (unsynced.length > 0) {
    console.log(`🔄 Subiendo ${unsynced.length} equipos a Supabase...`);

    // Eliminamos campos locales (como 'synced')
    const payload = unsynced.map(({ synced, pending_delete, ...rest }) => rest);

    const { error } = await supabase.from("teams").upsert(payload);

    if (!error) {
      await db.teams
        .where("id")
        .anyOf(unsynced.map((t) => t.id!))
        .modify({ synced: true });
      console.log("✅ Equipos sincronizados");
    } else {
      console.error("❌ Error al subir equipos:", error);
    }
  }

  // 3️⃣ Descargar equipos del usuario desde Supabase

  const { data: cloudTeams, error: downloadError } = await supabase
    .from("teams")
    .select("*")
    .eq("user_id", user_id);

  if (!downloadError && cloudTeams) {
    for (const team of cloudTeams) {
      const local = await db.teams.get(team.id);
      if (!local) {
        await db.teams.add({ ...team, synced: true, pending_delete: false });
        continue;
      }

      if (local.pending_delete || !local.synced) {
        // Evitamos sobreescribir cambios locales o eliminar pendientes
        continue;
      }

      await db.teams.put({ ...team, synced: true, pending_delete: false });
    }
    console.log("⬇️ Equipos descargados desde Supabase");
  }
}

export async function syncSituations() {
  const { data: userData } = await supabase.auth.getUser();
  const user_id = userData?.user?.id;
  if (!user_id) return;

  const pendingDeletion = await db.situations
    .where("user_id")
    .equals(user_id)
    .filter((situation) => Boolean(situation.pending_delete))
    .toArray();

  if (pendingDeletion.length > 0) {
    const idsToDelete = pendingDeletion
      .map((situation) => situation.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    if (idsToDelete.length > 0) {
      const { error } = await supabase
        .from("situations")
        .delete()
        .in("id", idsToDelete)
        .eq("user_id", user_id);

      if (!error) {
        await db.situations.bulkDelete(idsToDelete);
      } else {
        console.error("❌ Error al eliminar situaciones:", error);
      }
    }
  }

  const unsynced = await db.situations
    .where("user_id")
    .equals(user_id)
    .filter((situation) => !situation.synced && !situation.pending_delete)
    .toArray();

  if (unsynced.length > 0) {
    const payload = unsynced.map(({ synced, pending_delete, ...rest }) => rest);

    const { error } = await supabase.from("situations").upsert(payload);

    if (!error) {
      await db.situations
        .where("id")
        .anyOf(unsynced.map((situation) => situation.id!))
        .modify({ synced: true, pending_delete: false });
    } else {
      console.error("❌ Error al subir situaciones:", error);
    }
  }

  const { data: cloudSituations, error: downloadError } = await supabase
    .from("situations")
    .select("*")
    .eq("user_id", user_id);

  if (!downloadError && cloudSituations) {
    const remoteSituations = cloudSituations.filter(
      (situation): situation is Situation & { id: string } =>
        typeof situation.id === "string" && situation.id.length > 0
    );

    for (const situation of remoteSituations) {
      const local = await db.situations.get(situation.id);
      if (!local) {
        await db.situations.add({ ...situation, synced: true, pending_delete: false });
        continue;
      }

      if (local.pending_delete || !local.synced) {
        continue;
      }

      await db.situations.put({ ...situation, synced: true, pending_delete: false });
    }
  }
}

export async function syncSections() {
  const { data: userData } = await supabase.auth.getUser();
  const user_id = userData?.user?.id;
  if (!user_id) return;

  const userSituations = await db.situations
    .where("user_id")
    .equals(user_id)
    .filter((situation) => !situation.pending_delete)
    .toArray();

  const situationIds = userSituations
    .map((situation) => situation.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  if (situationIds.length === 0) {
    return;
  }

  const pendingDeletion = await db.sections
    .filter(
      (section) =>
        Boolean(section.pending_delete) &&
        situationIds.includes(section.situation_id)
    )
    .toArray();

  if (pendingDeletion.length > 0) {
    const idsToDelete = pendingDeletion
      .map((section) => section.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    if (idsToDelete.length > 0) {
      const { error } = await supabase
        .from("sections")
        .delete()
        .in("id", idsToDelete)
        .in("situation_id", situationIds);

      if (!error) {
        await db.sections.bulkDelete(idsToDelete);
      } else {
        console.error("❌ Error al eliminar secciones:", error);
      }
    }
  }

  const unsynced = await db.sections
    .filter(
      (section) =>
        !section.synced &&
        !section.pending_delete &&
        situationIds.includes(section.situation_id)
    )
    .toArray();

  if (unsynced.length > 0) {
    const payload = unsynced.map(({ synced, pending_delete, ...rest }) => rest);

    const { error } = await supabase.from("sections").upsert(payload);

    if (!error) {
      await db.sections
        .where("id")
        .anyOf(unsynced.map((section) => section.id!))
        .modify({ synced: true, pending_delete: false });
    } else {
      console.error("❌ Error al subir secciones:", error);
    }
  }

  const { data: cloudSections, error: downloadError } = await supabase
    .from("sections")
    .select("*")
    .in("situation_id", situationIds);

  if (!downloadError && cloudSections) {
    const remoteSections = cloudSections.filter(
      (section): section is Section & { id: string } =>
        typeof section.id === "string" && section.id.length > 0
    );

    for (const section of remoteSections) {
      const local = await db.sections.get(section.id);
      if (!local) {
        await db.sections.add({ ...section, synced: true, pending_delete: false });
        continue;
      }

      if (local.pending_delete || !local.synced) {
        continue;
      }

      await db.sections.put({ ...section, synced: true, pending_delete: false });
    }
  }
}

export async function syncTags() {
  const { data: userData } = await supabase.auth.getUser();
  const user_id = userData?.user?.id;
  if (!user_id) return;

  const userSituations = await db.situations
    .where("user_id")
    .equals(user_id)
    .filter((situation) => !situation.pending_delete)
    .toArray();

  const situationIds = userSituations
    .map((situation) => situation.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  if (situationIds.length === 0) {
    return;
  }

  const relevantSections = await db.sections
    .filter((section) => situationIds.includes(section.situation_id))
    .toArray();

  const sectionIds = relevantSections
    .map((section) => section.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  if (sectionIds.length === 0) {
    return;
  }

  const pendingDeletion = await db.tags
    .filter((tag) => Boolean(tag.pending_delete) && sectionIds.includes(tag.section_id))
    .toArray();

  if (pendingDeletion.length > 0) {
    const idsToDelete = pendingDeletion
      .map((tag) => tag.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    if (idsToDelete.length > 0) {
      const { error } = await supabase
        .from("tags")
        .delete()
        .in("id", idsToDelete)
        .in("section_id", sectionIds);

      if (!error) {
        await db.tags.bulkDelete(idsToDelete);
      } else {
        console.error("❌ Error al eliminar etiquetas:", error);
      }
    }
  }

  const unsynced = await db.tags
    .filter(
      (tag) =>
        !tag.synced &&
        !tag.pending_delete &&
        sectionIds.includes(tag.section_id)
    )
    .toArray();

  if (unsynced.length > 0) {
    const payload = unsynced.map(({ synced, pending_delete, ...rest }) => rest);

    const { error } = await supabase.from("tags").upsert(payload);

    if (!error) {
      await db.tags
        .where("id")
        .anyOf(unsynced.map((tag) => tag.id!))
        .modify({ synced: true, pending_delete: false });
    } else {
      console.error("❌ Error al subir etiquetas:", error);
    }
  }

  const { data: cloudTags, error: downloadError } = await supabase
    .from("tags")
    .select("*")
    .in("section_id", sectionIds);

  if (!downloadError && cloudTags) {
    const remoteTags = cloudTags.filter(
      (tag): tag is Tag & { id: string } =>
        typeof tag.id === "string" && tag.id.length > 0
    );

    for (const tag of remoteTags) {
      const local = await db.tags.get(tag.id);
      if (!local) {
        await db.tags.add({ ...tag, synced: true, pending_delete: false });
        continue;
      }

      if (local.pending_delete || !local.synced) {
        continue;
      }

      await db.tags.put({ ...tag, synced: true, pending_delete: false });
    }
  }
}

export async function syncPlayers(teamId: string) {
  const team = await db.teams.get(teamId);
  if (!team?.id) return;

  const { data: userData } = await supabase.auth.getUser();
  const user_id = userData?.user?.id;
  if (!user_id || team.user_id !== user_id) {
    return;
  }

  const pendingDeletion = await db.players
    .where("team_id")
    .equals(teamId)
    .filter((player) => Boolean(player.pending_delete))
    .toArray();

  if (pendingDeletion.length > 0) {
    const idsToDelete = pendingDeletion
      .map((player) => player.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    if (idsToDelete.length > 0) {
      const { error } = await supabase
        .from("players")
        .delete()
        .in("id", idsToDelete)
        .eq("team_id", teamId);

      if (!error) {
        await db.players.bulkDelete(idsToDelete);
        console.log("✅ Jugadores eliminados en Supabase");
      } else {
        console.error("❌ Error al eliminar jugadores:", error);
      }
    } else {
      await db.players
        .where("team_id")
        .equals(teamId)
        .filter((player) => Boolean(player.pending_delete) && !player.id)
        .delete();
    }
  }

  const unsynced = await db.players
    .where("team_id")
    .equals(teamId)
    .filter((player) => !player.synced && !player.pending_delete)
    .toArray();

  if (unsynced.length > 0) {
    const payload = unsynced.map(({ synced, pending_delete, ...rest }) => rest);

    const { error } = await supabase.from("players").upsert(payload);

    if (!error) {
      await db.players
        .where("id")
        .anyOf(unsynced.map((player) => player.id!))
        .modify({ synced: true, pending_delete: false });
      console.log("✅ Jugadores sincronizados");
    } else {
      console.error("❌ Error al subir jugadores:", error);
    }
  }

  const { data: cloudPlayers, error: downloadError } = await supabase
    .from("players")
    .select("*")
    .eq("team_id", teamId);

  if (!downloadError && cloudPlayers) {
    const remotePlayers = cloudPlayers.filter(
      (player): player is Player & { id: string } =>
        typeof player.id === "string" && player.id.length > 0
    );

    await db.transaction("rw", db.players, async () => {
      const localPlayers = await db.players
        .where("team_id")
        .equals(teamId)
        .toArray();

      const unsyncedIds = new Set(
        localPlayers
          .filter((player) => player.synced === false)
          .map((player) => player.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      );

      const pendingIds = new Set(
        localPlayers
          .filter((player) => player.pending_delete === true)
          .map((player) => player.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      );

      const remoteIds = new Set(remotePlayers.map((player) => player.id));

      for (const player of remotePlayers) {
        if (pendingIds.has(player.id) || unsyncedIds.has(player.id)) {
          continue;
        }

        await db.players.put({
          ...player,
          synced: true,
          pending_delete: false,
        });
      }

      const deletableIds = localPlayers
        .filter(
          (player): player is Player & { id: string } =>
            typeof player.id === "string" &&
            player.id.length > 0 &&
            !pendingIds.has(player.id) &&
            !unsyncedIds.has(player.id) &&
            !remoteIds.has(player.id)
        )
        .map((player) => player.id);

      if (deletableIds.length > 0) {
        await db.players.bulkDelete(deletableIds);
      }
    });

    console.log("⬇️ Jugadores descargados desde Supabase");
  }
}

export async function syncMatches(teamId: string) {
  const team = await db.teams.get(teamId);
  if (!team?.id) return;

  const { data: userData } = await supabase.auth.getUser();
  const user_id = userData?.user?.id;
  if (!user_id || team.user_id !== user_id) {
    return;
  }

  const pendingDeletion = await db.matches
    .where("my_team_id")
    .equals(teamId)
    .filter((match) => Boolean(match.pending_delete))
    .toArray();

  if (pendingDeletion.length > 0) {
    const idsToDelete = pendingDeletion
      .map((match) => match.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    if (idsToDelete.length > 0) {
      const { error } = await supabase
        .from("matches")
        .delete()
        .in("id", idsToDelete)
        .eq("my_team_id", teamId);

      if (!error) {
        await db.matches.bulkDelete(idsToDelete);
        console.log("✅ Partidos eliminados en Supabase");
      } else {
        console.error("❌ Error al eliminar partidos:", error);
      }
    } else {
      await db.matches
        .where("my_team_id")
        .equals(teamId)
        .filter((match) => Boolean(match.pending_delete) && !match.id)
        .delete();
    }
  }

  const unsynced = await db.matches
    .where("my_team_id")
    .equals(teamId)
    .filter((match) => !match.synced && !match.pending_delete)
    .toArray();

  if (unsynced.length > 0) {
    const payload = unsynced.map(({ synced, pending_delete, ...rest }) => rest);

    const { error } = await supabase.from("matches").upsert(payload);

    if (!error) {
      await db.matches
        .where("id")
        .anyOf(unsynced.map((match) => match.id!))
        .modify({ synced: true, pending_delete: false });
      console.log("✅ Partidos sincronizados");
    } else {
      console.error("❌ Error al subir partidos:", error);
    }
  }

  const { data: cloudMatches, error: downloadError } = await supabase
    .from("matches")
    .select("*")
    .eq("my_team_id", teamId);

  if (!downloadError && cloudMatches) {
    const remoteMatches = cloudMatches.filter(
      (match): match is Match & { id: string } =>
        typeof match.id === "string" && match.id.length > 0
    );

    await db.transaction("rw", db.matches, async () => {
      const localMatches = await db.matches
        .where("my_team_id")
        .equals(teamId)
        .toArray();

      const unsyncedIds = new Set(
        localMatches
          .filter((match) => match.synced === false)
          .map((match) => match.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      );

      const pendingIds = new Set(
        localMatches
          .filter((match) => match.pending_delete === true)
          .map((match) => match.id)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      );

      const remoteIds = new Set(remoteMatches.map((match) => match.id));

      for (const match of remoteMatches) {
        if (pendingIds.has(match.id) || unsyncedIds.has(match.id)) {
          continue;
        }

        await db.matches.put({
          ...match,
          synced: true,
          pending_delete: false,
        });
      }

      const deletableIds = localMatches
        .filter(
          (match): match is Match & { id: string } =>
            typeof match.id === "string" &&
            match.id.length > 0 &&
            !pendingIds.has(match.id) &&
            !unsyncedIds.has(match.id) &&
            !remoteIds.has(match.id)
        )
        .map((match) => match.id);

      if (deletableIds.length > 0) {
        await db.matches.bulkDelete(deletableIds);
      }
    });

    console.log("⬇️ Partidos descargados desde Supabase");
  }
}


