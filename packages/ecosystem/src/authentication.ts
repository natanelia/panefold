import { validateBoundaryValue, type BoundaryLimits } from "./boundary";

export interface PacketAuthentication {
  readonly algorithm: "HMAC-SHA-256";
  readonly keyId: string;
  readonly signature: string;
}

export type AuthenticatedPacket<TPacket extends object> = TPacket & {
  readonly authentication: PacketAuthentication;
};

export interface WorkspacePacketAuthenticator<TPacket extends object> {
  readonly keyId: string;
  readonly sign: (packet: TPacket) => Promise<AuthenticatedPacket<TPacket>>;
  readonly verify: (packet: AuthenticatedPacket<TPacket>) => Promise<boolean>;
}

export interface WorkspacePacketAuthenticatorOptions {
  readonly keyId: string;
  readonly secret: Uint8Array;
  readonly subtle?: SubtleCrypto;
  readonly boundaryLimits?: Partial<BoundaryLimits>;
}

/** Creates a browser-compatible authenticated packet boundary with no opener dependency. */
export async function createWorkspacePacketAuthenticator<TPacket extends object>(
  options: WorkspacePacketAuthenticatorOptions,
): Promise<WorkspacePacketAuthenticator<TPacket>> {
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(options.keyId)) {
    throw new TypeError("keyId must be a bounded protocol identifier");
  }
  if (options.secret.byteLength < 16 || options.secret.byteLength > 4_096) {
    throw new RangeError("HMAC secret must contain 16 to 4,096 bytes");
  }
  const subtle = options.subtle ?? globalThis.crypto?.subtle;
  if (subtle === undefined) throw new Error("Web Crypto SubtleCrypto is unavailable");
  const key = await subtle.importKey(
    "raw",
    Uint8Array.from(options.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

  const encoded = (packet: TPacket) => {
    const validation = validateBoundaryValue(packet, options.boundaryLimits);
    if (!validation.ok) {
      throw new TypeError(`Packet ${validation.path}: ${validation.reason}`);
    }
    return new TextEncoder().encode(canonicalJson(packet));
  };

  return Object.freeze({
    keyId: options.keyId,
    sign: async (packet: TPacket) => {
      const signature = await subtle.sign("HMAC", key, encoded(packet));
      return Object.freeze({
        ...packet,
        authentication: Object.freeze({
          algorithm: "HMAC-SHA-256" as const,
          keyId: options.keyId,
          signature: toBase64Url(new Uint8Array(signature)),
        }),
      });
    },
    verify: async (packet: AuthenticatedPacket<TPacket>) => {
      if (
        packet.authentication.algorithm !== "HMAC-SHA-256" ||
        packet.authentication.keyId !== options.keyId
      ) {
        return false;
      }
      const signature = fromBase64Url(packet.authentication.signature);
      if (signature === undefined) return false;
      const signatureBuffer = Uint8Array.from(signature).buffer;
      const unsigned = { ...packet } as Partial<AuthenticatedPacket<TPacket>>;
      Reflect.deleteProperty(unsigned, "authentication");
      try {
        return await subtle.verify("HMAC", key, signatureBuffer, encoded(unsigned as TPacket));
      } catch {
        return false;
      }
    },
  });
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value !== null && typeof value === "object") {
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value).sort(compare)) {
      output[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return output;
  }
  return value;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return undefined;
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
