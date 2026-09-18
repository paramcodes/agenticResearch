import { prisma } from "../src/index.js";

// Optional seed for local dev: a demo user (password: password123) with one
// sample conversation. Safe to re-run — uses upsert semantics.
async function main() {
  const { hash } = await import("bcryptjs").catch(() => ({
    hash: null as null | ((s: string, r: number) => Promise<string>),
  }));
  void hash;

  const email = "demo@researcherit.local";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    let passwordHash: string | undefined;
    try {
      const bcrypt = await import("bcryptjs");
      passwordHash = await bcrypt.hash("password123", 10);
    } catch {
      passwordHash = undefined;
    }
    const user = await prisma.user.create({
      data: {
        name: "Demo Researcher",
        email,
        username: "demo",
        passwordHash,
        provider: "CREDENTIALS",
      },
    });
    const convo = await prisma.conversation.create({
      data: {
        userId: user.id,
        title: "Welcome to ResearcherIt",
        status: "completed",
      },
    });
    await prisma.message.createMany({
      data: [
        {
          conversationId: convo.id,
          role: "user",
          content: "What can you research for me?",
        },
        {
          conversationId: convo.id,
          role: "assistant",
          content:
            "# Welcome to ResearcherIt\n\nAsk any topic in the **Agent** page and the multi-agent system will return markdown research here.\n\n- Streaming over websockets lands in Step 3\n- History persists in Postgres\n- Session state lives in Redis",
        },
      ],
    });
    console.log("Seeded demo user:", email);
  } else {
    console.log("Demo user already exists, skipping.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
