import { isIP } from "node:net";
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { ConfigurationError, normalizeGuid, type IngressSettings, type Settings } from "./config.js";

export type Authentication = { claims?: JWTPayload; failure?: "missing_token" | "invalid_token" };

export function isLoopback(address: string | undefined): boolean {
    if (!address) return false;
    if (address === "::1") return true;
    const ipv4 = address.startsWith("::ffff:") ? address.slice(7) : address;
    return isIP(ipv4) === 4 && ipv4.startsWith("127.");
}

export function headerValues(rawHeaders: string[], name: string): string[] {
    const values: string[] = [];
    for (let index = 0; index < rawHeaders.length; index += 2) {
        if (rawHeaders[index]?.toLowerCase() === name.toLowerCase()) values.push(rawHeaders[index + 1] ?? "");
    }
    return values;
}

export function createAuthenticator(settings: IngressSettings, entraKeys?: JWTVerifyGetKey) {
    const key = settings.mode === "Local" ? new TextEncoder().encode(settings.localSigningKey)
        : entraKeys ?? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${settings.tenantId}/discovery/v2.0/keys`));
    return async (headers: string[]): Promise<Authentication> => {
        if (headers.length === 0) return { failure: "missing_token" };
        if (headers.length !== 1) return { failure: "invalid_token" };
        const header = headers[0]!;
        if (!/^Bearer /i.test(header)) return { failure: "missing_token" };
        const token = header.slice(7).trim();
        if (!token) return { failure: "missing_token" };
        try {
            const options = {
                issuer: settings.issuer,
                audience: settings.audience,
                algorithms: [settings.mode === "Local" ? "HS256" : "RS256"],
                requiredClaims: ["exp"],
                clockTolerance: 30,
            };
            const { payload } = typeof key === "function"
                ? await jwtVerify(token, key, options)
                : await jwtVerify(token, key, options);
            return { claims: payload };
        } catch {
            return { failure: "invalid_token" };
        }
    };
}

export function callerId(claims: JWTPayload | undefined): string | undefined {
    return claims ? normalizeGuid(claims.azp ?? claims.appid) : undefined;
}

export function authorizationFailure(claims: JWTPayload, settings: IngressSettings): string | undefined {
    if (["scp", "upn", "preferred_username", "unique_name"].some((name) => Object.hasOwn(claims, name)) ||
        claims.idtyp !== "app") return "app_only_required";
    if (typeof claims.tid !== "string" || claims.tid.toLowerCase() !== settings.tenantId.toLowerCase()) return "wrong_tenant";
    const caller = callerId(claims);
    if (!caller || !settings.allowedCallers.has(caller)) return "caller_not_allowed";
    if (!(claims.roles === settings.requiredRole ||
        (Array.isArray(claims.roles) && claims.roles.includes(settings.requiredRole)))) return "missing_role";
    return undefined;
}

export async function createLocalToken(settings: Settings): Promise<string> {
    if (settings.ingress.mode !== "Local") throw new ConfigurationError("Local tokens cannot be issued in Entra mode.");
    if (settings.environment.toLowerCase() !== "development") {
        throw new ConfigurationError("Local authentication is allowed only in Development.");
    }
    const ingress = settings.ingress;
    return new SignJWT({
        azp: ingress.allowedCallers.keys().next().value,
        tid: ingress.tenantId,
        idtyp: "app",
        roles: [ingress.requiredRole],
    })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuer(ingress.issuer)
        .setAudience(ingress.audience)
        .setNotBefore(Math.floor(Date.now() / 1000) - 5)
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode(ingress.localSigningKey));
}
