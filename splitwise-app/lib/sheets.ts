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
    range: 'Expenses!A2:G',
  });
  const rows = res.data.values || [];
  return rows.map((r) => ({
    id: r[0],
    description: r[1],
    amount: parseFloat(r[2]),
    paidBy: r[3],
    date: r[4],
    // r[5] = participants JSON: [{userId, percent}]
    participants: JSON.parse(r[5] || '[]'),
    createdBy: r[6],
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
    range: 'Expenses!A:G',
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
      ]],
    },
  });
}
