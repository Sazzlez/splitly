import React, { useEffect, useState, useCallback, useMemo } from 'react';
import Head from 'next/head';

// ─── Types ────────────────────────────────────────────────────────────────────
interface User { id: string; name: string; }
interface Participant { userId: string; percent: number; }
interface Expense {
  id: string;
  description: string;
  amount: number;
  paidBy: string;
  date: string;
  participants: Participant[];
  createdBy: string;
  settled: boolean;
  settledBy: string[];
  settledAmounts: Record<string, number>;
}

interface DebtLine {
  key: string;
  expenseId: string;
  description: string;
  date: string;
  from: string;
  to: string;
  amount: number;
  settledAmount: number;
  openAmount: number;
}

interface DebtPair {
  pairId: string;
  userA: string;
  userB: string;
  openAToB: number;
  openBToA: number;
  latestDate: string;
  openLines: DebtLine[];
  netAmount: number;
  netFrom: string | null;
  netTo: string | null;
}

interface SettlementPlanEntry {
  expenseId: string;
  debtorUserId: string;
  amount: number;
}

// ─── API ──────────────────────────────────────────────────────────────────────
const api = async (path: string, opts?: RequestInit, token?: string) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(path, { ...opts, headers: { ...headers, ...(opts?.headers || {}) } });
  return response.json();
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) => n.toFixed(2).replace('.', ',') + ' €';
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('de-DE', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

function buildDebtPairs(expenses: Expense[]) {
  const pairMap: Record<string, {
    userA: string;
    userB: string;
    openLines: DebtLine[];
    latestDate: string;
  }> = {};

  expenses.forEach((expense) => {
    expense.participants.forEach((participant) => {
      if (participant.userId === expense.paidBy) return;

      const amount = (expense.amount * participant.percent) / 100;
      if (amount <= 0.005) return;

      const settledAmount = Math.min(
        Math.max(expense.settledAmounts?.[participant.userId] ?? 0, 0),
        amount,
      );
      const openAmount = Math.max(0, amount - settledAmount);
      if (openAmount <= 0.005) return;

      const [userA, userB] = [participant.userId, expense.paidBy].sort();
      const pairId = `${userA}__${userB}`;

      if (!pairMap[pairId]) {
        pairMap[pairId] = {
          userA,
          userB,
          openLines: [],
          latestDate: expense.date,
        };
      }

      if (new Date(expense.date).getTime() > new Date(pairMap[pairId].latestDate).getTime()) {
        pairMap[pairId].latestDate = expense.date;
      }

      pairMap[pairId].openLines.push({
        key: `${expense.id}__${participant.userId}`,
        expenseId: expense.id,
        description: expense.description,
        date: expense.date,
        from: participant.userId,
        to: expense.paidBy,
        amount,
        settledAmount,
        openAmount,
      });
    });
  });

  return Object.entries(pairMap)
    .map(([pairId, pair]) => {
      const openAToB = pair.openLines
        .filter((line) => line.from === pair.userA && line.to === pair.userB)
        .reduce((sum, line) => sum + line.openAmount, 0);

      const openBToA = pair.openLines
        .filter((line) => line.from === pair.userB && line.to === pair.userA)
        .reduce((sum, line) => sum + line.openAmount, 0);

      const delta = openAToB - openBToA;
      const netAmount = Math.abs(delta) > 0.005 ? Math.abs(delta) : 0;
      const netFrom = delta > 0.005 ? pair.userA : delta < -0.005 ? pair.userB : null;
      const netTo = delta > 0.005 ? pair.userB : delta < -0.005 ? pair.userA : null;

      return {
        pairId,
        userA: pair.userA,
        userB: pair.userB,
        openAToB,
        openBToA,
        latestDate: pair.latestDate,
        openLines: [...pair.openLines].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
        netAmount,
        netFrom,
        netTo,
      } satisfies DebtPair;
    })
    .filter((pair) => pair.netAmount > 0.005)
    .sort((a, b) => {
      const amountDiff = b.netAmount - a.netAmount;
      if (Math.abs(amountDiff) > 0.005) return amountDiff;
      return new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime();
    });
}

function buildSettlementPlan(pair: DebtPair): SettlementPlanEntry[] {
  if (!pair.netFrom || !pair.netTo || pair.netAmount <= 0.005) return [];

  let remaining = pair.netAmount;
  const plan: SettlementPlanEntry[] = [];

  const candidateLines = pair.openLines
    .filter((line) => line.from === pair.netFrom && line.to === pair.netTo && line.openAmount > 0.005)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  for (const line of candidateLines) {
    if (remaining <= 0.005) break;

    const amountToSettle = Math.min(line.openAmount, remaining);
    if (amountToSettle <= 0.005) continue;

    plan.push({
      expenseId: line.expenseId,
      debtorUserId: line.from,
      amount: parseFloat(amountToSettle.toFixed(2)),
    });

    remaining -= amountToSettle;
  }

  return remaining <= 0.02 ? plan : [];
}

// ─── Shared UI ────────────────────────────────────────────────────────────────
function Input({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
        {label}
      </label>
      <input
        {...props}
        style={{
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          color: 'var(--text)',
          padding: '12px 14px',
          fontSize: 16,
          outline: 'none',
          width: '100%',
          transition: 'border-color .2s, box-shadow .2s',
          ...props.style,
        }}
        onFocus={(e) => {
          e.target.style.borderColor = 'var(--accent)';
          e.target.style.boxShadow = '0 0 0 3px rgba(110,231,183,0.12)';
        }}
        onBlur={(e) => {
          e.target.style.borderColor = 'var(--border)';
          e.target.style.boxShadow = 'none';
        }}
      />
    </div>
  );
}

function Btn({ children, variant = 'primary', size = 'md', ...props }: {
  children: React.ReactNode;
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--accent)', color: '#08110d', fontWeight: 700 },
    ghost: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' },
    danger: { background: 'rgba(248,113,113,0.18)', color: '#ffd3d3', border: '1px solid rgba(248,113,113,0.35)' },
  };
  const sizes: Record<string, React.CSSProperties> = {
    sm: { padding: '7px 12px', fontSize: 13, borderRadius: 8 },
    md: { padding: '12px 20px', fontSize: 14, borderRadius: 10 },
  };

  return (
    <button
      {...props}
      style={{
        border: 'none',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        transition: 'opacity .15s, transform .1s',
        opacity: props.disabled ? 0.65 : 1,
        ...styles[variant],
        ...sizes[size],
        ...props.style,
      }}
      onMouseEnter={(e) => {
        if (!props.disabled) e.currentTarget.style.opacity = '0.88';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = props.disabled ? '0.65' : '1';
      }}
      onMouseDown={(e) => {
        if (!props.disabled) e.currentTarget.style.transform = 'scale(0.98)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      {children}
    </button>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: 20,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Select({ label, value, onChange, children }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          color: 'var(--text)',
          padding: '12px 14px',
          fontSize: 16,
          outline: 'none',
          width: '100%',
        }}
      >
        {children}
      </select>
    </div>
  );
}

// ─── Participant editor (shared by add & edit) ────────────────────────────────
function ParticipantEditor({ users, participants, setParticipants, amount }: {
  users: User[];
  participants: Participant[];
  setParticipants: (p: Participant[]) => void;
  amount: string;
}) {
  const totalPercent = participants.reduce((sum, participant) => sum + participant.percent, 0);

  const toggleUser = (userId: string) => {
    const active = participants.filter((participant) => participant.percent > 0);
    const isActive = active.some((participant) => participant.userId === userId);

    if (isActive && active.length === 1) return;

    const nextActive = isActive
      ? active.filter((participant) => participant.userId !== userId).map((participant) => participant.userId)
      : [...active.map((participant) => participant.userId), userId];

    const equalShare = parseFloat((100 / nextActive.length).toFixed(4));

    setParticipants(
      users.map((user) => ({
        userId: user.id,
        percent: nextActive.includes(user.id) ? equalShare : 0,
      }))
    );
  };

  const setPercent = (userId: string, value: number) => {
    setParticipants(
      participants.map((participant) => (
        participant.userId === userId ? { ...participant, percent: value } : participant
      ))
    );
  };

  const distribute = () => {
    const active = participants.filter((participant) => participant.percent > 0);
    if (!active.length) return;

    const equalShare = parseFloat((100 / active.length).toFixed(4));

    setParticipants(
      participants.map((participant) => ({
        ...participant,
        percent: participant.percent > 0 ? equalShare : 0,
      }))
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Aufteilen auf</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontSize: 12,
              color: Math.abs(totalPercent - 100) > 0.1 ? 'var(--danger)' : 'var(--accent)',
              fontFamily: 'DM Mono',
              fontWeight: 600,
            }}
          >
            {totalPercent.toFixed(1)}%
          </span>
          <button
            onClick={distribute}
            style={{
              fontSize: 12,
              color: 'var(--text)',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '5px 8px',
              cursor: 'pointer',
            }}
          >
            Gleichmäßig
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {users.map((user) => {
          const participant = participants.find((item) => item.userId === user.id);
          const isActive = (participant?.percent ?? 0) > 0;

          return (
            <div key={user.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={() => toggleUser(user.id)}
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  border: `2px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                  background: isActive ? 'var(--accent)' : 'transparent',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {isActive && <span style={{ color: '#08110d', fontSize: 12, fontWeight: 800 }}>✓</span>}
              </button>

              <span style={{ flex: 1, fontSize: 14, color: isActive ? 'var(--text)' : 'var(--muted)' }}>
                {user.name}
              </span>

              {isActive && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={participant?.percent.toFixed(1) ?? '0'}
                    onChange={(e) => setPercent(user.id, parseFloat(e.target.value) || 0)}
                    style={{
                      width: 72,
                      background: 'var(--surface2)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      color: 'var(--text)',
                      padding: '6px 8px',
                      fontSize: 16,
                      outline: 'none',
                      textAlign: 'right',
                      fontFamily: 'DM Mono',
                    }}
                  />
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>%</span>

                  {amount && (
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--muted)',
                        fontFamily: 'DM Mono',
                        minWidth: 72,
                        textAlign: 'right',
                      }}
                    >
                      {fmt(parseFloat(amount.replace(',', '.') || '0') * (participant?.percent ?? 0) / 100)}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [selectedId, setSelectedId] = useState('');
  const [password, setPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newPw, setNewPw] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api('/api/users').then(setUsers).catch(() => {});
  }, []);

  const handleLogin = async () => {
    if (!selectedId || !password) {
      setError('Bitte Benutzer und Passwort wählen.');
      return;
    }

    setLoading(true);
    setError('');

    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ userId: selectedId, password }),
    });

    setLoading(false);

    if (data.error) {
      setError(data.error);
      return;
    }

    onLogin(data.token, data.user);
  };

  const handleRegister = async () => {
    if (!newName || !newPw) {
      setError('Name und Passwort erforderlich.');
      return;
    }

    setLoading(true);
    setError('');

    const data = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({ name: newName, password: newPw }),
    });

    setLoading(false);

    if (data.error) {
      setError(data.error);
      return;
    }

    onLogin(data.token, data.user);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: 'var(--accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                color: '#08110d',
                fontWeight: 800,
              }}
            >
              ÷
            </div>
            <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.03em' }}>splitly</span>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>Ausgaben fair aufteilen</p>
        </div>

        <Card>
          <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--surface2)', borderRadius: 10, padding: 4 }}>
            {(['login', 'register'] as const).map((nextMode) => (
              <button
                key={nextMode}
                onClick={() => {
                  setMode(nextMode);
                  setError('');
                }}
                style={{
                  flex: 1,
                  padding: '10px 8px',
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                  background: mode === nextMode ? 'var(--accent)' : 'transparent',
                  color: mode === nextMode ? '#08110d' : 'var(--text)',
                  fontWeight: mode === nextMode ? 700 : 500,
                  fontSize: 14,
                  transition: 'all .2s',
                  fontFamily: 'DM Sans',
                }}
              >
                {nextMode === 'login' ? 'Anmelden' : 'Registrieren'}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {mode === 'login' ? (
              <>
                <Select label="Benutzer" value={selectedId} onChange={setSelectedId}>
                  <option value="">— Benutzer wählen —</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                </Select>

                <Input
                  label="Passwort"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                />

                {error && <p style={{ color: 'var(--danger)', fontSize: 14, fontWeight: 600 }}>{error}</p>}

                <Btn onClick={handleLogin} disabled={loading} style={{ width: '100%', marginTop: 4 }}>
                  {loading ? 'Lädt…' : 'Anmelden →'}
                </Btn>
              </>
            ) : (
              <>
                <Input label="Dein Name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="z.B. Max" />
                <Input
                  label="Passwort"
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
                />

                {error && <p style={{ color: 'var(--danger)', fontSize: 14, fontWeight: 600 }}>{error}</p>}

                <Btn onClick={handleRegister} disabled={loading} style={{ width: '100%', marginTop: 4 }}>
                  {loading ? 'Lädt…' : 'Konto erstellen →'}
                </Btn>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── ADD EXPENSE TAB ──────────────────────────────────────────────────────────
function AddExpenseTab({ users, currentUser, token, onAdded }: {
  users: User[];
  currentUser: User;
  token: string;
  onAdded: () => void;
}) {
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState(currentUser.id);
  const [participants, setParticipants] = useState<Participant[]>(() =>
    users.map((user) => ({ userId: user.id, percent: 100 / users.length }))
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!desc.trim()) {
      setError('Beschreibung fehlt.');
      return;
    }

    const amountNumber = parseFloat(amount.replace(',', '.'));

    if (!amountNumber || amountNumber <= 0) {
      setError('Ungültiger Betrag.');
      return;
    }

    const totalPercent = participants.reduce((sum, participant) => sum + participant.percent, 0);

    if (Math.abs(totalPercent - 100) > 0.1) {
      setError(`Prozentsumme ist ${totalPercent.toFixed(1)}% (muss 100% sein).`);
      return;
    }

    setLoading(true);
    setError('');

    const data = await api('/api/expenses', {
      method: 'POST',
      body: JSON.stringify({
        description: desc,
        amount: amountNumber,
        paidBy,
        participants: participants.filter((participant) => participant.percent > 0),
      }),
    }, token);

    setLoading(false);

    if (data.error) {
      setError(data.error);
      return;
    }

    setDesc('');
    setAmount('');
    setPaidBy(currentUser.id);
    setParticipants(users.map((user) => ({ userId: user.id, percent: 100 / users.length })));
    setSuccess(true);
    setTimeout(() => setSuccess(false), 2500);
    onAdded();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>Ausgabe hinzufügen</h2>

      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input label="Beschreibung" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="z.B. Abendessen" />
          <Input label="Betrag (€)" type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
          <Select label="Bezahlt von" value={paidBy} onChange={setPaidBy}>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}{user.id === currentUser.id ? ' (du)' : ''}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <Card>
        <ParticipantEditor users={users} participants={participants} setParticipants={setParticipants} amount={amount} />
      </Card>

      {error && <p style={{ color: 'var(--danger)', fontSize: 14, fontWeight: 600 }}>{error}</p>}
      {success && <p style={{ color: 'var(--accent)', fontSize: 14, fontWeight: 600 }}>✓ Ausgabe gespeichert!</p>}

      <Btn onClick={handleSubmit} disabled={loading} style={{ width: '100%' }}>
        {loading ? 'Speichert…' : 'Ausgabe speichern'}
      </Btn>
    </div>
  );
}

// ─── EDIT MODAL ───────────────────────────────────────────────────────────────
function EditModal({ expense, users, token, onClose, onSaved }: {
  expense: Expense;
  users: User[];
  token: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [desc, setDesc] = useState(expense.description);
  const [amount, setAmount] = useState(String(expense.amount));
  const [paidBy, setPaidBy] = useState(expense.paidBy);
  const [participants, setParticipants] = useState<Participant[]>(() =>
    users.map((user) => {
      const existing = expense.participants.find((participant) => participant.userId === user.id);
      return { userId: user.id, percent: existing?.percent ?? 0 };
    })
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!desc.trim()) {
      setError('Beschreibung fehlt.');
      return;
    }

    const amountNumber = parseFloat(amount.replace(',', '.'));

    if (!amountNumber || amountNumber <= 0) {
      setError('Ungültiger Betrag.');
      return;
    }

    const totalPercent = participants.reduce((sum, participant) => sum + participant.percent, 0);

    if (Math.abs(totalPercent - 100) > 0.1) {
      setError(`Prozentsumme ist ${totalPercent.toFixed(1)}%`);
      return;
    }

    setLoading(true);
    setError('');

    const data = await api('/api/expenses', {
      method: 'PUT',
      body: JSON.stringify({
        id: expense.id,
        description: desc,
        amount: amountNumber,
        paidBy,
        participants: participants.filter((participant) => participant.percent > 0),
      }),
    }, token);

    setLoading(false);

    if (data.error) {
      setError(data.error);
      return;
    }

    onSaved();
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'var(--surface)',
          borderRadius: '20px 20px 0 0',
          width: '100%',
          maxWidth: 480,
          padding: '24px 20px 32px',
          maxHeight: '90vh',
          overflowY: 'auto',
          borderTop: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700 }}>Ausgabe bearbeiten</h3>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text)',
              fontSize: 20,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input label="Beschreibung" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <Input label="Betrag (€)" type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Select label="Bezahlt von" value={paidBy} onChange={setPaidBy}>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </Select>

          <div style={{ background: 'var(--surface2)', borderRadius: 12, padding: 16 }}>
            <ParticipantEditor users={users} participants={participants} setParticipants={setParticipants} amount={amount} />
          </div>

          {error && <p style={{ color: 'var(--danger)', fontSize: 14, fontWeight: 600 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 10 }}>
            <Btn variant="ghost" onClick={onClose} style={{ flex: 1 }}>Abbrechen</Btn>
            <Btn onClick={handleSave} disabled={loading} style={{ flex: 2 }}>
              {loading ? 'Speichert…' : 'Änderungen speichern'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ACTIVITY TAB ─────────────────────────────────────────────────────────────
function ActivityTab({ expenses, users, currentUser, token, onRefresh }: {
  expenses: Expense[];
  users: User[];
  currentUser: User;
  token: string;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState('all');
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadingDelete, setLoadingDelete] = useState(false);

  const getName = (id: string) => users.find((user) => user.id === id)?.name || id;

  const filteredExpenses = [...expenses]
    .filter((expense) => filter === 'all' || expense.paidBy === filter)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const handleDelete = async (id: string) => {
    setLoadingDelete(true);

    const data = await api('/api/expenses', {
      method: 'DELETE',
      body: JSON.stringify({ id }),
    }, token);

    setLoadingDelete(false);
    setDeletingId(null);

    if (!data.error) onRefresh();
  };

  if (!expenses.length) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
        <p>Noch keine Ausgaben</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {editingExpense && (
        <EditModal
          expense={editingExpense}
          users={users}
          token={token}
          onClose={() => setEditingExpense(null)}
          onSaved={onRefresh}
        />
      )}

      {deletingId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: 20,
          }}
        >
          <Card style={{ maxWidth: 320, width: '100%', textAlign: 'center' }}>
            <p style={{ fontWeight: 700, marginBottom: 8 }}>Ausgabe löschen?</p>
            <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20 }}>
              Diese Aktion kann nicht rückgängig gemacht werden.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn variant="ghost" onClick={() => setDeletingId(null)} style={{ flex: 1 }}>Abbrechen</Btn>
              <Btn
                variant="danger"
                onClick={() => handleDelete(deletingId)}
                disabled={loadingDelete}
                style={{ flex: 1 }}
              >
                {loadingDelete ? '…' : 'Löschen'}
              </Btn>
            </div>
          </Card>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Aktivität</h2>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            color: 'var(--text)',
            padding: '8px 10px',
            fontSize: 16,
            outline: 'none',
            cursor: 'pointer',
            maxWidth: 180,
          }}
        >
          <option value="all">Alle Benutzer</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>{user.name}</option>
          ))}
        </select>
      </div>

      <p style={{ fontSize: 13, color: 'var(--muted)' }}>
        Bearbeiten und Löschen ist nur für die Person möglich, die die Ausgabe bezahlt hat.
      </p>

      {filteredExpenses.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)' }}>
          Keine Ausgaben für diesen Filter
        </div>
      )}

      {filteredExpenses.map((expense) => {
        const canManage = expense.paidBy === currentUser.id;

        return (
          <Card key={expense.id} style={{ position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    fontWeight: 700,
                    fontSize: 15,
                    marginBottom: 4,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {expense.description}
                </p>

                <p style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {getName(expense.paidBy)} hat bezahlt · {fmtDate(expense.date)}
                </p>

                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {expense.participants.map((participant) => (
                    <span
                      key={participant.userId}
                      style={{
                        fontSize: 12,
                        background: 'var(--surface2)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '3px 7px',
                        color: 'var(--text)',
                      }}
                    >
                      {getName(participant.userId)} {participant.percent.toFixed(0)}%
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ fontWeight: 700, fontSize: 16, fontFamily: 'DM Mono', color: 'var(--accent)' }}>
                  {fmt(expense.amount)}
                </p>

                {canManage && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                    <Btn variant="ghost" size="sm" onClick={() => setEditingExpense(expense)}>✏️</Btn>
                    <Btn variant="danger" size="sm" onClick={() => setDeletingId(expense.id)}>🗑</Btn>
                  </div>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ─── DEBT DETAIL MODAL ────────────────────────────────────────────────────────
function DebtDetailModal({ pair, users, currentUser, token, onClose, onRefresh }: {
  pair: DebtPair;
  users: User[];
  currentUser: User;
  token: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const getName = (id: string) => users.find((user) => user.id === id)?.name || id;
  const settlementPlan = buildSettlementPlan(pair);
  const canSettleNetDebt = pair.netTo === currentUser.id && settlementPlan.length > 0;

  const handleSettleNetDebt = async () => {
    if (!canSettleNetDebt) return;

    setLoading(true);

    const data = await api('/api/settled', {
      method: 'POST',
      body: JSON.stringify({ settlements: settlementPlan }),
    }, token);

    setLoading(false);

    if (!data.error) {
      onRefresh();
      onClose();
    }
  };

  const showNetting = pair.openAToB > 0.005 && pair.openBToA > 0.005;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 120,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'var(--surface)',
          borderRadius: '20px 20px 0 0',
          width: '100%',
          maxWidth: 520,
          padding: '24px 20px 32px',
          maxHeight: '92vh',
          overflowY: 'auto',
          borderTop: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div>
            <h3 style={{ fontSize: 18, fontWeight: 700 }}>Verrechnung</h3>
            <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>
              Hier siehst du nur den verrechneten Restbetrag zwischen beiden Personen.
            </p>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text)',
              fontSize: 20,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        <Card style={{ marginBottom: 16, padding: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: 'var(--muted)' }}>{getName(pair.userA)} → {getName(pair.userB)}</span>
              <span style={{ fontFamily: 'DM Mono', fontWeight: 700, color: pair.openAToB > 0 ? 'var(--text)' : 'var(--muted)' }}>
                {fmt(pair.openAToB)}
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: 'var(--muted)' }}>{getName(pair.userB)} → {getName(pair.userA)}</span>
              <span style={{ fontFamily: 'DM Mono', fontWeight: 700, color: pair.openBToA > 0 ? 'var(--text)' : 'var(--muted)' }}>
                {fmt(pair.openBToA)}
              </span>
            </div>

            <div
              style={{
                marginTop: 4,
                paddingTop: 12,
                borderTop: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                alignItems: 'flex-start',
              }}
            >
              <div>
                <p style={{ color: 'var(--text)', fontWeight: 700, marginBottom: 4 }}>Rest nach Verrechnung</p>
                {pair.netFrom && pair.netTo ? (
                  <p style={{ color: 'var(--muted)', fontSize: 14 }}>
                    {getName(pair.netFrom)} schuldet {getName(pair.netTo)} noch {fmt(pair.netAmount)}.
                  </p>
                ) : (
                  <p style={{ color: 'var(--muted)', fontSize: 14 }}>Es bleibt nichts mehr offen.</p>
                )}
              </div>

              <span style={{ fontFamily: 'DM Mono', fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                {fmt(pair.netAmount)}
              </span>
            </div>
          </div>
        </Card>

        {showNetting && (
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
            Die gegenseitigen Beträge wurden automatisch gegeneinander verrechnet. Markiert wird nur der verbleibende Restbetrag.
          </p>
        )}

        {canSettleNetDebt ? (
          <button
            onClick={handleSettleNetDebt}
            disabled={loading}
            style={{
              width: '100%',
              border: 'none',
              borderRadius: 14,
              padding: '16px 18px',
              background: 'var(--accent)',
              color: '#08110d',
              fontSize: 15,
              fontWeight: 800,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              boxShadow: '0 10px 30px rgba(110,231,183,0.18)',
              opacity: loading ? 0.7 : 1,
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>✓</span>
            <span>{loading ? 'Wird gespeichert…' : `Restschuld als beglichen markieren (${fmt(pair.netAmount)})`}</span>
          </button>
        ) : pair.netTo === currentUser.id ? (
          <Card style={{ padding: 14 }}>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>
              Dazu habe ich keine saubere Buchungsgrundlage gefunden. In diesem Fall brauche ich eine kurze technische Nachschärfung.
            </p>
          </Card>
        ) : (
          <Card style={{ padding: 14 }}>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>
              Nur {pair.netTo ? getName(pair.netTo) : 'der Gläubiger'} kann diesen Restbetrag als beglichen markieren.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

// ─── DEBTS TAB ────────────────────────────────────────────────────────────────
function DebtsTab({ expenses, users, currentUser, token, onRefresh }: {
  expenses: Expense[];
  users: User[];
  currentUser: User;
  token: string;
  onRefresh: () => void;
}) {
  const [selectedPair, setSelectedPair] = useState<DebtPair | null>(null);

  const getName = (id: string) => users.find((user) => user.id === id)?.name || id;
  const debtPairs = useMemo(() => buildDebtPairs(expenses), [expenses]);

  const openPairs = debtPairs.filter((pair) => pair.netAmount > 0.005);

  const myDebts = openPairs.filter((pair) => pair.netFrom === currentUser.id);
  const owedToMe = openPairs.filter((pair) => pair.netTo === currentUser.id);
  const otherDebts = openPairs.filter((pair) => pair.netFrom !== currentUser.id && pair.netTo !== currentUser.id);

  const PairRow = ({ pair, emphasize }: { pair: DebtPair; emphasize: 'danger' | 'accent' | 'neutral' }) => {
    const hasNetting = pair.openAToB > 0.005 && pair.openBToA > 0.005;
    const counterpartId = pair.netFrom === currentUser.id ? pair.netTo : pair.netTo === currentUser.id ? pair.netFrom : null;
    const accentColor =
      emphasize === 'danger' ? 'var(--danger)' :
      emphasize === 'accent' ? 'var(--accent)' :
      'var(--text)';

    return (
      <button
        onClick={() => setSelectedPair(pair)}
        style={{
          borderRadius: 12,
          background: 'var(--surface2)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          padding: '14px 16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                {pair.netFrom ? getName(pair.netFrom) : getName(pair.userA)}
              </span>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>→</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                {pair.netTo ? getName(pair.netTo) : getName(pair.userB)}
              </span>

              {counterpartId && (
                <span
                  style={{
                    fontSize: 11,
                    background: 'rgba(110,231,183,0.12)',
                    color: accentColor,
                    borderRadius: 999,
                    padding: '2px 8px',
                    fontWeight: 700,
                  }}
                >
                  {counterpartId === currentUser.id ? 'du' : getName(counterpartId)}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
              {hasNetting ? (
                <>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    Verrechnung: {fmt(pair.openAToB)} ↔ {fmt(pair.openBToA)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>Tippen für Details</span>
                </>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Tippen für Details</span>
              )}
            </div>
          </div>

          <span style={{ fontFamily: 'DM Mono', fontWeight: 700, fontSize: 16, color: accentColor, flexShrink: 0 }}>
            {fmt(pair.netAmount)}
          </span>
        </div>
      </button>
    );
  };

  if (!openPairs.length) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
        <p>Alles ausgeglichen!</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {selectedPair && (
        <DebtDetailModal
          pair={selectedPair}
          users={users}
          currentUser={currentUser}
          token={token}
          onClose={() => setSelectedPair(null)}
          onRefresh={onRefresh}
        />
      )}

      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Schulden</h2>
        <p style={{ fontSize: 13, color: 'var(--muted)' }}>
          Gegenseitige Schulden werden automatisch verrechnet. Tippe auf einen Eintrag für die genaue Herleitung.
        </p>
      </div>

      {myDebts.length > 0 && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 8 }}>
            Du schuldest
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {myDebts.map((pair) => (
              <PairRow key={pair.pairId} pair={pair} emphasize="danger" />
            ))}
          </div>
        </div>
      )}

      {owedToMe.length > 0 && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 8 }}>
            Dir wird geschuldet
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {owedToMe.map((pair) => (
              <PairRow key={pair.pairId} pair={pair} emphasize="accent" />
            ))}
          </div>
        </div>
      )}

      {otherDebts.length > 0 && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 8 }}>
            Alle weiteren Schulden
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {otherDebts.map((pair) => (
              <PairRow key={pair.pairId} pair={pair} emphasize="neutral" />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [tab, setTab] = useState<'add' | 'activity' | 'debts'>('add');
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');

    if (storedToken && storedUser) {
      setToken(storedToken);
      setCurrentUser(JSON.parse(storedUser));
    }
  }, []);

  const loadData = useCallback(async (currentToken: string) => {
    setLoadingData(true);

    const [loadedUsers, loadedExpenses] = await Promise.all([
      api('/api/users'),
      api('/api/expenses', undefined, currentToken),
    ]);

    if (Array.isArray(loadedUsers)) setUsers(loadedUsers);
    if (Array.isArray(loadedExpenses)) setExpenses(loadedExpenses);

    setLoadingData(false);
  }, []);

  useEffect(() => {
    if (token) loadData(token);
  }, [token, loadData]);

  const handleLogin = (nextToken: string, user: User) => {
    localStorage.setItem('token', nextToken);
    localStorage.setItem('user', JSON.stringify(user));
    setToken(nextToken);
    setCurrentUser(user);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setCurrentUser(null);
    setUsers([]);
    setExpenses([]);
  };

  const tabs = [
    { id: 'add' as const, label: 'Ausgabe', icon: '+' },
    { id: 'activity' as const, label: 'Aktivität', icon: '≡' },
    { id: 'debts' as const, label: 'Schulden', icon: '⇄' },
  ];

  if (!token || !currentUser) {
    return (
      <>
        <Head><title>Splitly</title></Head>
        <LoginScreen onLogin={handleLogin} />
      </>
    );
  }

  return (
    <>
      <Head><title>Splitly</title></Head>

      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(15,15,16,0.92)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              fontWeight: 800,
              color: '#08110d',
            }}
          >
            ÷
          </div>
          <span style={{ fontWeight: 700, letterSpacing: '-0.02em' }}>splitly</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--text)' }}>Hi, {currentUser.name}</span>
          <button
            onClick={handleLogout}
            style={{
              fontSize: 12,
              color: 'var(--text)',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 7,
              padding: '6px 10px',
              cursor: 'pointer',
              fontFamily: 'DM Sans',
              fontWeight: 600,
            }}
          >
            Logout
          </button>
        </div>
      </div>

      <div style={{ paddingTop: 72, paddingBottom: 86 }}>
        <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px' }}>
          {loadingData ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>Lädt…</div>
          ) : tab === 'add' ? (
            <AddExpenseTab
              users={users}
              currentUser={currentUser}
              token={token}
              onAdded={() => loadData(token)}
            />
          ) : tab === 'activity' ? (
            <ActivityTab
              expenses={expenses}
              users={users}
              currentUser={currentUser}
              token={token}
              onRefresh={() => loadData(token)}
            />
          ) : (
            <DebtsTab
              expenses={expenses}
              users={users}
              currentUser={currentUser}
              token={token}
              onRefresh={() => loadData(token)}
            />
          )}
        </div>
      </div>

      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 20,
          background: 'rgba(24,24,27,0.96)',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          padding: '8px 8px 20px',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div style={{ display: 'flex', width: '100%', maxWidth: 480, margin: '0 auto' }}>
          {tabs.map((entry) => (
            <button
              key={entry.id}
              onClick={() => setTab(entry.id)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 3,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '8px 4px',
                borderRadius: 10,
                transition: 'background .15s',
                fontFamily: 'DM Sans',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface2)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 16, color: tab === entry.id ? 'var(--accent)' : 'var(--text)' }}>{entry.icon}</span>
              <span style={{ fontSize: 11, fontWeight: tab === entry.id ? 700 : 500, color: tab === entry.id ? 'var(--accent)' : 'var(--text)' }}>
                {entry.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
