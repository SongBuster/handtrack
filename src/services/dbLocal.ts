import Dexie, { type Table } from "dexie";

export interface Team {
  id?: string; // UUID generado en Supabase o localmente
  name: string;
  short_name?: string;
  synced?: boolean; // campo auxiliar opcional para sincronización
  user_id?: string; // para identificar al usuario propietario
  pending_delete?: boolean; // marca para borrado pendiente
}

export interface Player {
  id?: string;
  team_id: string;
  number: number;
  name: string;
  position?: string;
  active?: boolean;
  synced?: boolean;
  pending_delete?: boolean;
}

export interface Match {
  id?: string;
  my_team_id: string;
  rival_name: string;
  is_home: boolean;
  date?: string; // o Date
  location?: string;
  competition?: string;
  active: boolean;
  current_time_ms: number;
  synced?: boolean;
}

export class HandtrackDB extends Dexie {
  teams!: Table<Team, string>;
  players!: Table<Player, string>;
  matches!: Table<Match, string>;
  // ...otras tablas (plays, players, etc.)

  constructor() {
    super("handtrackDB");
    this.version(1).stores({
      teams: "id, name",
      players: "id, team_id, number, name, active",
      matches: "id, my_team_id, rival_name, is_home, active, date",
    });

    this.version(2)
      .stores({
        teams: "id, user_id, name",
        players: "id, team_id, number, name, active",
        matches: "id, my_team_id, rival_name, is_home, active, date",
      })
      .upgrade(async (tx) => {
        await tx
          .table("teams")
          .toCollection()
          .modify((team: Team) => {
            if (typeof team.synced === "undefined") {
              team.synced = false;
            }
          });
      });

    this.version(3)
      .stores({
        teams: "id, user_id, name",
        players: "id, team_id, number, name, active",
        matches: "id, my_team_id, rival_name, is_home, active, date",
      })
      .upgrade(async (tx) => {
        await tx
          .table("teams")
          .toCollection()
          .modify((team: Team) => {
            if (typeof team.synced === "undefined") {
              team.synced = false;
            }
            if (typeof team.pending_delete === "undefined") {
              team.pending_delete = false;
            }
          });
      });
      
    this.version(4)
      .stores({
        teams: "id, user_id, name",
        players: "id, team_id, number, name, active",
        matches: "id, my_team_id, rival_name, is_home, active, date",
      })
      .upgrade(async (tx) => {
        await tx
          .table("players")
          .toCollection()
          .modify((player: Player) => {
            if (typeof player.synced === "undefined") {
              player.synced = false;
            }
            if (typeof player.pending_delete === "undefined") {
              player.pending_delete = false;
            }
          });
      });
  }
}

export const db = new HandtrackDB();
