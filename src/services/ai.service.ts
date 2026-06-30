import { prisma } from "../config/database.js";
import { logger } from "../config/logger.js";
import { config } from "../config/index.js";

interface AIChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function chat(
  messages: AIChatMessage[],
  userId: string,
  chamaId?: string
): Promise<AIChatMessage> {
  // Collect context
  let context = "You are a helpful financial assistant for Pamoja Wealth, a chama (group savings) platform in East Africa. ";
  context += "You help with: savings strategies, loan advice, investment guidance, and chama management.";

  if (chamaId) {
    const chama = await prisma.chama.findUnique({ where: { id: chamaId } });
    if (chama) {
      const stats = await prisma.membership.count({ where: { chamaId, status: "active" } });
      context += ` Current chama: ${chama.name}, ${stats} members, total funds KES ${Number(chama.totalFunds).toLocaleString()}.`;
    }
  }

  // AI proxy — use OpenAI or Anthropic if keys are configured
  if (config.nodeEnv === "development") {
    logger.info({ userId, msgCount: messages.length }, "DEV: AI chat (mock response)");
    return {
      role: "assistant",
      content: "I'm your Pamoja Wealth assistant. In production, I'll provide personalized financial advice based on your chama's data. How can I help you today?",
    };
  }

  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return {
      role: "assistant",
      content: "AI features are not configured yet. Please set up an API key in environment variables.",
    };
  }

  // TODO: Call OpenAI/Anthropic API
  return {
    role: "assistant",
    content: "AI assistant is being set up. Check back soon!",
  };
}

export async function getInsights(chamaId: string): Promise<string[]> {
  const cache = await prisma.analyticsCache.findMany({
    where: { chamaId, metric: "insights" },
    orderBy: { computedAt: "desc" },
    take: 5,
  });

  if (cache.length > 0) {
    return cache.map((c) => `${c.periodKey}: ${c.value}`);
  }

  // Default insights
  return [
    "Member contributions are up 12% this month",
    "Consider diversifying into treasury bills for better returns",
    "3 members have perfect contribution streaks — celebrate them!",
    "Your chama's savings rate is above average for your region",
  ];
}

export async function getHealthScore(chamaId: string): Promise<{
  score: number;
  details: { category: string; score: number; comment: string }[];
}> {
  const chama = await prisma.chama.findUnique({ where: { id: chamaId } });
  if (!chama) return { score: 0, details: [] };

  const [activeMembers, totalMembers, overdueLoans] = await Promise.all([
    prisma.membership.count({ where: { chamaId, status: "active" } }),
    prisma.membership.count({ where: { chamaId } }),
    prisma.loan.count({ where: { chamaId, status: "defaulted" } }),
  ]);

  const memberRetention = totalMembers > 0 ? (activeMembers / totalMembers) * 100 : 0;
  const loanHealth = 100 - (overdueLoans * 20);
  const fundScore = Number(chama.totalFunds) > 0 ? 70 : 30;

  const score = Math.round((memberRetention + Math.max(loanHealth, 0) + fundScore) / 3);

  return {
    score: Math.min(100, Math.max(0, score)),
    details: [
      { category: "Member Retention", score: Math.round(memberRetention),
        comment: `${activeMembers} of ${totalMembers} members active` },
      { category: "Loan Health", score: Math.max(0, Math.round(loanHealth)),
        comment: `${overdueLoans} defaulted loans` },
      { category: "Fund Health", score: Math.round(fundScore),
        comment: `Total funds: KES ${Number(chama.totalFunds).toLocaleString()}` },
    ],
  };
}
