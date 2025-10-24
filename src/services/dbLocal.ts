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
  pending_delete?: boolean;
}

export type AutomaticOutcome = "positive" | "negative";

export interface Situation {
  id?: string;
  name: string;
  next_situation_id?: string | null;
  user_id?: string;
  synced?: boolean;
  pending_delete?: boolean;
}

export interface Section {
  id?: string;
  situation_id: string;
  name: string;
  remember_selection?: boolean;
  synced?: boolean;
  pending_delete?: boolean;
}

export interface Tag {
  id?: string;
  section_id: string;
  name: string;
  highlighted?: boolean;
  default_selected?: boolean;
  positive_value?: number;
  negative_value?: number;
  automatic_outcome?: AutomaticOutcome | null;
  play_finishes?: boolean;
  synced?: boolean;
  pending_delete?: boolean;
}

export interface MatchTagConfiguration {
  id?: string;
  match_id: string;
  tag_id: string;
  synced?: boolean;
  pending_delete?: boolean;
}

export class HandtrackDB extends Dexie {
  teams!: Table<Team, string>;
  players!: Table<Player, string>;
  matches!: Table<Match, string>;
  situations!: Table<Situation, string>;
  sections!: Table<Section, string>;
  tags!: Table<Tag, string>;
  match_tag_configurations!: Table<MatchTagConfiguration, string>;  

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

    this.version(5)
      .stores({
        teams: "id, user_id, name",
        players: "id, team_id, number, name, active",
        matches: "id, my_team_id, rival_name, is_home, active, date",
      })
      .upgrade(async (tx) => {
        await tx
          .table("matches")
          .toCollection()
          .modify((match: Match) => {
            if (typeof match.synced === "undefined") {
              match.synced = false;
            }
            if (typeof match.pending_delete === "undefined") {
              match.pending_delete = false;
            }
          });
      });

    this.version(6)
      .stores({
        teams: "id, user_id, name",
        players: "id, team_id, number, name, active",
        matches: "id, my_team_id, rival_name, is_home, active, date",
        situations: "id, name, next_situation_id",
        sections: "id, situation_id, name",
        tags: "id, section_id, name, highlighted",
        match_tag_configurations: "id, match_id, tag_id",
      })
      .upgrade(async (tx) => {
        const tablesToInitialize = [
          { name: "situations", defaults: { synced: false, pending_delete: false } },
          { name: "sections", defaults: { synced: false, pending_delete: false, remember_selection: false } },
          {
            name: "tags",
            defaults: {
              synced: false,
              pending_delete: false,
              highlighted: false,
              default_selected: false,
              positive_value: 0,
              negative_value: 0,
              play_finishes: false,
            },
          },
          { name: "match_tag_configurations", defaults: { synced: false, pending_delete: false } },
        ] as const;

        for (const table of tablesToInitialize) {
          await tx
            .table(table.name)
            .toCollection()
            .modify((record: Record<string, unknown>) => {
              for (const [key, value] of Object.entries(table.defaults)) {
                if (typeof record[key] === "undefined") {
                  record[key] = value;
                }
              }
            });
        }
      });

    this.version(7).stores({
      teams: "id, user_id, name",
      players: "id, team_id, number, name, active",
      matches: "id, my_team_id, rival_name, is_home, active, date",
      situations: "id, user_id, name, next_situation_id",
      sections: "id, situation_id, name",
      tags: "id, section_id, name, highlighted",
      match_tag_configurations: "id, match_id, tag_id",
    });
  }
}

export const db = new HandtrackDB();
