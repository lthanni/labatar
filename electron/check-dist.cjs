const fs = require("node:fs");
const path = require("node:path");

function assertElectronDistComplete(electronBinary) {
  if (typeof electronBinary !== "string") {
    throw new Error("The Electron distribution check must be started by Node.");
  }

  const dist = path.dirname(electronBinary);
  const requiredFiles =
    process.platform === "win32"
      ? ["chrome_100_percent.pak", "chrome_200_percent.pak", "d3dcompiler_47.dll"]
      : [];
  const missingFiles = requiredFiles.filter((file) => !fs.existsSync(path.join(dist, file)));
  if (missingFiles.length) {
    throw new Error(
      `Electron ${require("electron/package.json").version} is incomplete in ${dist}. ` +
        `Missing: ${missingFiles.join(", ")}. Repair the dependency installation before launching or packaging the app.`,
    );
  }
}

if (require.main === module) assertElectronDistComplete(require("electron"));

module.exports = { assertElectronDistComplete };
