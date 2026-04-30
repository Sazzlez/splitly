import { google } from 'googleapis';

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID!;

type Participant = { userId: string; percent: number };
type SettledAmounts = Record<string, number>;

export type SheetsEvent = {
  id: string;
  name: string;
  code: string;
  creatorId: string;
  memberIds: string[];
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

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
  return round2((amount * participant.percent) / 100);
}

function parseLegacySettledBy(raw: string | undefined, legacySettled: boolean, paidBy: string, participants: Participant[]) {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (Array.isArray(parsed)) {
      return parsed.filter((userId) => typeof userId === 'string' && userId !== paidBy);
    }
  } catch {
    // ignore
  }

  if (legacySettled) {
    return participants
      .map((participant) => participant.userId)
      .filter((userId) => userId !== paidBy);
  }

  return [] as string[];
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
    const clamped = round2(clamp(Number.isFinite(rawValue) ? rawValue : 0, 0, share));

    if (clamped > 0.0001) {
      normalized[participant.userId] = clamped;
    }
  });

  return normalized;
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
    // ignore
  }

  const fromLegacy: SettledAmounts = {};
  legacySettledBy.forEach((debtorUserId) => {
    const share = getParticipantShare(amount, participants, debtorUserId);
    if (share > 0.0001) {
      fromLegacy[debtorUserId] = share;
    }
  });

  return normalizeSettledAmounts(fromLegacy, paidBy, participants, amount);
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

export async function updateUser(id: string, fields: { name?: string; passwordHash?: string }) {
  const sheets = await getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Users!A2:C',
  });

  const rows = response.data.values || [];
  const index = rows.findIndex((row: string[]) => row[0] === id);
  if (index === -1) throw new Error('User not found');

  const rowIndex = index + 2;
  const row = rows[index];

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Users!A${rowIndex}:C${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[row[0], fields.name ?? row[1], fields.passwordHash ?? row[2]]],
    },
  });
}

// ── EVENTS ─────────────────────────────────────────────────────────────────
async function getSheetIdByName(sheets: Awaited<ReturnType<typeof getSheets>>, name: string): Promise<number | null> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = meta.data.sheets?.find((s: any) => s.properties?.title === name);
  return sheet?.properties?.sheetId ?? null;
}

export async function ensureEventsSheet() {
  const sheets = await getSheets();
  const existingId = await getSheetIdByName(sheets, 'Events');
  if (existingId !== null) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title: 'Events' } } }],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Events!A1:E1',
    valueInputOption: 'RAW',
    requestBody: { values: [['id', 'name', 'code', 'creatorId', 'memberIds']] },
  });
}

function parseEvent(row: string[]): SheetsEvent {
  let memberIds: string[] = [];
  try {
    const parsed = JSON.parse(row[4] || '[]');
    if (Array.isArray(parsed)) memberIds = parsed;
  } catch {
    // ignore
  }
  return { id: row[0], name: row[1], code: row[2], creatorId: row[3], memberIds };
}

export async function getEvents(userId: string): Promise<SheetsEvent[]> {
  const sheets = await getSheets();
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Events!A2:E',
    });
    const rows = response.data.values || [];
    return rows
      .map((row: string[]) => parseEvent(row))
      .filter((ev) => ev.memberIds.includes(userId));
  } catch {
    return [];
  }
}

export async function getEventByCode(code: string): Promise<SheetsEvent | null> {
  const sheets = await getSheets();
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Events!A2:E',
    });
    const rows = response.data.values || [];
    const row = rows.find((r: string[]) => r[2] === code.toUpperCase());
    return row ? parseEvent(row) : null;
  } catch {
    return null;
  }
}

async function findEventRowIndex(sheets: Awaited<ReturnType<typeof getSheets>>, id: string): Promise<number> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Events!A2:A',
  });
  const rows = response.data.values || [];
  const index = rows.findIndex((row: string[]) => row[0] === id);
  if (index === -1) throw new Error('Event not found');
  return index + 2;
}

export async function addEvent(event: SheetsEvent) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Events!A:E',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        event.id,
        event.name,
        event.code,
        event.creatorId,
        JSON.stringify(event.memberIds),
      ]],
    },
  });
}

export async function updateEventName(id: string, name: string) {
  const sheets = await getSheets();
  const rowIndex = await findEventRowIndex(sheets, id);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Events!B${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[name]] },
  });
}

export async function deleteEvent(id: string) {
  const sheets = await getSheets();
  const rowIndex = await findEventRowIndex(sheets, id);
  const sheetId = await getSheetIdByName(sheets, 'Events');

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId: sheetId ?? 0,
            dimension: 'ROWS',
            startIndex: rowIndex - 1,
            endIndex: rowIndex,
          },
        },
      }],
    },
  });
}

export async function addUserToEvent(eventId: string, userId: string) {
  const sheets = await getSheets();
  const rowIndex = await findEventRowIndex(sheets, eventId);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `Events!E${rowIndex}`,
  });

  let memberIds: string[] = [];
  try {
    const parsed = JSON.parse(response.data.values?.[0]?.[0] || '[]');
    if (Array.isArray(parsed)) memberIds = parsed;
  } catch {
    // ignore
  }

  if (!memberIds.includes(userId)) {
    memberIds.push(userId);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Events!E${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[JSON.stringify(memberIds)]] },
    });
  }
}

// ── EXPENSES ───────────────────────────────────────────────────────────────
export async function getExpenses(eventId?: string) {
  const sheets = await getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Expenses!A2:K',
  });

  const rows = response.data.values || [];

  const expenses = rows.map((row: string[]) => {
    const paidBy = row[3];
    const amount = parseFloat(row[2]);
    const participants = parseParticipants(row[5]);
    const legacySettledBy = parseLegacySettledBy(row[8], row[7] === 'true', paidBy, participants);
    const settledAmounts = parseSettledAmounts(row[9], paidBy, participants, amount, legacySettledBy);

    return {
      id: row[0],
      description: row[1],
      amount,
      paidBy,
      date: row[4],
      participants,
      createdBy: row[6],
      settled: areAllDebtorsSettled(settledAmounts, paidBy, participants, amount),
      settledBy: getFullySettledDebtors(settledAmounts, paidBy, participants, amount),
      settledAmounts,
      eventId: row[10] || null,
    };
  });

  if (eventId) {
    return expenses.filter((e) => e.eventId === eventId);
  }
  return expenses;
}

export async function addExpense(expense: {
  id: string;
  description: string;
  amount: number;
  paidBy: string;
  date: string;
  participants: Participant[];
  createdBy: string;
  eventId: string;
}) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Expenses!A:K',
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
        expense.eventId,
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
    range: `Expenses!A${rowIndex}:K${rowIndex}`,
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
  const nextSettledBy = getFullySettledDebtors(nextSettledAmounts, nextPaidBy, nextParticipants, nextAmount);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Expenses!A${rowIndex}:K${rowIndex}`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [[
        row[0],
        fields.description ?? row[1],
        nextAmount,
        nextPaidBy,
        row[4],
        JSON.stringify(nextParticipants),
        row[6],
        String(nextSettled),
        JSON.stringify(nextSettledBy),
        JSON.stringify(nextSettledAmounts),
        row[10] || '',
      ]],
    },
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

export async function applyDebtSettlements(
  entries: { id: string; debtorUserId: string; amount: number }[],
  action: 'settle' | 'unsettle' = 'settle',
) {
  const sheets = await getSheets();
  const results: { id: string; debtorUserId: string; settledAmount: number }[] = [];

  for (const entry of entries) {
    const rowIndex = await findExpenseRowIndex(sheets, entry.id);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `Expenses!A${rowIndex}:J${rowIndex}`,
    });

    const row = response.data.values?.[0] || [];
    const paidBy = row[3];
    const amount = parseFloat(row[2]);
    const participants = parseParticipants(row[5]);
    const legacySettledBy = parseLegacySettledBy(row[8], row[7] === 'true', paidBy, participants);
    const currentSettledAmounts = parseSettledAmounts(row[9], paidBy, participants, amount, legacySettledBy);

    const share = getParticipantShare(amount, participants, entry.debtorUserId);
    if (share <= 0.0001) {
      throw new Error('Debt entry not found for debtor');
    }

    const delta = round2(Number(entry.amount));
    if (!Number.isFinite(delta) || delta <= 0) {
      throw new Error('Invalid settlement amount');
    }

    const currentValue = currentSettledAmounts[entry.debtorUserId] ?? 0;
    const nextValue = action === 'settle'
      ? round2(clamp(currentValue + delta, 0, share))
      : round2(clamp(currentValue - delta, 0, share));

    const nextSettledAmounts: SettledAmounts = {
      ...currentSettledAmounts,
      [entry.debtorUserId]: nextValue,
    };

    if (nextValue <= 0.0001) {
      delete nextSettledAmounts[entry.debtorUserId];
    }

    const normalizedSettledAmounts = normalizeSettledAmounts(nextSettledAmounts, paidBy, participants, amount);
    const nextSettled = areAllDebtorsSettled(normalizedSettledAmounts, paidBy, participants, amount);
    const nextSettledBy = getFullySettledDebtors(normalizedSettledAmounts, paidBy, participants, amount);

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Expenses!H${rowIndex}:J${rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[String(nextSettled), JSON.stringify(nextSettledBy), JSON.stringify(normalizedSettledAmounts)]],
      },
    });

    results.push({
      id: entry.id,
      debtorUserId: entry.debtorUserId,
      settledAmount: normalizedSettledAmounts[entry.debtorUserId] ?? 0,
    });
  }

  return results;
}


export async function toggleDebtSettled(id: string, debtorUserId: string) {
  const allExpenses = await getExpenses();
  const expense = allExpenses.find((item) => item.id === id);

  if (!expense) {
    throw new Error('Expense not found');
  }

  const share = getParticipantShare(expense.amount, expense.participants, debtorUserId);
  if (share <= 0.0001) {
    throw new Error('Debt entry not found for debtor');
  }

  const currentSettledAmount = round2(Number(expense.settledAmounts?.[debtorUserId] ?? 0));
  const action = currentSettledAmount >= share - 0.005 ? 'unsettle' : 'settle';

  const results = await applyDebtSettlements([
    { id, debtorUserId, amount: share },
  ], action);

  return {
    settled: action === 'settle',
    settledAmount: results[0]?.settledAmount ?? 0,
    debtorUserId,
    id,
  };
}

// ── MIGRATION ──────────────────────────────────────────────────────────────
export async function migrateExpensesToEvent(eventId: string) {
  const sheets = await getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Expenses!A2:K',
  });

  const rows = response.data.values || [];
  const updates: { range: string; values: string[][] }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row[10]) {
      const rowIndex = i + 2;
      updates.push({ range: `Expenses!K${rowIndex}`, values: [[eventId]] });
    }
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'RAW', data: updates },
    });
  }

  return updates.length;
}
