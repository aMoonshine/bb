// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { GIT_PLUGIN_ID } from "@bb/domain";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useShowGitChanges } from "./git-plugin-queries";
import { pluginSdkSettingsQueryKey } from "./query-keys";

describe("useShowGitChanges", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("hides git UI until the Git plugin's settings load", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useShowGitChanges(), { wrapper });
    expect(result.current).toBe(false);
  });

  it.each([
    [{ showGitChanges: false }, false],
    [{ showGitChanges: true }, true],
    [null, true],
  ])("reads %o from the Git plugin's settings as %s", (values, expected) => {
    const { wrapper, queryClient } = createQueryClientTestHarness();
    queryClient.setQueryData(pluginSdkSettingsQueryKey(GIT_PLUGIN_ID), values);
    const { result } = renderHook(() => useShowGitChanges(), { wrapper });
    expect(result.current).toBe(expected);
  });
});
