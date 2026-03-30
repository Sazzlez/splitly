import { google } from 'googleapis';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID!;

type Participant = { userId: string; percent: number };
type SettledAmounts = Record<string, number>;

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

function parseParticipants(raw: string | undefined): Participant[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getParticipantShare(amount: number, participants: Participant[], debtorUserId: string) {
  const participant = participants.find((entry) => entry.userId === debtorUserId);
  if (!participant) return 0;
  return (amount * participant.percent) / 100;
}

function normalizeSettledAmounts(
  settledAmounts: SettledAmounts,
  paidBy: string,
  participants: Participant[],
  amount: number,
): SettledAmounts {
  const normalized: SettledAmounts = {};

  participants.forEach((participant) => {
    if (participant.userId === paidBy) return;

    const share = getParticipantShare(amount, participants, participant.userId);
    const rawValue = Number(settledAmounts[participant.userId] ?? 0);
    const clamped = Math.min(Math.max(Number.isFinite(rawValue) ? rawValue : 0, 0), share);

    if (clamped > 0.0001) {
      normalized[participant.userId] = parseFloat(clamped.toFixed(2));
    }
  });

  return normalized;
}

function parseLegacySettledBy(raw: string | undefined, legacySettled: boolean, paidBy: string, participants: Participant[]) {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) {
      return parsed.filter((userId) => typeof userId === 'string' && userId !== paidBy);
    }
  } catch {
    // ignore and fall back
  }

  if (legacySettled) {
    return participants
      .map((participant) => participant.userId)
      .filter((userId) => userId !== paidBy);
  }

  return [] as string[];
}

function parseSettledAmounts(
  raw: string | undefined,
  paidBy: string,
  participants: Participant[],
  amount: number,
  legacySettledBy: string[],
): SettledAmounts {
  try {
    const parsed = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return normalizeSettledAmounts(parsed as SettledAmounts, paidBy, participants, amount);
    }
  } catch {
    // ignore and fall back to legacy data
  }

  const fromLegacy: SettledAmounts = {};
  legacySettledBy.forEach((debtorUserId) => {
    const share = getParticipantShare(amount, participants, debtorUserId);
    if (share > 0.0001) {
      fromLegacy[debtorUserId] = parseFloat(share.toFixed(2));
    }
  });

  return normalizeSettledAmounts(fromLegacy, paidBy, participants, amount);
}

function areAllDebtorsSettled(
  settledAmounts: SettledAmounts,
  paidBy: string,
  participants: Participant[],
  amount: number,
) {
  const debtors = participants
    .map((participant) => participant.userId)
    .filter((userId) => userId !== paidBy);

  if (!debtors.length) return false;

  return debtors.every((debtorUserId) => {
    const share = getParticipantShare(amount, participants, debtorUserId);
    const settledAmount = settledAmounts[debtorUserId] ?? 0;
    return share - settledAmount <= 0.005;
  });
}

function getFullySettledDebtors(
  settledAmounts: SettledAmounts,
  paidBy: string,
  participants: Participant[],
  amount: number,
) {
  return participants
    .map((participant) => participant.userId)
    .filter((userId) => userId !== paidBy)
    .filter((debtorUserId) => {
      const share = getParticipantShare(amount, participants, debtorUserId);
      const settledAmount = settledAmounts[debtorUserId] ?? 0;
      return share - settledAmount <= 0.005;
    });
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
    range: 'Expenses!A2:J',
  });

  const rows = response.data.values || [];

  return rows.map((row: string[]) => {
    const paidBy = row[3];
    const amount = parseFloat(row[2]);
    const participants = parseParticipants(row[5]);
    const legacySettledBy = parseLegacySettledBy(row[8], row[7] === 'true', paidBy, participants);
    const settledAmounts = parseSettledAmounts(row[9], paidBy, participants, amount, legacySettledBy);
    const settled = areAllDebtorsSettled(settledAmounts, paidBy, participants, amount);

    return {
      id: row[0],
      description: row[1],
      amount,
      paidBy,
      date: row[4],
      participants,
      createdBy: row[6],
      settled,
      settledBy: getFullySettledDebtors(settledAmounts, paidBy, participants, amount),
      settledAmounts,
    };
  });
}

export async function addExpense(expense: {
  id: string;
  description: string;
  amount: number;
  paidBy: string;
  date: string;
  participants: Participant[];
  createdBy: string;
}) {
  const sheets = await getSheets();

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Expenses!A:J',
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
        '{}',
      ]],
    },
  });
}

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
  participants?: Participant[];
}) {
  const sheets = await getSheets();
  const rowIndex = await findExpenseRowIndex(sheets, id);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `Expenses!A${rowIndex}:J${rowIndex}`,
  });

  const row = response.data.values?.[0] || [];
  const currentPaidBy = row[3];
  const currentAmount = parseFloat(row[2]);
  const currentParticipants = parseParticipants(row[5]);
  const legacySettledBy = parseLegacySettledBy(row[8], row[7] === 'true', currentPaidBy, currentParticipants);
  const currentSettledAmounts = parseSettledAmounts(row[9], currentPaidBy, currentParticipants, currentAmount, legacySettledBy);

  const nextPaidBy = fields.paidBy ?? currentPaidBy;
  const nextAmount = fields.amount ?? currentAmount;
  const nextParticipants = fields.participants ?? currentParticipants;
  const nextSettledAmounts = normalizeSettledAmounts(currentSettledAmounts, nextPaidBy, nextParticipants, nextAmount);
  const nextSettled = areAllDebtorsSettled(nextSettledAmounts, nextPaidBy, nextParticipants, nextAmount);

  const updatedRow = [
    row[0],
    fields.description ?? row[1],
    nextAmount,
    nextPaidBy,
    row[4],
    JSON.stringify(nextParticipants),
    row[6],
    String(nextSettled),
    JSON.stringify(getFullySettledDebtors(nextSettledAmounts, nextPaidBy, nextParticipants, nextAmount)),
    JSON.stringify(nextSettledAmounts),
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Expenses!A${rowIndex}:J${rowIndex}`,
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

export async function applyDebtSettlements(entries: { id: string; debtorUserId: string; amount: number }[]) {
  const sheets = await getSheets();
  const results: { id: string; debtorUserId: string; settledAmount: number }[] = [];

  for (const entry of entries) {
    const amountToApply = Number(entry.amount);
    if (!Number.isFinite(amountToApply) || amountToApply <= 0) {
      throw new Error('Invalid settlement amount');
    }

    const rowIndex = await findExpenseRowIndex(sheets, entry.id);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `Expenses!A${rowIndex}:J${rowIndex}`,
    });

    const row = response.data.values?.[0] || [];
    const paidBy = row[3];
    const totalAmount = parseFloat(row[2]);
    const participants = parseParticipants(row[5]);
    const legacySettledBy = parseLegacySettledBy(row[8], row[7] === 'true', paidBy, participants);
    const currentSettledAmounts = parseSettledAmounts(row[9], paidBy, participants, totalAmount, legacySettledBy);

    const share = getParticipantShare(totalAmount, participants, entry.debtorUserId);
    if (share <= 0.005 || entry.debtorUserId === paidBy) {
      throw new Error('Debt entry not found for debtor');
    }

    const currentSettledAmount = currentSettledAmounts[entry.debtorUserId] ?? 0;
    const nextSettledAmounts = normalizeSettledAmounts({
      ...currentSettledAmounts,
      [entry.debtorUserId]: currentSettledAmount + amountToApply,
    }, paidBy, participants, totalAmount);

    const settled = areAllDebtorsSettled(nextSettledAmounts, paidBy, participants, totalAmount);

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Expenses!H${rowIndex}:J${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[
          String(settled),
          JSON.stringify(getFullySettledDebtors(nextSettledAmounts, paidBy, participants, totalAmount)),
          JSON.stringify(nextSettledAmounts),
        ]],
      },
    });

    results.push({
      id: entry.id,
      debtorUserId: entry.debtorUserId,
      settledAmount: nextSettledAmounts[entry.debtorUserId] ?? 0,
    });
  }

  return results;
}
