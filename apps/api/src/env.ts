import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: required("DATABASE_URL", "postgresql://researcher:researcherpw@localhost:5432/researcherit?schema=public"),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((s) => s.trim()),
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  allowInsecureGoogleDev: process.env.ALLOW_INSECURE_GOOGLE_DEV === "true",
};

if (!process.env.JWT_SECRET && config.nodeEnv === "production") {
  throw new Error("JWT_SECRET must be set in production");
}
