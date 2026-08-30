import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteCharacter } from "./api";

describe("character deletion API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends an authenticated DELETE and accepts an empty 204 response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteCharacter("session-token", "character/id")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4000/api/characters/character%2Fid",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ Authorization: "Bearer session-token" }),
      }),
    );
  });
});
