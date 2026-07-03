import { prisma } from "../config/database.js";
import { logger } from "../config/logger.js";
import { config } from "../config/index.js";

interface AIChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * AI Chat — calls OpenAI or Anthropic API depending on which key is configured.
 * Falls back to a helpful offline response if no API keys are set.
 */
export async function chat(
  messages: AIChatMessage[],
  userId: string,
  chamaId?: string,
): Promise<AIChatMessage> {
  // Build system prompt with chama context
  let systemPrompt =
    "You are a helpful financial assistant for Pamoja Wealth, a chama (group savings) " +
    "and fundraising platform in East Africa. You help with: savings strategies, loan advice, " +
    "investment guidance, chama management, and fundraising best practices. " +
    "Be concise, practical, and culturally aware. Use Kenyan Shillings (KES) for amounts. " +
    "Encourage financial discipline and community wealth building.";

  if (chamaId) {
    try {
      const chama = await prisma.chama.findUnique({ where: { id: chamaId } });
      if (chama) {
        const stats = await prisma.membership.count({ where: { chamaId, status: "active" } });
        systemPrompt += ` Current chama: ${chama.name}, ${stats} active members, total funds KES ${Number(chama.totalFunds || 0).toLocaleString()}.`;
      }
    } catch (e) {
      logger.warn({ error: e }, "Failed to load chama context for AI chat");
    }
  }

  const fullMessages = [
    { role: "system" as const, content: systemPrompt },
    ...messages,
  ];

  // Try Anthropic (Claude) first
  if (config.ai.anthropicKey) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.ai.anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          messages: fullMessages.map((m) => ({
            role: m.role === "system" ? "user" : m.role,
            content: m.content,
          })),
          system: systemPrompt,
        }),
      });

      if (response.ok) {
        const data = await response.json() as any;
        const content = data?.content?.[0]?.text || "I apologize, I couldn't process that request.";
        logger.info({ userId, msgCount: messages.length }, "AI chat (Claude) response");
        return { role: "assistant", content };
      }
      logger.warn({ status: response.status }, "Claude API returned non-OK status, falling back");
    } catch (error) {
      logger.warn({ error }, "Claude API call failed, trying OpenAI fallback");
    }
  }

  // Try OpenAI as fallback
  if (config.ai.openaiKey) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.ai.openaiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: fullMessages.map((m) => ({
            role: m.role as "system" | "user" | "assistant",
            content: m.content,
          })),
          max_tokens: 1024,
          temperature: 0.7,
        }),
      });

      if (response.ok) {
        const data = await response.json() as any;
        const content = data?.choices?.[0]?.message?.content ||
          "I apologize, I couldn't process that request.";
        logger.info({ userId, msgCount: messages.length }, "AI chat (OpenAI) response");
        return { role: "assistant", content };
      }
      logger.warn({ status: response.status }, "OpenAI API returned non-OK status");
    } catch (error) {
      logger.warn({ error }, "OpenAI API call failed");
    }
  }

  // Offline fallback — still useful
  logger.info({ userId, msgCount: messages.length }, "AI chat (offline fallback)");
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const topic = lastUserMsg?.content?.toLowerCase() || "";

  if (topic.includes("loan") || topic.includes("borrow")) {
    return {
      role: "assistant",
      content: "For chama loans, I recommend: 1) Set clear terms (interest rate, repayment period) before disbursing, 2) Only lend to members with good contribution history, 3) Never lend more than 3x a member's total contributions, 4) Require at least 2 guarantors from within the chama. Would you like me to help draft loan terms?",
    };
  }
  if (topic.includes("save") || topic.includes("saving")) {
    return {
      role: "assistant",
      content: "Great focus on savings! Key tips: 1) Aim to save at least 20% of your chama's monthly contributions for emergencies, 2) Consider splitting savings between accessible (bank/MMF) and growth (treasury bills, bonds), 3) Track each member's savings-to-goal ratio. Your chama can set up automatic savings goals in the app. Want help setting that up?",
    };
  }
  if (topic.includes("invest") || topic.includes("investment")) {
    return {
      role: "assistant",
      content: "For chama investments, consider: 1) Low-risk: Treasury bills (91-day: ~9% p.a.), money market funds (~10-12% p.a.), 2) Medium-risk: Corporate bonds, REITs on NSE, 3) Higher-risk: Stock portfolio (NSE blue chips). Always diversify — never put all chama funds in one investment. Would you like a sample investment policy for your chama?",
    };
  }
  if (topic.includes("fundrais") || topic.includes("harambee") || topic.includes("donat")) {
    return {
      role: "assistant",
      content: "For successful fundraisers: 1) Set a realistic target and deadline, 2) Share your campaign on WhatsApp — it's the #1 channel for Kenyan fundraisers, 3) Post regular updates with photos/videos to build trust, 4) Ask committee members to share with their networks — peer-to-peer sharing typically doubles donations. Your referral link earns you KES 500 per new chama that signs up!",
    };
  }

  return {
    role: "assistant",
    content: "I'm your Pamoja Wealth financial assistant. I can help with: chama management, savings strategies, loan structuring, investment advice, and fundraising tips. What would you like help with today? You can ask me about your specific chama's data if you're viewing one.",
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

  // Compute real-time insights from actual chama data
  try {
    const [chama, activeMembers, totalMembers, totalContributions, overdueLoans] =
      await Promise.all([
        prisma.chama.findUnique({ where: { id: chamaId } }),
        prisma.membership.count({ where: { chamaId, status: "active" } }),
        prisma.membership.count({ where: { chamaId } }),
        prisma.transaction.aggregate({
          where: { chamaId, type: "contribution", status: "completed" },
          _sum: { amount: true },
        }),
        prisma.loan.count({ where: { chamaId, status: "defaulted" } }),
      ]);

    const insights: string[] = [];

    if (chama) {
      insights.push(`Total chama funds: KES ${Number(chama.totalFunds || 0).toLocaleString()}`);
    }

    if (activeMembers && totalMembers && activeMembers < totalMembers) {
      insights.push(
        `${activeMembers} of ${totalMembers} members are active — consider reaching out to inactive members`,
      );
    } else {
      insights.push(`All ${activeMembers} members are active — great engagement!`);
    }

    if (totalContributions._sum.amount) {
      insights.push(
        `Total contributions: KES ${Number(totalContributions._sum.amount).toLocaleString()}`,
      );
    }

    if (overdueLoans > 0) {
      insights.push(
        `${overdueLoans} loan(s) are overdue — review and send reminders to protect the chama fund`,
      );
    } else {
      insights.push("All loans are in good standing — excellent credit management!");
    }

    // Add actionable suggestions
    if (activeMembers >= 10) {
      insights.push(
        "With 10+ active members, consider diversifying into treasury bills for better returns",
      );
    }

    return insights;
  } catch (error) {
    logger.error({ error, chamaId }, "Failed to compute insights");
    return [
      "Unable to load insights at this time. Please try again later.",
      "Your chama data is safe — this is a temporary issue.",
    ];
  }
}

export async function getHealthScore(chamaId: string): Promise<{
  score: number;
  details: { category: string; score: number; comment: string }[];
}> {
  try {
    const chama = await prisma.chama.findUnique({ where: { id: chamaId } });
    if (!chama) return { score: 0, details: [] };

    const [activeMembers, totalMembers, overdueLoans, totalLoans, recentContributions] =
      await Promise.all([
        prisma.membership.count({ where: { chamaId, status: "active" } }),
        prisma.membership.count({ where: { chamaId } }),
        prisma.loan.count({ where: { chamaId, status: "defaulted" } }),
        prisma.loan.count({ where: { chamaId } }),
        prisma.transaction.count({
          where: {
            chamaId,
            type: "contribution",
            status: "completed",
            createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          },
        }),
      ]);

    // Member retention: 0-100
    const memberRetention = totalMembers > 0
      ? Math.round((activeMembers / totalMembers) * 100)
      : 0;

    // Loan health: 100 minus penalty for defaults. 0 defaults = 100, 5+ defaults = 0
    const loanHealth = totalLoans > 0
      ? Math.max(0, Math.round(100 - (overdueLoans / totalLoans) * 100))
      : 100;

    // Fund activity: based on recent contribution count per member
    const activityScore = activeMembers > 0
      ? Math.min(100, Math.round((recentContributions / activeMembers) * 100))
      : 0;

    // Overall: weighted average
    const overall = Math.round(
      (memberRetention * 0.35) + (loanHealth * 0.35) + (activityScore * 0.30),
    );

    return {
      score: Math.min(100, Math.max(0, overall)),
      details: [
        {
          category: "Member Engagement",
          score: memberRetention,
          comment: `${activeMembers} of ${totalMembers} members active (${memberRetention}%)`,
        },
        {
          category: "Loan Health",
          score: loanHealth,
          comment: overdueLoans > 0
            ? `${overdueLoans} overdue out of ${totalLoans} loans`
            : "All loans in good standing",
        },
        {
          category: "Contribution Activity",
          score: activityScore,
          comment: `${recentContributions} contributions in last 30 days`,
        },
      ],
    };
  } catch (error) {
    logger.error({ error, chamaId }, "Failed to compute health score");
    return {
      score: 50,
      details: [
        { category: "Error", score: 0, comment: "Could not compute health score. Please try again." },
      ],
    };
  }
}
