// Serves /api/auth/* (register, login, google, me, profile,
// change-password, logout, refresh). See api/index.ts for the bundle note.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { default: handler } = require("../.bundle/handler.cjs") as {
  default: (req: unknown, res: unknown) => unknown;
};
export default handler;
