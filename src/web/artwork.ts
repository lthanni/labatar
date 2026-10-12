import {
  decodePortraitMunged,
  parsePakDirectory,
  parsePakHeader,
  portraitPakRelativePath,
} from "../../electron/artwork-extractor";
import supportMap from "../../electron/support-map.json";

export type WebArtworkFile = { relativePath: string; file: Blob };
export type WebArtworkProgress = {
  phase: "scanning" | "decoding" | "complete" | "cancelled";
  current: number;
  total: number;
  message: string;
};
export type WebArtworkLibrary = {
  portraitArtwork(
    character: string,
    support: string,
  ): {
    portraitUrl: string | null;
    supportUrl: string | null;
  };
  dispose(): void;
  readonly decodedCount: number;
  readonly skippedPakCount: number;
};

const filters = ["~hud~art~portraitart", "~hud~art~support"];
const sourceAssetPattern =
  /sprites~([a-z0-9_]+)~hud~art~(portraitart|support[1-3](?:-[a-z0-9_-]+)?)\.png$/i;
const characterAliases: Record<string, string> = {
  "avatar aang": "aang_avchar",
  "nightmare korra": "korra_nightmare",
};

function isCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Artwork extraction cancelled.", "AbortError");
}

function characterIdForName(character: string): string | null {
  const normalized = String(character ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  return (
    characterAliases[normalized] ?? normalized.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  );
}

function supportIdForName(character: string, support: string): string | null {
  const normalized = String(support ?? "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "none") return null;
  const numbered = /^support\s*#?\s*([1-3])$/i.exec(normalized)?.[1];
  if (numbered) return numbered;
  const characterId = characterIdForName(character);
  const aliases: Record<string, string> = {
    aang_avchar: "Avatar Aang",
    korra_nightmare: "Nightmare Korra",
  };
  const key =
    aliases[characterId ?? ""] ??
    Object.keys(supportMap).find((name) => characterIdForName(name) === characterId);
  const entries = supportMap[key as keyof typeof supportMap];
  return (
    Object.entries(entries ?? {}).find(([, name]) => name.toLowerCase() === normalized)?.[0] ?? null
  );
}

function makePngBlob(width: number, height: number, pixels: Uint8Array): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas image decoding is unavailable in this browser.");
  const image = context.createImageData(width, height);
  image.data.set(pixels);
  context.putImageData(image, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode portrait image."))),
      "image/png",
    );
  });
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Reads PAK directory and portrait entry slices only; game files stay in the browser. */
export async function extractWebArtwork(
  files: readonly WebArtworkFile[],
  options: { signal?: AbortSignal; onProgress?: (progress: WebArtworkProgress) => void } = {},
): Promise<WebArtworkLibrary> {
  const { signal, onProgress } = options;
  const pakFiles = files.filter(
    ({ relativePath }) =>
      /(?:^|\/)data_packages(?:\/|$)/i.test(relativePath.replace(/\\/g, "/")) &&
      /\.pak$/i.test(relativePath),
  );
  const objectUrls = new Set<string>();
  const assets = new Map<string, string>();
  let decodedCount = 0;
  let skippedPakCount = 0;
  const report = (
    phase: WebArtworkProgress["phase"],
    current: number,
    total: number,
    message: string,
  ) => onProgress?.({ phase, current, total, message });
  const dispose = () => {
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
    assets.clear();
  };

  try {
    report("scanning", 0, pakFiles.length, `Checking ${pakFiles.length} PAK files for portraits.`);
    for (let pakIndex = 0; pakIndex < pakFiles.length; pakIndex++) {
      isCancelled(signal);
      const { file } = pakFiles[pakIndex];
      try {
        const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
        const { directoryOffset, directoryBytes } = parsePakHeader(header, file.size);
        const directory = new Uint8Array(
          await file.slice(directoryOffset, directoryOffset + directoryBytes).arrayBuffer(),
        );
        const entries = parsePakDirectory(directory, file.size);
        const selected = entries.filter((entry) => portraitPakRelativePath(entry.name, filters));
        for (const entry of selected) {
          isCancelled(signal);
          try {
            const raw = new Uint8Array(
              await file.slice(entry.offset, entry.offset + entry.size).arrayBuffer(),
            );
            const decoded = decodePortraitMunged(raw);
            const entryName = entry.name
              .replace(/\\/g, "/")
              .split("/")
              .pop()
              ?.replace(/\.munged$/i, ".png");
            const match = sourceAssetPattern.exec(entryName ?? "");
            if (!match) continue;
            const characterId = match[1].toLowerCase();
            const suffix =
              match[2].toLowerCase() === "portraitart"
                ? "portrait"
                : match[2].toLowerCase().split("-")[0];
            const key = `${characterId}/${suffix}`;
            const blob = await makePngBlob(decoded.width, decoded.height, decoded.pixels);
            const url = URL.createObjectURL(blob);
            const old = assets.get(key);
            if (old) {
              URL.revokeObjectURL(old);
              objectUrls.delete(old);
            }
            objectUrls.add(url);
            assets.set(key, url);
            decodedCount++;
          } catch {
            // Unsupported or damaged entries should not block replay history.
          }
          report(
            "decoding",
            pakIndex + 1,
            pakFiles.length,
            `Decoded ${decodedCount} portrait images.`,
          );
          await yieldToBrowser();
        }
      } catch {
        skippedPakCount++;
      }
      report(
        "scanning",
        pakIndex + 1,
        pakFiles.length,
        `Scanned ${pakIndex + 1}/${pakFiles.length} PAK files.`,
      );
      await yieldToBrowser();
    }
    isCancelled(signal);
    report(
      "complete",
      pakFiles.length,
      pakFiles.length,
      `Found ${decodedCount} usable portrait images.`,
    );
    return {
      portraitArtwork(character, support) {
        const characterId = characterIdForName(character);
        const supportId = supportIdForName(character, support);
        return {
          portraitUrl: characterId ? (assets.get(`${characterId}/portrait`) ?? null) : null,
          supportUrl:
            characterId && supportId
              ? (assets.get(`${characterId}/support${supportId}`) ?? null)
              : null,
        };
      },
      dispose,
      get decodedCount() {
        return decodedCount;
      },
      get skippedPakCount() {
        return skippedPakCount;
      },
    };
  } catch (error) {
    dispose();
    if (signal?.aborted) {
      report("cancelled", 0, pakFiles.length, "Artwork extraction cancelled.");
    }
    throw error;
  }
}
