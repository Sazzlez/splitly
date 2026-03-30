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

function parseParticipants(raw: string | undefined) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseSettledBy(raw: string | undefined, legacySettled: boolean, paidBy: string, participants: { userId: string; percent: number }[]) {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) {
      return parsed.filter((userId) => typeof userId === 'string' && userId !== paidBy);
    }
  } catch {
    // fall through to legacy mode
  }

  if (legacySettled) {
    return participants
      .map((participant) => participant.userId)
      .filter((userId) => userId !== paidBy);
  }

  return [];
}

function normalizeSettledBy(settledBy: string[], paidBy: string, participants: { userId: string; percent: number }[]) {
  const validDebtors = new Set(
    participants
      .map((participant) => participant.userId)
      .filter((userId) => userId !== paidBy)
  );

  return Array.from(new Set(settledBy)).filter((userId) => validDebtors.has(userId));
}

function areAllDebtorsSettled(settledBy: string[], paidBy: string, participants: { userId: string; percent: number }[]) {
  const debtors = participants
    .map((participant) => participant.userId)
    .filter((userId) => userId !== paidBy);

  if (!debtors.length) return false;
  return debtors.every((userId) => settledBy.includes(userId));
}

// ── USERS ──────────────────────────────────────────────────────────────────
export async function getUsers() {
  const sheets = await getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Users!A2:C',
  });

  const rows = response.data.values || [];
  return rows.map((row: string[]) => ({ id: row[0], name: row[1], passwordHash: row[2] }));
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
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Expenses!A2:I',
  });

  const rows = response.data.values || [];

  return rows.map((row: string[]) => {
    const paidBy = row[3];
    const participants = parseParticipants(row[5]);
    const settledBy = normalizeSettledBy(
      parseSettledBy(row[8], row[7] === 'true', paidBy, participants),
      paidBy,
      participants,
    );

    return {
      id: row[0],
      description: row[1],
      amount: parseFloat(row[2]),
      paidBy,
      date: row[4],
      participants,
      createdBy: row[6],
      settled: areAllDebtorsSettled(settledBy, paidBy, participants),
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
  participants: { userId: string; percent: number }[];
  createdBy: string;
}) {
  const sheets = await getSheets();

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Expenses!A:I',
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
        '[]',
      ]],
    },
  });
}

// Find the row index (1-based) of an expense by id
async function findExpenseRowIndex(sheets: Awaited<ReturnType<typeof getSheets>>, id: string): Promise<number> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Expenses!A2:A',
  });

  const rows = response.data.values || [];
  const index = rows.findIndex((row: string[]) => row[0] === id);

  if (index === -1) throw new Error('Expense not found');
  return index + 2;
}

export async function updateExpense(id: string, fields: {
  description?: string;
  amount?: number;
  paidBy?: string;
  participants?: { userId: string; percent: number }[];
}) {
  const sheets = await getSheets();
  const rowIndex = await findExpenseRowIndex(sheets, id);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `Expenses!A${rowIndex}:I${rowIndex}`,
  });

  const row = response.data.values?.[0] || [];
  const currentPaidBy = row[3];
  const currentParticipants = parseParticipants(row[5]);
  const currentSettledBy = normalizeSettledBy(
    parseSettledBy(row[8], row[7] === 'true', currentPaidBy, currentParticipants),
    currentPaidBy,
    currentParticipants,
  );

  const nextPaidBy = fields.paidBy ?? currentPaidBy;
  const nextParticipants = fields.participants ?? currentParticipants;
  const nextSettledBy = normalizeSettledBy(currentSettledBy, nextPaidBy, nextParticipants);
  const nextSettled = areAllDebtorsSettled(nextSettledBy, nextPaidBy, nextParticipants);

  const updatedRow = [
    row[0],
    fields.description ?? row[1],
    fields.amount ?? row[2],
    nextPaidBy,
    row[4],
    fields.participants ? JSON.stringify(nextParticipants) : row[5],
    row[6],
    String(nextSettled),
    JSON.stringify(nextSettledBy),
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Expenses!A${rowIndex}:I${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [updatedRow] },
  });
}

export async function deleteExpense(id: string) {
  const sheets = await getSheets();
  const rowIndex = await findExpenseRowIndex(sheets, id);

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = meta.data.sheets?.find((entry: any) => entry.properties?.title === 'Expenses');
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

export async function toggleDebtSettled(id: string, debtorUserId: string) {
  const sheets = await getSheets();
  const rowIndex = await findExpenseRowIndex(sheets, id);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `Expenses!A${rowIndex}:I${rowIndex}`,
  });

  const row = response.data.values?.[0] || [];
  const paidBy = row[3];
  const participants = parseParticipants(row[5]);

  const validDebtors = new Set(
    participants
      .map((participant) => participant.userId)
      .filter((userId) => userId !== paidBy)
  );

  if (!validDebtors.has(debtorUserId)) {
    throw new Error('Debt entry not found for debtor');
  }

  const currentSettledBy = normalizeSettledBy(
    parseSettledBy(row[8], row[7] === 'true', paidBy, participants),
    paidBy,
    participants,
  );

  const nextSettledBy = currentSettledBy.includes(debtorUserId)
    ? currentSettledBy.filter((userId) => userId !== debtorUserId)
    : [...currentSettledBy, debtorUserId];

  const normalizedSettledBy = normalizeSettledBy(nextSettledBy, paidBy, participants);
  const settled = areAllDebtorsSettled(normalizedSettledBy, paidBy, participants);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Expenses!H${rowIndex}:I${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[String(settled), JSON.stringify(normalizedSettledBy)]],
    },
  });

  return {
    settled,
    settledBy: normalizedSettledBy,
  };
}
