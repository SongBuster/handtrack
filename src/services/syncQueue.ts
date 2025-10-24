import { db , type Player} from "./dbLocal";
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