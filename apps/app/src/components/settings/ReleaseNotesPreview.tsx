import { useEffect, useId, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { useQuery } from "@tanstack/react-query";
import { recordTelemetryEvent } from "@/components/onboarding/onboarding-telemetry";
import { openUrlInExternalBrowser } from "@/lib/url-open-routing";
import {
  CHANGELOG_ENTRIES,
  changelogEntriesQueryOptions,
} from "./changelog-preview";
import {
  type ReleaseImage,
  type ReleasePreview,
  resolveReleasePreview,
} from "./release-notes-model";

const reportedPreviewVersions = new Set<string>();

export function resetReleaseNotesPreviewSessionForTest(): void {
  reportedPreviewVersions.clear();
}

const DESCRIPTION_COMPONENTS: Components = {
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
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-updates-domain="release-notes"
      className="@container/release-notes flex min-w-0 flex-col gap-3 px-4 py-3.5"
    >
      <h3 id={headingId} className="text-xs font-medium text-muted-foreground">
        {updateAvailable
          ? `What's in bb ${version}`
          : `What's new in bb ${version}`}
      </h3>
      <div className="flex min-w-0 flex-col gap-3 @min-[34rem]/release-notes:flex-row @min-[34rem]/release-notes:items-start @min-[34rem]/release-notes:gap-4">
        {preview.image === null ? null : (
          <ReleaseNotesImage image={preview.image} />
        )}
        <ul className="flex min-w-0 flex-1 flex-col gap-2.5">
          {preview.highlights.map((highlight) => (
            <li key={highlight.title} className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">
                {highlight.title}
              </span>
              {highlight.description === "" ? null : (
                <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                  <ReactMarkdown components={DESCRIPTION_COMPONENTS} skipHtml>
                    {highlight.description}
                  </ReactMarkdown>
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ReleaseNotesImage({ image }: { image: ReleaseImage }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === image.src) {
    return null;
  }
  return (
    <img
      data-testid="release-notes-preview-image"
      src={image.src}
      alt={image.alt}
      loading="lazy"
      decoding="async"
      className="aspect-video w-full shrink-0 rounded-md border border-border object-cover @min-[34rem]/release-notes:w-56"
      onError={() => setFailedSrc(image.src)}
    />
  );
}
