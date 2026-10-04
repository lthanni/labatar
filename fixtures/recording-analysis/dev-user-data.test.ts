import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const { configureDevelopmentUserData, migrateDevelopmentUserData } = createRequire(import.meta.url)(
  "../../electron/dev-user-data.cjs",
);

let root: string;

function write(path: string, contents: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "labatar-dev-user-data-test-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("development Electron user data", () => {
  it("migrates readable app state into the repository and excludes the OBS credential", () => {
    const source = join(root, "app-data");
    const destination = join(root, "repo", ".dev", "electron-user-data");
    write(join(source, "settings.json"), '{"obs":{}}');
    write(join(source, "processing-config.json"), '{"revision":2}');
    write(join(source, "Local Storage", "leveldb", "000003.log"), "local-state");
    write(join(source, "Local Storage", "leveldb", "LOCK"), "do-not-copy");
    write(join(source, "obs-password.enc"), "secret");

    const result = migrateDevelopmentUserData(source, destination);

    expect(result.migrated).toBe(true);
    expect(result.copiedEntries).toEqual(
      expect.arrayContaining(["settings.json", "processing-config.json", "Local Storage"]),
    );
    expect(readFileSync(join(destination, "settings.json"), "utf8")).toBe('{"obs":{}}');
    expect(readFileSync(join(destination, "Local Storage", "leveldb", "000003.log"), "utf8")).toBe(
      "local-state",
    );
    expect(existsSync(join(destination, "Local Storage", "leveldb", "LOCK"))).toBe(false);
    expect(existsSync(join(destination, "obs-password.enc"))).toBe(false);
    expect(JSON.parse(readFileSync(result.markerPath, "utf8"))).toMatchObject({
      sourceRoot: source,
      excluded: ["obs-password.enc"],
    });
  });

  it("does not overwrite development state after its one-time migration", () => {
    const source = join(root, "app-data");
    const destination = join(root, "repo", ".dev", "electron-user-data");
    write(join(source, "settings.json"), '{"value":"old"}');
    migrateDevelopmentUserData(source, destination);
    write(join(destination, "settings.json"), '{"value":"dev"}');
    write(join(source, "settings.json"), '{"value":"new"}');

    const next = migrateDevelopmentUserData(source, destination);

    expect(next.migrated).toBe(false);
    expect(readFileSync(join(destination, "settings.json"), "utf8")).toBe('{"value":"dev"}');
  });

  it("sets Electron user, session, and crash paths under the repository", () => {
    const source = join(root, "app-data");
    const appData = join(root, "roaming");
    const calls: Array<[string, string]> = [];
    write(join(source, "obs-password.enc"), "encrypted-secret");
    const app = {
      getPath: (name: string) => (name === "userData" ? source : appData),
      getName: () => "labatar",
      setPath: (name: string, value: string) => calls.push([name, value]),
      setAppLogsPath: (value: string) => calls.push(["logs", value]),
    };

    const configured = configureDevelopmentUserData(app, join(root, "repo"));

    expect(configured.destinationRoot).toBe(join(root, "repo", ".dev", "electron-user-data"));
    expect(calls).toEqual([
      ["userData", configured.destinationRoot],
      ["sessionData", join(configured.destinationRoot, "session-data")],
      ["crashDumps", join(configured.destinationRoot, "crash-dumps")],
      ["logs", join(configured.destinationRoot, "logs")],
    ]);
    expect(configured.credentialPath).toBe(
      join(appData, "labatar-dev-secrets", "obs-password.enc"),
    );
    expect(readFileSync(configured.credentialPath, "utf8")).toBe("encrypted-secret");
    expect(existsSync(join(configured.destinationRoot, "obs-password.enc"))).toBe(false);
  });
});
