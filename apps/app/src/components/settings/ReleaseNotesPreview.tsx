import { useEffect } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { useQuery } from "@tanstack/react-query";
import { recordTelemetryEvent } from "@/components/onboarding/onboarding-telemetry";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import {
  CHANGELOG_ENTRIES,
  changelogEntriesQueryOptions,
} from "./changelog-preview";
import {
  type ReleasePreview,
  resolveReleasePreview,
} from "./release-notes-model";

const reportedPreviewVersions = new Set<string>();

export function resetReleaseNotesPreviewSessionForTest(): void {
  reportedPreviewVersions.clear();
}

const SUMMARY_COMPONENTS: Components = {
  p: ({ children }) => <>{children}</>,
  img: () => null,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="underline decoration-border underline-offset-2 hover:text-foreground"
      onClick={(event) => {
        event.preventDefault();
        if (href !== undefined) {
          openUrlInExternalBrowser(href);
        }
      }}
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 font-mono">{children}</code>
  ),
  strong: ({ children }) => (
    <strong className="font-medium text-foreground">{children}</strong>
  ),
};

export interface ReleaseNotesPreviewProps {
  version: string | null;
  updateAvailable: boolean;
}

export function ReleaseNotesPreview({
  version,
  updateAvailable,
}: ReleaseNotesPreviewProps) {
  const changelogQuery = useQuery({
    ...changelogEntriesQueryOptions(),
    enabled: version !== null,
  });
  const preview =
    version === null
      ? null
      : resolveReleasePreview(version, changelogQuery.data, CHANGELOG_ENTRIES);

  useEffect(() => {
    if (
      version === null ||
      preview === null ||
      reportedPreviewVersions.has(version)
    ) {
      return;
    }
    reportedPreviewVersions.add(version);
    recordTelemetryEvent({
      name: "release_notes_preview_shown",
      properties: {
        release_version: version,
        update_available: updateAvailable,
      },
    });
  }, [preview, updateAvailable, version]);

  if (version === null || preview === null) {
    return null;
  }
  return (
    <ReleaseNotesPreviewContent
      version={version}
      preview={preview}
      updateAvailable={updateAvailable}
    />
  );
}

export function ReleaseNotesPreviewContent({
  version,
  preview,
  updateAvailable,
}: {
  version: string;
  preview: ReleasePreview;
  updateAvailable: boolean;
}) {
  return (
    <p
      data-updates-domain="release-notes"
      className="line-clamp-2 px-4 py-2.5 pl-13 text-xs leading-snug text-muted-foreground"
    >
      <span className="font-medium text-foreground">
        {updateAvailable
          ? `What's in bb ${version}: `
          : `What's new in bb ${version}: `}
      </span>
      <ReactMarkdown components={SUMMARY_COMPONENTS} skipHtml>
        {preview.summary}
      </ReactMarkdown>
    </p>
  );
}
