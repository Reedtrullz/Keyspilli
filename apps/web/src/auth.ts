import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";

function isLoopbackAuthUrl(value: string | undefined): boolean {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function getProviders(): Provider[] {
  const providers: Provider[] = [GitHub];
  // Test-only login for Playwright; it needs three opt-ins and a loopback origin.
  const testToken = process.env.KEYSPILLI_E2E_LOGIN_TOKEN;
  if (process.env.KEYSPILLI_E2E_LOGIN === "1" && testToken && isLoopbackAuthUrl(process.env.AUTH_URL)) {
    providers.push(
      Credentials({
        id: "e2e-owner",
        credentials: { token: { type: "password" } },
        authorize: (credentials) =>
          credentials?.token === testToken
            ? { id: process.env.OWNER_GITHUB_ID ?? "", name: "E2E owner" }
            : null,
      }),
    );
  }
  return providers;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  pages: { signIn: "/signin", error: "/signin" },
  providers: getProviders(),
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 14 },
  callbacks: {
    // Any GitHub account may sign in so it can apply; the proxy keeps it out of the app until approved.
    jwt({ token, profile }) {
      if (profile?.id !== undefined) token.githubId = String(profile.id);
      if (typeof profile?.login === "string") token.githubLogin = profile.login;
      return token;
    },
    session({ session, token }) {
      const id = typeof token.githubId === "string" ? token.githubId : token.sub;
      if (session.user && id) session.user.id = id;
      if (session.user && typeof token.githubLogin === "string") session.user.login = token.githubLogin;
      return session;
    },
  },
  trustHost: true,
});
