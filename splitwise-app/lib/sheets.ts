import { google } from 'googleapis';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID!;

type ExpenseParticipant = { userId: string; percent: number };

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

export async function getSheets() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

function parseSettledBy(rawValue: string | undefined, participants: ExpenseParticipant[], paidBy: string): string[] {
  const value = String(rawValue || '').trim();
  const debtorIds = participants.filter((p) => p.userId !== paidBy).map((p) => p.userId);

  if (!value || value === 'false') return [];
  if (value === 'true') return debtorIds;

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === 'string');
    }
  } catch {
    // ignore malformed legacy values
  }

  return [];
}

export async function getUsers() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Users!A2:C',
  });
  const rows = res.data.values || [];
  return rows.map((r) => ({ id: r[0], name: r[1], passwordHash: r[2] }));
}

export async function addUser(id: string, name: string, passwordHash: string) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Users!A:C',
    valueInputOption: 'RAW',
    requestBody: { values: [[id, name, passwordHash]] },
  });
}

export async function getExpenses() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Expenses!A2:H',
  });
  const rows = res.data.values || [];

  return rows.map((r) => {
    const participants = JSON.parse(r[5] || '[]');
    const settledBy = parseSettledBy(r[7], participants, r[3]);

    return {
      id: r[0],
      description: r[1],
      amount: parseFloat(r[2]),
      paidBy: r[3],
      date: r[4],
      participants,
      createdBy: r[6],
      settled: r[7] === 'true',
      settledBy,
    };
  });
}

export async function addExpense(expense: {
  id: string;
  description: string;
  amount: number;
  paidBy: string;
  date: string;
  participants: ExpenseParticipant[];
  createdBy: string;
}) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Expenses!A:H',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        expense.id,
        expense.description,
        expense.amount,
        expense.paidBy,
        expense.date,
        JSON.stringify(expense.participants),
        expense.createdBy,
        '[]',
      ]],
    },
  });
}

async function findExpenseRowIndex(sheets: Awaited<ReturnType<typeof getSheets>>, id: string): Promise<number> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Expenses!A2:A',
  });
  const rows = res.data.values || [];
  const idx = rows.findIndex((r) => r[0] === id);
  if (idx === -1) throw new Error('Expense not found');
  return idx + 2;
}

export async function updateExpense(id: string, fields: {
  description?: string;
  amount?: number;
  paidBy?: string;
  participants?: ExpenseParticipant[];
}) {
  const sheets = await getSheets();
  const rowIndex = await findExpenseRowIndex(sheets, id);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `Expenses!A${rowIndex}:H${rowIndex}`,
  });
  const row = res.data.values?.[0] || [];

  const updated = [
    row[0],
    fields.description ?? row[1],
    fields.amount ?? row[2],
    fields.paidBy ?? row[3],
    row[4],
    fields.participants ? JSON.stringify(fields.participants) : row[5],
    row[6],
    row[7] ?? '[]',
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Expenses!A${rowIndex}:H${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [updated] },
  });
}

export async function deleteExpense(id: string) {
  const sheets = await getSheets();
  const rowIndex = await findExpenseRowIndex(sheets, id);

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = meta.data.sheets?.find((s) => s.properties?.title === 'Expenses');
  const sheetId = sheet?.properties?.sheetId ?? 0;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: rowIndex - 1,
            endIndex: rowIndex,
          },
        },
      }],
    },
  });
}

export async function toggleSettledPair(id: string, debtorUserId: string): Promise<string[]> {
  const sheets = await getSheets();
  const rowIndex = await findExpenseRowIndex(sheets, id);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `Expenses!A${rowIndex}:H${rowIndex}`,
  });
  const row = res.data.values?.[0] || [];

  const paidBy = row[3];
  const participants = JSON.parse(row[5] || '[]');
  const current = parseSettledBy(row[7], participants, paidBy);

  const next = current.includes(debtorUserId)
    ? current.filter((userId) => userId !== debtorUserId)
    : [...current, debtorUserId];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Expenses!H${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[JSON.stringify(next)]] },
  });

  return next;
}
