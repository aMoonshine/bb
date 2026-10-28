import type { Stats } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

type FileSet = {
  src: string;
  destination: string;
  files: string[];
  metadata: Map<string, Stats>;
  transformedFiles: Map<number, Buffer>;
};

const require = createRequire(path.resolve(process.cwd(), "package.json"));
const requireBuilder = createRequire(
  require.resolve("electron-builder/package.json"),
);
const {
  AsarPackager,
}: {
  AsarPackager: new (
    packager: { info: { getWorkspaceRoot(): Promise<string> } },
    config: {
      resourcePath: string;
      defaultDestination: string;
      options: { smartUnpack: boolean };
    },
  ) => { pack(fileSets: FileSet[]): Promise<void> };
} = requireBuilder("app-builder-lib/out/asar/asarUtil.js");
const asar: {
  listPackage(archive: string): string[];
  extractFile(archive: string, file: string): Buffer;
  statFile(
    archive: string,
    file: string,
    followLinks: boolean,
  ): { unpacked?: boolean; executable?: boolean; link?: string };
} = requireBuilder("@electron/asar");

async function fileSet(
  src: string,
  destination: string,
  names: string[],
  transforms = new Map<string, string>(),
): Promise<FileSet> {
  const files = names.map((name) => path.join(src, name));
  const metadata = new Map<string, Stats>();
  const transformedFiles = new Map<number, Buffer>();
  for (const [index, file] of files.entries()) {
    const stat = await lstat(file);
    if (names[index].startsWith("native/")) {
      Object.assign(stat, {
        moduleName: "native",
        moduleRootPath: "native",
        moduleFullFilePath: file,
      });
    }
    metadata.set(file, stat);
    const transformed = transforms.get(names[index]);
    if (transformed !== undefined) {
      transformedFiles.set(index, Buffer.from(transformed));
    }
  }
  return { src, destination, files, metadata, transformedFiles };
}

it("preserves ordered archive contents, transformed indices, duplicate winners and unpacked files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bb-asar-order-"));
  const app = path.join(root, "app");
  const dependency = path.join(root, "dependency");
  const resources = path.join(root, "resources");
  const destination = path.join(resources, "app");
  const archive = path.join(resources, "app.asar");
  try {
    await mkdir(app, { recursive: true });
    await mkdir(path.join(dependency, "native"), { recursive: true });
    await mkdir(resources);
    const names = Array.from(
      { length: 24 },
      (_, index) => `a${String(index).padStart(2, "0")}.txt`,
    );
    for (const name of names) await writeFile(path.join(app, name), name);
    await chmod(path.join(app, "a00.txt"), 0o755);
    await writeFile(path.join(app, "collision.txt"), "app loses");
    await writeFile(path.join(dependency, "collision.txt"), "dependency wins");
    await writeFile(path.join(dependency, "native/a.txt"), "native companion");
    await writeFile(path.join(dependency, "native/0.node"), "native binary");
    const links =
      process.platform === "win32" ? [] : ["link-absolute", "link-relative"];
    if (links.length > 0) {
      await symlink(path.join(app, "a00.txt"), path.join(app, links[0]));
      await symlink("a00.txt", path.join(app, links[1]));
    }
    const transforms = new Map([
      ["a01.txt", "first transformed"],
      ["a17.txt", "later transformed"],
    ]);
    const packager = new AsarPackager(
      { info: { getWorkspaceRoot: async () => root } },
      {
        resourcePath: resources,
        defaultDestination: destination,
        options: { smartUnpack: true },
      },
    );
    await packager.pack([
      await fileSet(
        app,
        destination,
        [...names, "collision.txt", ...links].reverse(),
        transforms,
      ),
      await fileSet(dependency, destination, [
        "native/0.node",
        "native/a.txt",
        "collision.txt",
      ]),
    ]);
    expect(
      asar.listPackage(archive).map((file) => file.replaceAll("\\", "/")),
    ).toEqual([
      "/collision.txt",
      "/native",
      "/native/a.txt",
      "/native/0.node",
      ...names.map((name) => `/${name}`),
      ...links.map((name) => `/${name}`),
    ]);
    for (const name of names) {
      expect(asar.extractFile(archive, name).toString()).toBe(
        transforms.get(name) ?? name,
      );
    }
    expect(asar.extractFile(archive, "collision.txt").toString()).toBe(
      "dependency wins",
    );
    for (const [name, content] of [
      ["native/a.txt", "native companion"],
      ["native/0.node", "native binary"],
    ]) {
      expect(asar.statFile(archive, name, false).unpacked).toBe(true);
      expect(await readFile(`${archive}.unpacked/${name}`, "utf8")).toBe(
        content,
      );
    }
    for (const link of links) {
      expect(asar.statFile(archive, link, false).link).toBe("a00.txt");
      expect(asar.extractFile(archive, link).toString()).toBe("a00.txt");
    }
    if (process.platform !== "win32") {
      expect(asar.statFile(archive, "a00.txt", false).executable).toBe(true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rejects a denied system file before creating an archive", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bb-asar-denied-"));
  const resources = path.join(root, "resources");
  const source =
    process.platform === "win32"
      ? path.join(
          process.env.SystemRoot ?? "C:\\Windows",
          "System32/kernel32.dll",
        )
      : "/etc/hosts";
  try {
    await mkdir(resources);
    const destination = path.join(resources, "app");
    const packager = new AsarPackager(
      { info: { getWorkspaceRoot: async () => root } },
      {
        resourcePath: resources,
        defaultDestination: destination,
        options: { smartUnpack: false },
      },
    );
    await expect(
      packager.pack([
        await fileSet(path.dirname(source), destination, [
          path.basename(source),
        ]),
      ]),
    ).rejects.toThrow("outside the package to a system or unsafe path");
    await expect(
      access(path.join(resources, "app.asar")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
