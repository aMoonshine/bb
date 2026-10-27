import type { BbDesktopInfo } from "@bb/desktop-contract";
import type {
  SystemAppUpdateStatus,
  SystemVersionResponse,
} from "@bb/server-contract";
import type { ChangelogEntry } from "../../../../../changelog-parser";

export const RELEASE_PREVIEW_MAX_HIGHLIGHTS = 4;

const RELEASE_VERSION_PATTERN = /^\d+(?:\.\d+){1,3}$/;
const BOLD_TITLE_PATTERN = /^\*\*(.+?)\*\*/;

export function isReleaseVersion(version: string): boolean {
  return RELEASE_VERSION_PATTERN.test(version);
}

function compareReleaseVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index++) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export interface ReleaseVersionInput {
  isDesktop: boolean;
  desktopInfo: BbDesktopInfo | null;
  appUpdate: SystemAppUpdateStatus | undefined;
  systemVersion: SystemVersionResponse | undefined;
}

export function resolveReleaseUpdateVersion({
  isDesktop,
  desktopInfo,
  appUpdate,
  systemVersion,
}: ReleaseVersionInput): string | null {
  let candidate: string | null;
  let installed: string | null;
  if (isDesktop) {
    candidate =
      desktopInfo?.pendingVersion ?? desktopInfo?.latestVersion ?? null;
    installed = desktopInfo?.version ?? null;
  } else {
    const available =
      appUpdate?.available !== undefined &&
      appUpdate.available !== null &&
      appUpdate.available.channel !== "nightly"
        ? appUpdate.available.version
        : null;
    candidate =
      available ??
      (systemVersion?.updateAvailable === true
        ? systemVersion.latestVersion
        : null);
    installed =
      appUpdate?.current.version ?? systemVersion?.currentVersion ?? null;
  }
  if (candidate === null || !isReleaseVersion(candidate)) {
    return null;
  }
  if (installed !== null) {
    if (installed === candidate) {
      return null;
    }
    if (
      isReleaseVersion(installed) &&
      compareReleaseVersions(candidate, installed) <= 0
    ) {
      return null;
    }
  }
  return candidate;
}

export interface ReleaseHighlight {
  title: string;
  description: string;
}

function highlightFromItem(item: string): ReleaseHighlight | null {
  const trimmed = item.trim();
  const match = BOLD_TITLE_PATTERN.exec(trimmed);
  const title = match?.[1]
    ?.trim()
    .replace(/[:.]+$/, "")
    .trim();
  if (match === null || title === undefined || title === "") {
    return null;
  }
  const description = trimmed
    .slice(match[0].length)
    .replace(/^[:.]/, "")
    .trim();
  return {
    title,
    description: description.charAt(0).toUpperCase() + description.slice(1),
  };
}

export function releaseHighlights(entry: ChangelogEntry): ReleaseHighlight[] {
  const section = entry.sections.find(
    (candidate) => candidate.title.trim().toLowerCase() === "highlights",
  );
  if (section === undefined) {
    return [];
  }
  const highlights: ReleaseHighlight[] = [];
  for (const block of section.blocks) {
    if (block.kind !== "list") {
      continue;
    }
    for (const item of block.items) {
      const highlight = highlightFromItem(item);
      if (highlight !== null) {
        highlights.push(highlight);
      }
    }
  }
  return highlights.slice(0, RELEASE_PREVIEW_MAX_HIGHLIGHTS);
}

export interface ReleasePreview {
  highlights: ReleaseHighlight[];
}

export function resolveReleasePreview(
  version: string,
  fetchedEntries: readonly ChangelogEntry[] | undefined,
  bundledEntries: readonly ChangelogEntry[],
): ReleasePreview | null {
  const entry =
    fetchedEntries?.find((candidate) => candidate.version === version) ??
    bundledEntries.find((candidate) => candidate.version === version);
  if (entry === undefined) {
    return null;
  }
  const highlights = releaseHighlights(entry);
  if (highlights.length === 0) {
    return null;
  }
  return { highlights };
}
