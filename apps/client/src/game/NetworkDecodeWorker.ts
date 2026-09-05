type DecodeResult =
  | { ok: true; message: unknown }
  | { ok: false; error: string };

const scope = globalThis as unknown as {
  addEventListener(type: "message", listener: (event: MessageEvent<string>) => void): void;
  postMessage(message: DecodeResult): void;
};

scope.addEventListener("message", (event) => {
  try {
    const message = JSON.parse(event.data) as { type?: string };
    if (message.type !== "world_region") throw new Error("unexpected message type");
    scope.postMessage({ ok: true, message });
  } catch (error) {
    scope.postMessage({ ok: false, error: error instanceof Error ? error.message : "decode failed" });
  }
});
