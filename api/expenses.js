import { Redis } from '@upstash/redis';
const kv = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const expenses = (await kv.get('expenses')) ?? [];
    return res.json(expenses);
  }

  if (req.method === 'POST') {
    const { description, amount, paidBy, participants } = req.body;
    if (!description?.trim() || !amount || !paidBy || !participants?.length) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const expense = {
      id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      description: description.trim(),
      amount: Math.round(parseFloat(amount) * 100) / 100,
      paidBy,
      participants,
      date: new Date().toISOString(),
    };

    const expenses = (await kv.get('expenses')) ?? [];
    expenses.unshift(expense);
    await kv.set('expenses', expenses);
    return res.status(201).json(expense);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'ID required' });
    const expenses = (await kv.get('expenses')) ?? [];
    await kv.set('expenses', expenses.filter((e) => e.id !== id));
    return res.json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
