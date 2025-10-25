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

export interface Screen {
  id?: string;
  name: string;
  show_players: boolean;
  user_id?: string;
  synced?: boolean;
  pending_delete?: boolean;
}

export interface MatchScreen {
  id?: string;
  match_id: string;
  screen_id: string;
  synced?: boolean;
  pending_delete?: boolean;
}

export interface ScreenSituation {
  id?: string;
  screen_id: string;
  situation_id: string;
  position: number;
  synced?: boolean;
  pending_delete?: boolean;
}

export interface ScreenSituationSection {
  id?: string;
  screen_situation_id: string;
  section_id: string;
  position: number;
  synced?: boolean;
  pending_delete?: boolean;
}

export interface ScreenSectionTag {
  id?: string;
  screen_section_id: string;
  tag_id: string;
  position: number;
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
  screens!: Table<Screen, string>;
  match_screens!: Table<MatchScreen, string>;
  screen_situations!: Table<ScreenSituation, string>;
  screen_situation_sections!: Table<ScreenSituationSection, string>;
  screen_section_tags!: Table<ScreenSectionTag, string>; 

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
    });


    this.version(8).stores({
      teams: "id, user_id, name",
      players: "id, team_id, number, name, active",
      matches: "id, my_team_id, rival_name, is_home, active, date",
      situations: "id, user_id, name, next_situation_id",
      sections: "id, situation_id, name",
      tags: "id, section_id, name, highlighted",
      screens: "id, user_id, name, show_players",
      match_screens: "id, match_id, screen_id",
      screen_situations: "id, screen_id, situation_id, position",
      screen_situation_sections: "id, screen_situation_id, section_id, position",
      screen_section_tags: "id, screen_section_id, tag_id, position",
    }).upgrade(async (tx) => {
      const tablesToInitialize = [
        { name: "screens", defaults: { synced: false, pending_delete: false, show_players: true } },
        { name: "match_screens", defaults: { synced: false, pending_delete: false } },
        { name: "screen_situations", defaults: { synced: false, pending_delete: false } },
        { name: "screen_situation_sections", defaults: { synced: false, pending_delete: false } },
        { name: "screen_section_tags", defaults: { synced: false, pending_delete: false } },
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
  }
}

export const db = new HandtrackDB();
