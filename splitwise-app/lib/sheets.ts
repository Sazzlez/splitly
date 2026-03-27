import { google } from 'googleapis';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID!;

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

// ── USERS ──────────────────────────────────────────────────────────────────
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

// ── EXPENSES ───────────────────────────────────────────────────────────────
export async function getExpenses() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Expenses!A2:H',
  });
  const rows = res.data.values || [];
  return rows.map((r) => ({
    id: r[0],
    description: r[1],
    amount: parseFloat(r[2]),
    paidBy: r[3],
    date: r[4],
    participants: JSON.parse(r[5] || '[]'),
    createdBy: r[6],
    settled: r[7] === 'true',
  }));
}

export async function addExpense(expense: {
  id: string;
  description: string;
  amount: number;
  paidBy: string;
  date: string;
  participants: { userId: string; percent: number }[];
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
        'false',
      ]],
    },
  });
}

// Find the row index (1-based) of an expense by id
async function findExpenseRowIndex(sheets: Awaited<ReturnType<typeof getSheets>>, id: string): Promise<number> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Expenses!A2:A',
  });
  const rows = res.data.values || [];
  const idx = rows.findIndex((r) => r[0] === id);
  if (idx === -1) throw new Error('Expense not found');
  return idx + 2; // +1 for header, +1 for 1-based
}

export async function updateExpense(id: string, fields: {
  description?: string;
  amount?: number;
  paidBy?: string;
  participants?: { userId: string; percent: number }[];
}) {
  const sheets = await getSheets();
  const rowIndex = await findExpenseRowIndex(sheets, id);

  // Read current row first
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `Expenses!A${rowIndex}:H${rowIndex}`,
  });
  const row = res.data.values?.[0] || [];

  const updated = [
    row[0], // id
    fields.description ?? row[1],
    fields.amount ?? row[2],
    fields.paidBy ?? row[3],
    row[4], // date unchanged
    fields.participants ? JSON.stringify(fields.participants) : row[5],
    row[6], // createdBy unchanged
    row[7] ?? 'false',
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

  // Get spreadsheet to find the sheet id
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
            startIndex: rowIndex - 1, // 0-based
            endIndex: rowIndex,
          },
        },
      }],
    },
  });
}

export async function toggleSettled(id: string): Promise<boolean> {
  const sheets = await getSheets();
  const rowIndex = await findExpenseRowIndex(sheets, id);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `Expenses!H${rowIndex}`,
  });
  const current = res.data.values?.[0]?.[0] === 'true';
  const next = !current;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Expenses!H${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[String(next)]] },
  });
  return next;
}
