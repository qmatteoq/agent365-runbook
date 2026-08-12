/** Microsoft Entra sign-in for the Express web app. */

import { randomBytes } from "node:crypto";

import {
    ConfidentialClientApplication,
    CryptoProvider,
    type AccountInfo,
} from "@azure/msal-node";
import { Router, type Request, type Response } from "express";

import type { Settings } from "./config.js";

export const SESSION_COOKIE_NAME = "learn_agent_session";

/** Raised when the caller needs to sign in again. */
export class AuthRequiredError extends Error {}

interface SessionState {
    /** State, nonce and PKCE verifier that must survive the round trip to Entra. */
    flow?: { state: string; codeVerifier: string };
    accountId?: string;
    claims?: Record<string, unknown>;
}

interface Profile {
    name: string;
    username: string;
}

/** Owns the MSAL app, server-side sessions and sign-in routes. */
export class AuthService {
    private readonly client: ConfidentialClientApplication;
    private readonly crypto = new CryptoProvider();
    private readonly sessions = new Map<string, SessionState>();
    readonly router = Router();

    constructor(private readonly settings: Settings) {
        this.client = new ConfidentialClientApplication({
            auth: {
                clientId: settings.azureAdClientId!,
                clientSecret: settings.azureAdClientSecret!,
                authority: `https://login.microsoftonline.com/${settings.azureAdTenantId}`,
            },
        });

        this.registerRoutes();
    }

    private registerRoutes(): void {
        this.router.get("/signin", (req, res) => void this.signin(req, res));
        this.router.get("/signin-oidc", (req, res) => void this.signinOidc(req, res));
        this.router.get("/signout", (req, res) => this.signout(req, res));
        this.router.get("/api/me", (req, res) => void this.me(req, res));
    }

    private newSessionId(): string {
        const sessionId = randomBytes(32).toString("base64url");
        this.sessions.set(sessionId, {});
        return sessionId;
    }

    private getSessionId(req: Request): string | undefined {
        const sessionId = parseCookies(req)[SESSION_COOKIE_NAME];
        return sessionId && this.sessions.has(sessionId) ? sessionId : undefined;
    }

    private getSession(req: Request): SessionState | undefined {
        const sessionId = this.getSessionId(req);
        return sessionId ? this.sessions.get(sessionId) : undefined;
    }

    private setSessionCookie(res: Response, sessionId: string): void {
        res.cookie(SESSION_COOKIE_NAME, sessionId, {
            httpOnly: true,
            // Entra redirects back from another site, so a strict cookie would be withheld on
            // the callback and the server-side session would look as if it had been lost.
            sameSite: "lax",
        });
    }

    private async getAccount(session: SessionState): Promise<AccountInfo | null> {
        if (!session.accountId) {
            return null;
        }

        return this.client.getTokenCache().getAccountByHomeId(session.accountId);
    }

    private profile(session: SessionState | undefined): Profile | null {
        if (!session?.claims) {
            return null;
        }

        const claims = session.claims;
        const preferredUsername = asString(claims["preferred_username"]) ?? asString(claims["upn"]) ?? "";
        const name = asString(claims["name"]) ?? (preferredUsername || "Signed-in user");
        return { name, username: preferredUsername };
    }

    private async signin(req: Request, res: Response): Promise<void> {
        const sessionId = this.getSessionId(req) ?? this.newSessionId();
        const session = this.sessions.get(sessionId)!;

        const { verifier, challenge } = await this.crypto.generatePkceCodes();
        const state = this.crypto.createNewGuid();
        session.flow = { state, codeVerifier: verifier };

        const authUrl = await this.client.getAuthCodeUrl({
            scopes: [this.settings.agentBlueprintScope],
            redirectUri: this.settings.azureAdRedirectUri,
            codeChallenge: challenge,
            codeChallengeMethod: "S256",
            state,
        });

        this.setSessionCookie(res, sessionId);
        res.redirect(authUrl);
    }

    private async signinOidc(req: Request, res: Response): Promise<void> {
        const session = this.getSession(req);
        const flow = session?.flow;

        if (!session || !flow) {
            res.status(401).send("The sign-in session was not found. Start again from /signin.");
            return;
        }

        // A flow is good for exactly one callback; dropping it here stops a replayed
        // callback from reusing the same verifier.
        session.flow = undefined;

        const { code, state, error, error_description: errorDescription } = req.query;

        if (typeof error === "string") {
            res.status(401).send(typeof errorDescription === "string" ? errorDescription : error);
            return;
        }

        if (typeof code !== "string" || state !== flow.state) {
            res.status(401).send("The sign-in response did not match the request.");
            return;
        }

        try {
            const result = await this.client.acquireTokenByCode({
                code,
                scopes: [this.settings.agentBlueprintScope],
                redirectUri: this.settings.azureAdRedirectUri,
                codeVerifier: flow.codeVerifier,
            });

            session.claims = (result.idTokenClaims ?? {}) as Record<string, unknown>;
            session.accountId = result.account?.homeAccountId;
            res.redirect("/");
        } catch (err) {
            console.error("Sign-in failed", err);
            res.status(401).send("Sign-in failed. Please try again.");
        }
    }

    private signout(req: Request, res: Response): void {
        const sessionId = this.getSessionId(req);
        if (sessionId) {
            this.sessions.delete(sessionId);
        }

        res.clearCookie(SESSION_COOKIE_NAME);
        res.redirect("/");
    }

    private async me(req: Request, res: Response): Promise<void> {
        const session = this.getSession(req);
        const account = session ? await this.getAccount(session) : null;

        res.json({
            authenticationConfigured: true,
            authenticated: Boolean(account),
            user: this.profile(session),
        });
    }

    /** Return a blueprint-scoped access token for the signed-in user. */
    async acquireUserAssertion(req: Request): Promise<string> {
        const session = this.getSession(req);
        if (!session) {
            throw new AuthRequiredError("Sign in before chatting with the agent.");
        }

        const account = await this.getAccount(session);
        if (!account) {
            throw new AuthRequiredError("Sign in before chatting with the agent.");
        }

        const result = await this.client
            .acquireTokenSilent({ account, scopes: [this.settings.agentBlueprintScope] })
            .catch(() => null);

        if (!result?.accessToken) {
            throw new AuthRequiredError("Sign in again so the app can get a user assertion.");
        }

        return result.accessToken;
    }
}

function parseCookies(req: Request): Record<string, string> {
    const header = req.headers.cookie;
    if (!header) {
        return {};
    }

    return Object.fromEntries(
        header
            .split(";")
            .map((part) => part.trim().split("="))
            .filter((pair): pair is [string, string] => pair.length === 2)
            .map(([name, value]) => [name, decodeURIComponent(value)]),
    );
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}
