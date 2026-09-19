// Serves exactly /api/agent (Express answers its JSON 404 there).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { default: handler } = require("../.bundle/handler.cjs") as {
  default: (req: unknown, res: unknown) => unknown;
};
export default handler;
