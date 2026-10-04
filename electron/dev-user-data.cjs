const fs = require("node:fs");
const path = require("node:path");

const migrationMarkerName = "development-user-data-migration.json";
const migratableEntries = [
  "settings.json",
  "processing-config.json",
  "processing-config.json.bak",
  "processing-config-history",
  "Preferences",
  "Local Storage",
  "Session Storage",
];

function developmentCredentialPath(app) {
  return path.join(app.getPath("appData"), `${app.getName()}-dev-secrets`, "obs-password.enc");
}

function developmentUserDataPath(repositoryRoot) {
  return path.join(repositoryRoot, ".dev", "electron-user-data");
}

function copyEntryIfMissing(sourceRoot, destinationRoot, entry, copiedEntries) {
  const source = path.join(sourceRoot, entry);
  const destination = path.join(destinationRoot, entry);
  if (!fs.existsSync(source) || fs.existsSync(destination)) return;
  fs.cpSync(source, destination, {
    recursive: true,
    force: false,
    errorOnExist: false,
    // LevelDB re-creates its process lock. Copying a stale lock can make a
    // clean, migrated renderer store appear busy on its first dev launch.
    filter: (sourcePath) => path.basename(sourcePath) !== "LOCK",
  });
  copiedEntries.push(entry);
}

function migrateDevelopmentUserData(sourceRoot, destinationRoot) {
  const markerPath = path.join(destinationRoot, migrationMarkerName);
  fs.mkdirSync(destinationRoot, { recursive: true });
  if (fs.existsSync(markerPath) || path.resolve(sourceRoot) === path.resolve(destinationRoot)) {
    return { copiedEntries: [], markerPath, migrated: false };
  }
  const copiedEntries = [];
  for (const entry of migratableEntries) {
    copyEntryIfMissing(sourceRoot, destinationRoot, entry, copiedEntries);
  }
  const marker = {
    completedAt: new Date().toISOString(),
    sourceRoot,
    copiedEntries,
    excluded: ["obs-password.enc"],
  };
  fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2), "utf8");
  return { copiedEntries, markerPath, migrated: true };
}

function migrateDevelopmentCredential(sourceRoot, credentialPath) {
  const source = path.join(sourceRoot, "obs-password.enc");
  if (!fs.existsSync(source) || fs.existsSync(credentialPath)) return false;
  fs.mkdirSync(path.dirname(credentialPath), { recursive: true });
  fs.copyFileSync(source, credentialPath, fs.constants.COPYFILE_EXCL);
  return true;
}

function configureDevelopmentUserData(app, repositoryRoot) {
  const sourceRoot = app.getPath("userData");
  const destinationRoot = developmentUserDataPath(repositoryRoot);
  const migration = migrateDevelopmentUserData(sourceRoot, destinationRoot);
  const credentialPath = developmentCredentialPath(app);
  const credentialMigrated = migrateDevelopmentCredential(sourceRoot, credentialPath);
  app.setPath("userData", destinationRoot);
  app.setPath("sessionData", path.join(destinationRoot, "session-data"));
  app.setPath("crashDumps", path.join(destinationRoot, "crash-dumps"));
  app.setAppLogsPath(path.join(destinationRoot, "logs"));
  return { sourceRoot, destinationRoot, credentialPath, credentialMigrated, ...migration };
}

module.exports = {
  configureDevelopmentUserData,
  developmentCredentialPath,
  developmentUserDataPath,
  migrateDevelopmentCredential,
  migrateDevelopmentUserData,
};
