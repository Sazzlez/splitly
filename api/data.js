import { Redis } from '@upstash/redis';
const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

function computeBalances(users, expenses) {
  const userMap = {};
  for (const u of users) userMap[u.id] = u.name;

  // debts[fromId][toId] = total amount owed — NOT simplified/netted
  const debts = {};

  for (const expense of expenses) {
    const share = expense.amount / expense.participants.length;
    for (const participantId of expense.participants) {
      if (participantId !== expense.paidBy) {
        if (!debts[participantId]) debts[participantId] = {};
        debts[participantId][expense.paidBy] =
          (debts[participantId][expense.paidBy] || 0) + share;
      }
    }
  }

  const balances = [];
  for (const [fromId, toMap] of Object.entries(debts)) {
    for (const [toId, amount] of Object.entries(toMap)) {
      if (amount > 0.005) {
        balances.push({
          from: userMap[fromId] || fromId,
          fromId,
          to: userMap[toId] || toId,
          toId,
          amount: Math.round(amount * 100) / 100,
        });
      }
    }
  }

  return balances;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const [users, expenses] = await Promise.all([
    kv.get('users').then((v) => v ?? []),
    kv.get('expenses').then((v) => v ?? []),
  ]);

  const balances = computeBalances(users, expenses);
  return res.json({ users, expenses, balances });
}
