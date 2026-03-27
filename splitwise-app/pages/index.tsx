import { useEffect, useState, useCallback } from 'react';
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
}

// ─── API ──────────────────────────────────────────────────────────────────────
const api = async (path: string, opts?: RequestInit, token?: string) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(path, { ...opts, headers: { ...headers, ...(opts?.headers || {}) } });
  return r.json();
};

// ─── Debt calc ────────────────────────────────────────────────────────────────
function calcDebts(expenses: Expense[], users: User[]) {
  const owedTo: Record<string, Record<string, number>> = {};
  users.forEach(u => { owedTo[u.id] = {}; users.forEach(v => { owedTo[u.id][v.id] = 0; }); });
  expenses.forEach(exp => {
    exp.participants.forEach(p => {
      if (p.userId === exp.paidBy) return;
      const share = (exp.amount * p.percent) / 100;
      owedTo[exp.paidBy][p.userId] = (owedTo[exp.paidBy][p.userId] || 0) + share;
    });
  });
  const result: { expenseId: string; from: string; to: string; amount: number }[] = [];
  // Per expense debt tracking for settled state
  expenses.forEach(exp => {
    exp.participants.forEach(p => {
      if (p.userId === exp.paidBy) return;
      const share = (exp.amount * p.percent) / 100;
      result.push({ expenseId: exp.id, from: p.userId, to: exp.paidBy, amount: share });
    });
  });
  return result;
}

function calcNetDebts(expenses: Expense[], users: User[]) {
  const owedTo: Record<string, Record<string, number>> = {};
  users.forEach(u => { owedTo[u.id] = {}; users.forEach(v => { owedTo[u.id][v.id] = 0; }); });
  expenses.forEach(exp => {
    exp.participants.forEach(p => {
      if (p.userId === exp.paidBy) return;
      const share = (exp.amount * p.percent) / 100;
      owedTo[exp.paidBy][p.userId] = (owedTo[exp.paidBy][p.userId] || 0) + share;
    });
  });
  const result: { from: string; to: string; amount: number; settled: boolean }[] = [];
  users.forEach(creditor => {
    users.forEach(debtor => {
      if (creditor.id === debtor.id) return;
      const net = owedTo[creditor.id][debtor.id] - owedTo[debtor.id][creditor.id];
      if (net > 0.005) result.push({ from: debtor.id, to: creditor.id, amount: net, settled: false });
    });
  });
  return result.filter(d => d.amount > 0.005);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) => n.toFixed(2).replace('.', ',') + ' €';
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });

// ─── Shared UI ────────────────────────────────────────────────────────────────
function Input({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>{label}</label>
      <input {...props} style={{
        background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10,
        color: 'var(--text)', padding: '10px 14px', fontSize: 15, outline: 'none', width: '100%',
        transition: 'border-color .2s', ...props.style,
      }}
        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
        onBlur={e => e.target.style.borderColor = 'var(--border)'}
      />
    </div>
  );
}

function Btn({ children, variant = 'primary', size = 'md', ...props }: {
  children: React.ReactNode; variant?: 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--accent)', color: '#0f0f10', fontWeight: 600 },
    ghost: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' },
    danger: { background: 'rgba(248,113,113,0.15)', color: 'var(--danger)', border: '1px solid rgba(248,113,113,0.3)' },
  };
  const sizes: Record<string, React.CSSProperties> = {
    sm: { padding: '6px 12px', fontSize: 12, borderRadius: 8 },
    md: { padding: '11px 20px', fontSize: 14, borderRadius: 10 },
  };
  return (
    <button {...props} style={{
      border: 'none', cursor: 'pointer', transition: 'opacity .15s, transform .1s',
      ...styles[variant], ...sizes[size], ...props.style,
    }}
      onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
      onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
      onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.97)')}
      onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
    >{children}</button>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, ...style }}>{children}</div>;
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} style={{
        background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10,
        color: 'var(--text)', padding: '10px 14px', fontSize: 15, outline: 'none', width: '100%',
      }}>
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
  const totalPercent = participants.reduce((s, p) => s + p.percent, 0);

  const toggleUser = (userId: string) => {
    const active = participants.filter(p => p.percent > 0);
    const isActive = !!active.find(p => p.userId === userId);
    if (isActive && active.length === 1) return;
    let newActive: string[];
    if (isActive) {
      newActive = active.filter(p => p.userId !== userId).map(p => p.userId);
    } else {
      newActive = [...active.map(p => p.userId), userId];
    }
    const eq = parseFloat((100 / newActive.length).toFixed(4));
    setParticipants(users.map(u => ({ userId: u.id, percent: newActive.includes(u.id) ? eq : 0 })));
  };

  const setPercent = (userId: string, val: number) => {
    setParticipants(participants.map(p => p.userId === userId ? { ...p, percent: val } : p));
  };

  const distribute = () => {
    const active = participants.filter(p => p.percent > 0);
    if (!active.length) return;
    const eq = parseFloat((100 / active.length).toFixed(4));
    setParticipants(participants.map(p => ({ ...p, percent: p.percent > 0 ? eq : 0 })));
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>Aufteilen auf</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: Math.abs(totalPercent - 100) > 0.1 ? 'var(--danger)' : 'var(--accent)', fontFamily: 'DM Mono' }}>
            {totalPercent.toFixed(1)}%
          </span>
          <button onClick={distribute} style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}>
            Gleichmäßig
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {users.map(u => {
          const p = participants.find(pp => pp.userId === u.id);
          const active = (p?.percent ?? 0) > 0;
          return (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => toggleUser(u.id)} style={{
                width: 22, height: 22, borderRadius: 6, border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'var(--accent)' : 'transparent', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                {active && <span style={{ color: '#0f0f10', fontSize: 12, fontWeight: 700 }}>✓</span>}
              </button>
              <span style={{ flex: 1, fontSize: 14, color: active ? 'var(--text)' : 'var(--muted)' }}>{u.name}</span>
              {active && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="number" min={0} max={100} step={0.1} value={p?.percent.toFixed(1) ?? '0'} onChange={e => setPercent(u.id, parseFloat(e.target.value) || 0)}
                    style={{ width: 62, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', padding: '5px 8px', fontSize: 13, outline: 'none', textAlign: 'right', fontFamily: 'DM Mono' }}
                  />
                  <span style={{ color: 'var(--muted)', fontSize: 13 }}>%</span>
                  {amount && (
                    <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'DM Mono', minWidth: 60, textAlign: 'right' }}>
                      {fmt(parseFloat(amount.replace(',', '.') || '0') * (p?.percent ?? 0) / 100)}
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

  useEffect(() => { api('/api/users').then(setUsers).catch(() => {}); }, []);

  const handleLogin = async () => {
    if (!selectedId || !password) return setError('Bitte Benutzer und Passwort wählen.');
    setLoading(true); setError('');
    const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ userId: selectedId, password }) });
    setLoading(false);
    if (data.error) return setError(data.error);
    onLogin(data.token, data.user);
  };

  const handleRegister = async () => {
    if (!newName || !newPw) return setError('Name und Passwort erforderlich.');
    setLoading(true); setError('');
    const data = await api('/api/register', { method: 'POST', body: JSON.stringify({ name: newName, password: newPw }) });
    setLoading(false);
    if (data.error) return setError(data.error);
    onLogin(data.token, data.user);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#0f0f10', fontWeight: 700 }}>÷</div>
            <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em' }}>splitly</span>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>Ausgaben fair aufteilen</p>
        </div>
        <Card>
          <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--surface2)', borderRadius: 10, padding: 4 }}>
            {(['login', 'register'] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setError(''); }} style={{
                flex: 1, padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: mode === m ? 'var(--accent)' : 'transparent',
                color: mode === m ? '#0f0f10' : 'var(--muted)',
                fontWeight: mode === m ? 600 : 400, fontSize: 14, transition: 'all .2s', fontFamily: 'DM Sans',
              }}>
                {m === 'login' ? 'Anmelden' : 'Registrieren'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {mode === 'login' ? (
              <>
                <Select label="Benutzer" value={selectedId} onChange={setSelectedId}>
                  <option value="">— Benutzer wählen —</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </Select>
                <Input label="Passwort" type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
                {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
                <Btn onClick={handleLogin} disabled={loading} style={{ width: '100%', marginTop: 4 }}>{loading ? 'Lädt…' : 'Anmelden →'}</Btn>
              </>
            ) : (
              <>
                <Input label="Dein Name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="z.B. Max" />
                <Input label="Passwort" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleRegister()} />
                {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
                <Btn onClick={handleRegister} disabled={loading} style={{ width: '100%', marginTop: 4 }}>{loading ? 'Lädt…' : 'Konto erstellen →'}</Btn>
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
  users: User[]; currentUser: User; token: string; onAdded: () => void;
}) {
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState(currentUser.id);
  const [participants, setParticipants] = useState<Participant[]>(() =>
    users.map(u => ({ userId: u.id, percent: 100 / users.length }))
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!desc.trim()) return setError('Beschreibung fehlt.');
    const amtNum = parseFloat(amount.replace(',', '.'));
    if (!amtNum || amtNum <= 0) return setError('Ungültiger Betrag.');
    const total = participants.reduce((s, p) => s + p.percent, 0);
    if (Math.abs(total - 100) > 0.1) return setError(`Prozentsumme ist ${total.toFixed(1)}% (muss 100% sein).`);
    setLoading(true); setError('');
    const data = await api('/api/expenses', {
      method: 'POST',
      body: JSON.stringify({ description: desc, amount: amtNum, paidBy, participants: participants.filter(p => p.percent > 0) }),
    }, token);
    setLoading(false);
    if (data.error) return setError(data.error);
    setDesc(''); setAmount(''); setPaidBy(currentUser.id);
    setParticipants(users.map(u => ({ userId: u.id, percent: 100 / users.length })));
    setSuccess(true); setTimeout(() => setSuccess(false), 2500);
    onAdded();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600 }}>Ausgabe hinzufügen</h2>
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input label="Beschreibung" value={desc} onChange={e => setDesc(e.target.value)} placeholder="z.B. Abendessen" />
          <Input label="Betrag (€)" type="text" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" />
          <Select label="Bezahlt von" value={paidBy} onChange={setPaidBy}>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}{u.id === currentUser.id ? ' (du)' : ''}</option>)}
          </Select>
        </div>
      </Card>
      <Card>
        <ParticipantEditor users={users} participants={participants} setParticipants={setParticipants} amount={amount} />
      </Card>
      {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
      {success && <p style={{ color: 'var(--accent)', fontSize: 13 }}>✓ Ausgabe gespeichert!</p>}
      <Btn onClick={handleSubmit} disabled={loading} style={{ width: '100%' }}>{loading ? 'Speichert…' : 'Ausgabe speichern'}</Btn>
    </div>
  );
}

// ─── EDIT MODAL ───────────────────────────────────────────────────────────────
function EditModal({ expense, users, token, onClose, onSaved }: {
  expense: Expense; users: User[]; token: string; onClose: () => void; onSaved: () => void;
}) {
  const [desc, setDesc] = useState(expense.description);
  const [amount, setAmount] = useState(String(expense.amount));
  const [paidBy, setPaidBy] = useState(expense.paidBy);
  const [participants, setParticipants] = useState<Participant[]>(() =>
    users.map(u => {
      const existing = expense.participants.find(p => p.userId === u.id);
      return { userId: u.id, percent: existing?.percent ?? 0 };
    })
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!desc.trim()) return setError('Beschreibung fehlt.');
    const amtNum = parseFloat(amount.replace(',', '.'));
    if (!amtNum || amtNum <= 0) return setError('Ungültiger Betrag.');
    const total = participants.reduce((s, p) => s + p.percent, 0);
    if (Math.abs(total - 100) > 0.1) return setError(`Prozentsumme ist ${total.toFixed(1)}%`);
    setLoading(true); setError('');
    const data = await api('/api/expenses', {
      method: 'PUT',
      body: JSON.stringify({ id: expense.id, description: desc, amount: amtNum, paidBy, participants: participants.filter(p => p.percent > 0) }),
    }, token);
    setLoading(false);
    if (data.error) return setError(data.error);
    onSaved();
    onClose();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex',
      alignItems: 'flex-end', justifyContent: 'center', zIndex: 100, padding: '0 0 0 0',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'var(--surface)', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480,
        padding: '24px 20px 32px', maxHeight: '90vh', overflowY: 'auto',
        borderTop: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ fontSize: 17, fontWeight: 600 }}>Ausgabe bearbeiten</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input label="Beschreibung" value={desc} onChange={e => setDesc(e.target.value)} />
          <Input label="Betrag (€)" type="text" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
          <Select label="Bezahlt von" value={paidBy} onChange={setPaidBy}>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <div style={{ background: 'var(--surface2)', borderRadius: 12, padding: 16 }}>
            <ParticipantEditor users={users} participants={participants} setParticipants={setParticipants} amount={amount} />
          </div>
          {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn variant="ghost" onClick={onClose} style={{ flex: 1 }}>Abbrechen</Btn>
            <Btn onClick={handleSave} disabled={loading} style={{ flex: 2 }}>{loading ? 'Speichert…' : 'Änderungen speichern'}</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ACTIVITY TAB ─────────────────────────────────────────────────────────────
function ActivityTab({ expenses, users, currentUser, token, onRefresh }: {
  expenses: Expense[]; users: User[]; currentUser: User; token: string; onRefresh: () => void;
}) {
  const [filter, setFilter] = useState('all');
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadingDelete, setLoadingDelete] = useState(false);

  const getName = (id: string) => users.find(u => u.id === id)?.name || id;

  const filtered = [...expenses]
    .filter(e => filter === 'all' || e.paidBy === filter || e.participants.some(p => p.userId === filter))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const handleDelete = async (id: string) => {
    setLoadingDelete(true);
    const data = await api('/api/expenses', { method: 'DELETE', body: JSON.stringify({ id }) }, token);
    setLoadingDelete(false);
    setDeletingId(null);
    if (!data.error) onRefresh();
  };

  if (!expenses.length) return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
      <p>Noch keine Ausgaben</p>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {editingExpense && (
        <EditModal expense={editingExpense} users={users} token={token}
          onClose={() => setEditingExpense(null)} onSaved={onRefresh} />
      )}

      {/* Confirm delete dialog */}
      {deletingId && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20,
        }}>
          <Card style={{ maxWidth: 320, width: '100%', textAlign: 'center' }}>
            <p style={{ fontWeight: 500, marginBottom: 8 }}>Ausgabe löschen?</p>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>Diese Aktion kann nicht rückgängig gemacht werden.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <Btn variant="ghost" onClick={() => setDeletingId(null)} style={{ flex: 1 }}>Abbrechen</Btn>
              <Btn variant="danger" onClick={() => handleDelete(deletingId)} disabled={loadingDelete} style={{ flex: 1 }}>
                {loadingDelete ? '…' : 'Löschen'}
              </Btn>
            </div>
          </Card>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>Aktivität</h2>
        <select value={filter} onChange={e => setFilter(e.target.value)} style={{
          background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8,
          color: 'var(--text)', padding: '6px 10px', fontSize: 13, outline: 'none', cursor: 'pointer',
        }}>
          <option value="all">Alle Benutzer</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)' }}>
          Keine Ausgaben für diesen Filter
        </div>
      )}

      {filtered.map(exp => {
        const isOwn = exp.createdBy === currentUser.id;
        return (
          <Card key={exp.id} style={{ position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 500, fontSize: 15, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{exp.description}</p>
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {getName(exp.paidBy)} hat bezahlt · {fmtDate(exp.date)}
                </p>
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {exp.participants.map(p => (
                    <span key={p.userId} style={{
                      fontSize: 11, background: 'var(--surface2)', border: '1px solid var(--border)',
                      borderRadius: 6, padding: '2px 7px', color: 'var(--muted)',
                    }}>
                      {getName(p.userId)} {p.percent.toFixed(0)}%
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ fontWeight: 600, fontSize: 16, fontFamily: 'DM Mono', color: 'var(--accent)' }}>{fmt(exp.amount)}</p>
                {isOwn && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                    <Btn variant="ghost" size="sm" onClick={() => setEditingExpense(exp)}>✏️</Btn>
                    <Btn variant="danger" size="sm" onClick={() => setDeletingId(exp.id)}>🗑</Btn>
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

// ─── DEBTS TAB ────────────────────────────────────────────────────────────────
function DebtsTab({ expenses, users, currentUser, token, onRefresh }: {
  expenses: Expense[]; users: User[]; currentUser: User; token: string; onRefresh: () => void;
}) {
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const getName = (id: string) => users.find(u => u.id === id)?.name || id;

  // Build debt pairs per expense (for settled toggle)
  // Group by payer+debtor pair
  type DebtPair = { from: string; to: string; totalAmount: number; expenseIds: string[]; settled: boolean };

  // Net debts aggregated across all non-settled expenses
  const allDebts = calcNetDebts(expenses, users);

  // Settled state comes from individual expenses. For each unique from→to pair,
  // we check if ALL relevant expenses are settled
  // We show debts from expense-level perspective: one row per expense with a participant who owes
  type DebtRow = { expenseId: string; from: string; to: string; amount: number; settled: boolean; description: string; date: string };
  const debtRows: DebtRow[] = [];
  expenses.forEach(exp => {
    exp.participants.forEach(p => {
      if (p.userId === exp.paidBy) return;
      const share = (exp.amount * p.percent) / 100;
      if (share < 0.01) return;
      debtRows.push({
        expenseId: exp.id,
        from: p.userId,
        to: exp.paidBy,
        amount: share,
        settled: exp.settled,
        description: exp.description,
        date: exp.date,
      });
    });
  });

  const myDebts = debtRows.filter(d => d.from === currentUser.id);
  const owedToMe = debtRows.filter(d => d.to === currentUser.id);
  const otherDebts = debtRows.filter(d => d.from !== currentUser.id && d.to !== currentUser.id);

  const handleToggleSettled = async (expenseId: string) => {
    setSettlingId(expenseId);
    await api('/api/settled', { method: 'POST', body: JSON.stringify({ id: expenseId }) }, token);
    setSettlingId(null);
    onRefresh();
  };

  const DebtRow = ({ d, showSettle }: { d: DebtRow; showSettle: boolean }) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '12px 16px', borderRadius: 10,
      background: d.settled ? 'rgba(110,231,183,0.04)' : 'var(--surface2)',
      border: `1px solid ${d.settled ? 'rgba(110,231,183,0.15)' : 'var(--border)'}`,
      opacity: d.settled ? 0.7 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 500, textDecoration: d.settled ? 'line-through' : 'none', color: d.settled ? 'var(--muted)' : 'var(--text)' }}>
            {getName(d.from)} → {getName(d.to)}
          </span>
          {d.settled && (
            <span style={{ fontSize: 10, background: 'rgba(110,231,183,0.15)', color: 'var(--accent)', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>
              BEGLICHEN
            </span>
          )}
        </div>
        <p style={{ fontSize: 11, color: 'var(--muted)' }}>{d.description} · {fmtDate(d.date)}</p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontFamily: 'DM Mono', fontWeight: 600, fontSize: 14, color: d.settled ? 'var(--muted)' : 'var(--text)' }}>
          {fmt(d.amount)}
        </span>
        {showSettle && (
          <button onClick={() => handleToggleSettled(d.expenseId)} disabled={settlingId === d.expenseId}
            title={d.settled ? 'Als offen markieren' : 'Als beglichen markieren'}
            style={{
              width: 28, height: 28, borderRadius: 7, border: `1.5px solid ${d.settled ? 'var(--accent)' : 'var(--border)'}`,
              background: d.settled ? 'rgba(110,231,183,0.15)' : 'var(--surface)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
              transition: 'all .2s', flexShrink: 0,
            }}>
            {settlingId === d.expenseId ? '…' : d.settled ? '✓' : '○'}
          </button>
        )}
      </div>
    </div>
  );

  if (!debtRows.length) return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
      <p>Alles ausgeglichen!</p>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600 }}>Schulden</h2>

      {myDebts.length > 0 && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, marginBottom: 8 }}>Du schuldest</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {myDebts.map((d, i) => <DebtRow key={i} d={d} showSettle={false} />)}
          </div>
        </div>
      )}

      {owedToMe.length > 0 && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, marginBottom: 8 }}>
            Dir wird geschuldet
            <span style={{ marginLeft: 6, color: 'var(--muted)', fontWeight: 400, textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
              (○ = als beglichen markieren)
            </span>
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {owedToMe.map((d, i) => <DebtRow key={i} d={d} showSettle={true} />)}
          </div>
        </div>
      )}

      {otherDebts.length > 0 && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, marginBottom: 8 }}>Alle weiteren Schulden</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {otherDebts.map((d, i) => <DebtRow key={i} d={d} showSettle={false} />)}
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
    const t = localStorage.getItem('token');
    const u = localStorage.getItem('user');
    if (t && u) { setToken(t); setCurrentUser(JSON.parse(u)); }
  }, []);

  const loadData = useCallback(async (t: string) => {
    setLoadingData(true);
    const [u, e] = await Promise.all([api('/api/users'), api('/api/expenses', undefined, t)]);
    if (Array.isArray(u)) setUsers(u);
    if (Array.isArray(e)) setExpenses(e);
    setLoadingData(false);
  }, []);

  useEffect(() => { if (token) loadData(token); }, [token, loadData]);

  const handleLogin = (t: string, user: User) => {
    localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(user));
    setToken(t); setCurrentUser(user);
  };

  const handleLogout = () => {
    localStorage.removeItem('token'); localStorage.removeItem('user');
    setToken(null); setCurrentUser(null); setUsers([]); setExpenses([]);
  };

  const tabs = [
    { id: 'add' as const, label: 'Ausgabe', icon: '+' },
    { id: 'activity' as const, label: 'Aktivität', icon: '≡' },
    { id: 'debts' as const, label: 'Schulden', icon: '⇄' },
  ];

  if (!token || !currentUser) return (
    <><Head><title>Splitly</title></Head><LoginScreen onLogin={handleLogin} /></>
  );

  return (
    <>
      <Head><title>Splitly</title></Head>
      {/* Header – fixed at top */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 20,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#0f0f10' }}>÷</div>
          <span style={{ fontWeight: 600, letterSpacing: '-0.02em' }}>splitly</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Hi, {currentUser.name}</span>
          <button onClick={handleLogout} style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontFamily: 'DM Sans' }}>
            Logout
          </button>
        </div>
      </div>

      {/* Scrollable content – padded so it doesn't hide under header or nav */}
      <div style={{ paddingTop: 64, paddingBottom: 80 }}>
        <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px' }}>
          {loadingData ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>Lädt…</div>
          ) : tab === 'add' ? (
            <AddExpenseTab users={users} currentUser={currentUser} token={token} onAdded={() => loadData(token)} />
          ) : tab === 'activity' ? (
            <ActivityTab expenses={expenses} users={users} currentUser={currentUser} token={token} onRefresh={() => loadData(token)} />
          ) : (
            <DebtsTab expenses={expenses} users={users} currentUser={currentUser} token={token} onRefresh={() => loadData(token)} />
          )}
        </div>
      </div>

      {/* Bottom Nav – always fixed at bottom */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20,
        background: 'var(--surface)', borderTop: '1px solid var(--border)',
        display: 'flex', padding: '8px 8px 20px',
      }}>
        <div style={{ display: 'flex', width: '100%', maxWidth: 480, margin: '0 auto' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px 4px',
              borderRadius: 10, transition: 'background .15s', fontFamily: 'DM Sans',
            }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surface2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ fontSize: 16, color: tab === t.id ? 'var(--accent)' : 'var(--muted)' }}>{t.icon}</span>
              <span style={{ fontSize: 11, fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? 'var(--accent)' : 'var(--muted)' }}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
