import { db } from "./dbLocal";
import { supabase } from "./dbCloud";

export async function syncTeams() {
  const { data: userData } = await supabase.auth.getUser();
  const user_id = userData?.user?.id;
  if (!user_id) return;

  // 1️⃣ Subir equipos locales no sincronizados
  const unsynced = await db.teams.filter(t => !t.synced && t.user_id === user_id).toArray();
  if (unsynced.length > 0) {
    console.log(`🔄 Subiendo ${unsynced.length} equipos a Supabase...`);

    // Eliminamos campos locales (como 'synced')
    const payload = unsynced.map(({ synced, ...rest }) => rest);

    const { error } = await supabase.from("teams").upsert(payload);

    if (!error) {
      await db.teams
        .where("id")
        .anyOf(unsynced.map(t => t.id!))
        .modify({ synced: true });
      console.log("✅ Equipos sincronizados");
    } else {
      console.error("❌ Error al subir equipos:", error);
    }
  }

  // 2️⃣ Descargar equipos del usuario
  const { data: cloudTeams, error: downloadError } = await supabase
    .from("teams")
    .select("*")
    .eq("user_id", user_id);

  if (!downloadError && cloudTeams) {
    for (const team of cloudTeams) {
      const exists = await db.teams.get(team.id);
      if (!exists) {
        await db.teams.add({ ...team, synced: true });
      }
    }
    console.log("⬇️ Equipos descargados desde Supabase");
  }
}
