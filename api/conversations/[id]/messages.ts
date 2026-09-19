// Serves POST /api/conversations/:id/messages (the chat loop — the
// longest-running endpoint, hence the 60s maxDuration in vercel.json).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { default: handler } = require("./handler.cjs") as {
  default: (req: unknown, res: unknown) => unknown;
};
export default handler;
