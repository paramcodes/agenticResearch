// Serves GET /api/health. See api/index.ts for why the pre-bundled handler.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { default: handler } = require("./handler.cjs") as {
  default: (req: unknown, res: unknown) => unknown;
};
export default handler;
