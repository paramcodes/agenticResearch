// Serves /api/conversations/:id (get, patch, delete).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { default: handler } = require("./handler.cjs") as {
  default: (req: unknown, res: unknown) => unknown;
};
export default handler;
