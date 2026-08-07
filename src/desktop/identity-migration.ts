import { app } from "electron";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { LEGACY_PROJECTS, PROJECT } from "../identity.js";

export type UserDataMigration = {
  destination: string;
  sources: string[];
};

export function configureDesktopIdentity(): UserDataMigration {
  const appData = app.getPath("appData");
  const inherited = app.getPath("userData");
  const destination = path.join(appData, PROJECT.name);
  app.setName(PROJECT.name);
  app.setPath("userData", destination);
  return {
    destination,
    sources: [
      inherited,
      path.join(appData, "Electron"),
      ...LEGACY_PROJECTS.flatMap((project) => [
        path.join(appData, project.name),
        path.join(appData, project.slug),
      ]),
    ],
  };
}

export function migrateLegacyUserData(migration: UserDataMigration): void {
  mkdirSync(migration.destination, { recursive: true });
  for (const source of new Set(migration.sources)) {
    if (source === migration.destination || !existsSync(source)) continue;
    copyIfMissing(source, "settings.json", migration.destination, "settings.json");
    copyIfMissing(source, "attachments", migration.destination, "attachments");
    for (const legacy of LEGACY_PROJECTS) {
      for (const suffix of ["", "-shm", "-wal"]) {
        copyIfMissing(
          source,
          `${legacy.slug}.db${suffix}`,
          migration.destination,
          `${PROJECT.slug}.db${suffix}`,
        );
      }
    }
  }
}

function copyIfMissing(source: string, name: string, destination: string, nextName: string): void {
  const from = path.join(source, name);
  const to = path.join(destination, nextName);
  if (!existsSync(to) && existsSync(from)) cpSync(from, to, { recursive: true });
}
