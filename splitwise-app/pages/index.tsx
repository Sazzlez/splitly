import { useEffect, useState, useCallback } from 'react';
import Head from 'next/head';

const ViewportMeta = () => (
  <Head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  </Head>
);

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
  settledBy?: string[];
}

const api = async (path: string, opts?: RequestInit, token?: string) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(path, { ...opts, headers: { ...headers, ...(opts?.headers || {}) } });
  return r.json();
};

const fmt = (n: number) => n.toFixed(2).replace('.', ',') + ' €';
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });

function Input({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{label}</label>
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
      <label style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)} style={{
        background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10,
        color: 'var(--text)', padding: '10px 14px', fontSize: 15, outline: 'none', width: '100%',
      }}>
        {children}
      </select>
    </div>
  );
}

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
        <span style={{ fontSize: 14, fontWeight: 600 }}>Aufteilen auf</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: Math.abs(totalPercent - 100) > 0.1 ? 'var(--danger)' : 'var(--accent)', fontFamily: 'DM Mono' }}>
            {totalPercent.toFixed(1)}%
          </span>
          <button onClick={distribute} style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontWeight: 500 }}>
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

function SuccessToast({ visible }: { visible: boolean }) {
  return (
    <div style={{
      position: 'fixed', bottom: 100, left: '50%', transform: `translateX(-50%) translateY(${visible ? '0' : '20px'})`,
      zIndex: 200, pointerEvents: 'none',
      opacity: visible ? 1 : 0,
      transition: 'opacity 0.25s ease, transform 0.25s ease',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: '#18181b', border: '1px solid rgba(110,231,183,0.4)',
        borderRadius: 14, padding: '12px 20px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" style={{ flexShrink: 0 }}>
          <circle cx="11" cy="11" r="10" stroke="#6ee7b7" strokeWidth="1.5" />
          <path
            d="M7 11.5l3 3 5-5.5"
            stroke="#6ee7b7"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="12"
            strokeDashoffset={visible ? '0' : '12'}
            style={{ transition: 'stroke-dashoffset 0.35s ease 0.1s' }}
          />
        </svg>
        <span style={{ fontSize: 14, fontWeight: 500, color: '#f4f4f5', whiteSpace: 'nowrap' }}>
          Ausgabe gespeichert!
        </span>
      </div>
    </div>
  );
}

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
      <SuccessToast visible={success} />
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
      <Btn onClick={handleSubmit} disabled={loading} style={{ width: '100%' }}>{loading ? 'Speichert…' : 'Ausgabe speichern'}</Btn>
    </div>
  );
}

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

function ActivityTab({ expenses, users, currentUser, token, onRefresh }: {
  expenses: Expense[]; users: User[]; currentUser: User; token: string; onRefresh: () => void;
}) {
  const [filter, setFilter] = useState('all');
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadingDelete, setLoadingDelete] = useState(false);

  const getName = (id: string) => users.find(u => u.id === id)?.name || id;

  const filtered = [...expenses]
    .filter(e => filter === 'all' || e.paidBy === filter)
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
        const canEdit = exp.paidBy === currentUser.id;
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
                      borderRadius: 6, padding: '2px 7px', color: 'var(--text)',
                    }}>
                      {getName(p.userId)} {p.percent.toFixed(0)}%
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ fontWeight: 600, fontSize: 16, fontFamily: 'DM Mono', color: 'var(--accent)' }}>{fmt(exp.amount)}</p>
                {canEdit && (
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

function DebtsTab({ expenses, users, currentUser, token, onRefresh }: {
  expenses: Expense[]; users: User[]; currentUser: User; token: string; onRefresh: () => void;
}) {
  const [settlingKey, setSettlingKey] = useState<string | null>(null);
  const [expandedPairs, setExpandedPairs] = useState<string[]>([]);
  const getName = (id: string) => users.find(u => u.id === id)?.name || id;

  type PairDetail = {
    key: string;
    expenseId: string;
    description: string;
    date: string;
    from: string;
    to: string;
    amount: number;
    settled: boolean;
    canSettle: boolean;
  };

  type PairSummary = {
    pairKey: string;
    userA: string;
    userB: string;
    details: PairDetail[];
    hasOpen: boolean;
    hasSettled: boolean;
    isBalanced: boolean;
    grossOpenAToB: number;
    grossOpenBToA: number;
    grossSettledAToB: number;
    grossSettledBToA: number;
    openNet: number;
    openFrom: string | null;
    openTo: string | null;
    settledNet: number;
    settledFrom: string | null;
    settledTo: string | null;
  };

  const pairMap: Record<string, { pairKey: string; userA: string; userB: string; details: PairDetail[] }> = {};

  const ensurePair = (user1: string, user2: string) => {
    const [userA, userB] = [user1, user2].sort();
    const pairKey = `${userA}__${userB}`;
    if (!pairMap[pairKey]) {
      pairMap[pairKey] = { pairKey, userA, userB, details: [] };
    }
    return pairMap[pairKey];
  };

  expenses.forEach(exp => {
    exp.participants.forEach(participant => {
      if (participant.userId === exp.paidBy) return;
      const amount = (exp.amount * participant.percent) / 100;
      if (amount < 0.01) return;

      const from = participant.userId;
      const to = exp.paidBy;
      const pair = ensurePair(from, to);
      const isSettled = exp.settled || (exp.settledBy || []).includes(from);

      pair.details.push({
        key: `${exp.id}__${from}`,
        expenseId: exp.id,
        description: exp.description,
        date: exp.date,
        from,
        to,
        amount,
        settled: isSettled,
        canSettle: !isSettled && to === currentUser.id,
      });
    });
  });

  const pairSummaries: PairSummary[] = Object.values(pairMap)
    .map(pair => {
      let grossOpenAToB = 0;
      let grossOpenBToA = 0;
      let grossSettledAToB = 0;
      let grossSettledBToA = 0;

      pair.details.forEach(detail => {
        const isAToB = detail.from === pair.userA && detail.to === pair.userB;
        if (detail.settled) {
          if (isAToB) grossSettledAToB += detail.amount;
          else grossSettledBToA += detail.amount;
        } else {
          if (isAToB) grossOpenAToB += detail.amount;
          else grossOpenBToA += detail.amount;
        }
      });

      const openDiff = grossOpenAToB - grossOpenBToA;
      const settledDiff = grossSettledAToB - grossSettledBToA;
      const hasOpen = grossOpenAToB + grossOpenBToA > 0.01;
      const hasSettled = grossSettledAToB + grossSettledBToA > 0.01;
      const isBalanced = hasOpen && Math.abs(openDiff) < 0.01;

      return {
        pairKey: pair.pairKey,
        userA: pair.userA,
        userB: pair.userB,
        details: pair.details,
        hasOpen,
        hasSettled,
        isBalanced,
        grossOpenAToB,
        grossOpenBToA,
        grossSettledAToB,
        grossSettledBToA,
        openNet: Math.abs(openDiff),
        openFrom: openDiff > 0 ? pair.userA : openDiff < 0 ? pair.userB : null,
        openTo: openDiff > 0 ? pair.userB : openDiff < 0 ? pair.userA : null,
        settledNet: Math.abs(settledDiff),
        settledFrom: settledDiff > 0 ? pair.userA : settledDiff < 0 ? pair.userB : null,
        settledTo: settledDiff > 0 ? pair.userB : settledDiff < 0 ? pair.userA : null,
      };
    })
    .filter(pair => pair.hasOpen || pair.hasSettled)
    .sort((a, b) => {
      if (a.hasOpen !== b.hasOpen) return a.hasOpen ? -1 : 1;
      return (b.openNet || b.settledNet) - (a.openNet || a.settledNet);
    });

  const openPairs = pairSummaries.filter(pair => pair.hasOpen && !pair.isBalanced);
  const balancedPairs = pairSummaries.filter(pair => pair.hasOpen && pair.isBalanced);
  const settledPairs = pairSummaries.filter(pair => !pair.hasOpen && pair.hasSettled);

  const myDebts = openPairs.filter(pair => pair.openFrom === currentUser.id);
  const owedToMe = openPairs.filter(pair => pair.openTo === currentUser.id);
  const otherDebts = openPairs.filter(pair => pair.openFrom !== currentUser.id && pair.openTo !== currentUser.id);

  const toggleExpanded = (pairKey: string) => {
    setExpandedPairs(prev => prev.includes(pairKey) ? prev.filter(key => key !== pairKey) : [...prev, pairKey]);
  };

  const handleSettle = async (detail: PairDetail) => {
    setSettlingKey(detail.key);
    const data = await api('/api/settled', {
      method: 'POST',
      body: JSON.stringify({ id: detail.expenseId, debtorUserId: detail.from }),
    }, token);
    setSettlingKey(null);
    if (!data.error) onRefresh();
  };

  const PairRow = ({ pair }: { pair: PairSummary }) => {
    const isExpanded = expandedPairs.includes(pair.pairKey);
    const isSettledSummary = !pair.hasOpen && pair.hasSettled;
    const showBalanced = pair.hasOpen && pair.isBalanced;
    const amount = showBalanced ? 0 : (pair.hasOpen ? pair.openNet : pair.settledNet);
    const detailRows = [...pair.details].sort((a, b) => {
      if (a.settled !== b.settled) return a.settled ? 1 : -1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
    const hasNetting = pair.grossOpenAToB > 0.01 && pair.grossOpenBToA > 0.01;

    return (
      <div style={{
        borderRadius: 12,
        background: 'var(--surface2)',
        border: `1px solid ${isSettledSummary ? 'rgba(110,231,183,0.25)' : 'var(--border)'}`,
        overflow: 'hidden',
      }}>
        <div onClick={() => toggleExpanded(pair.pairKey)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', cursor: 'pointer' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {showBalanced ? (
                <>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{getName(pair.userA)}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>⇄</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{getName(pair.userB)}</span>
                  <span style={{ fontSize: 10, background: 'rgba(255,255,255,0.06)', color: 'var(--muted)', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>
                    VERRECHNET
                  </span>
                </>
              ) : (
                <>
                  <span style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: isSettledSummary ? 'var(--muted)' : 'var(--text)',
                    textDecoration: isSettledSummary ? 'line-through' : 'none',
                  }}>{getName(pair.hasOpen ? pair.openFrom || pair.userA : pair.settledFrom || pair.userA)}</span>
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}>→</span>
                  <span style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: isSettledSummary ? 'var(--muted)' : 'var(--text)',
                    textDecoration: isSettledSummary ? 'line-through' : 'none',
                  }}>{getName(pair.hasOpen ? pair.openTo || pair.userB : pair.settledTo || pair.userB)}</span>
                  {isSettledSummary && (
                    <span style={{ fontSize: 10, background: 'rgba(110,231,183,0.15)', color: 'var(--accent)', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>
                      BEGLICHEN
                    </span>
                  )}
                </>
              )}
            </div>

            {hasNetting && !showBalanced && (
              <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                Verrechnet: {fmt(Math.max(pair.grossOpenAToB, pair.grossOpenBToA))} - {fmt(Math.min(pair.grossOpenAToB, pair.grossOpenBToA))}
              </p>
            )}

            {showBalanced && (
              <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                Kein offener Nettobetrag mehr.
              </p>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <span style={{ fontFamily: 'DM Mono', fontWeight: 700, fontSize: 16, color: isSettledSummary ? 'var(--muted)' : 'var(--text)' }}>
              {fmt(amount)}
            </span>
            <span style={{ color: 'var(--muted)', fontSize: 14 }}>{isExpanded ? '▾' : '▸'}</span>
          </div>
        </div>

        {isExpanded && (
          <div style={{ borderTop: '1px solid var(--border)', padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {detailRows.map(detail => {
              const isLoading = settlingKey === detail.key;
              return (
                <div key={detail.key} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'var(--surface)',
                  border: `1px solid ${detail.settled ? 'rgba(110,231,183,0.2)' : 'var(--border)'}`,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 500, color: detail.settled ? 'var(--muted)' : 'var(--text)', textDecoration: detail.settled ? 'line-through' : 'none' }}>
                      {detail.description}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>
                      {getName(detail.from)} → {getName(detail.to)} · {fmtDate(detail.date)}
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{ fontFamily: 'DM Mono', fontSize: 14, fontWeight: 700, color: detail.settled ? 'var(--muted)' : 'var(--text)' }}>
                      {fmt(detail.amount)}
                    </span>
                    {detail.settled ? (
                      <span style={{ fontSize: 10, background: 'rgba(110,231,183,0.15)', color: 'var(--accent)', borderRadius: 4, padding: '2px 6px', fontWeight: 600 }}>
                        BEGLICHEN
                      </span>
                    ) : detail.canSettle ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSettle(detail); }}
                        disabled={isLoading}
                        title="Diese Schuld als beglichen markieren"
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          border: '1.5px solid var(--border)',
                          background: 'var(--surface2)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 14,
                          color: 'var(--muted)',
                        }}
                      >
                        {isLoading ? '…' : '○'}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  if (!pairSummaries.length) return (
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
          <p style={{ fontSize: 12, color: 'var(--danger)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>
            Du schuldest
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {myDebts.map(pair => <PairRow key={pair.pairKey} pair={pair} />)}
          </div>
        </div>
      )}

      {owedToMe.length > 0 && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>
            Dir wird geschuldet
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {owedToMe.map(pair => <PairRow key={pair.pairKey} pair={pair} />)}
          </div>
        </div>
      )}

      {otherDebts.length > 0 && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>
            Alle weiteren Schulden
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {otherDebts.map(pair => <PairRow key={pair.pairKey} pair={pair} />)}
          </div>
        </div>
      )}

      {balancedPairs.length > 0 && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>
            Verrechnet
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {balancedPairs.map(pair => <PairRow key={pair.pairKey} pair={pair} />)}
          </div>
        </div>
      )}

      {settledPairs.length > 0 && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 8 }}>
            Beglichen
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {settledPairs.map(pair => <PairRow key={pair.pairKey} pair={pair} />)}
          </div>
        </div>
      )}
    </div>
  );
}

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
    <><ViewportMeta /><Head><title>Splitly</title></Head><LoginScreen onLogin={handleLogin} /></>
  );

  return (
    <>
      <ViewportMeta />
      <Head><title>Splitly</title></Head>
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
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Hi, <span style={{ color: 'var(--text)', fontWeight: 500 }}>{currentUser.name}</span></span>
          <button onClick={handleLogout} style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontFamily: 'DM Sans' }}>
            Logout
          </button>
        </div>
      </div>

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
              <span style={{ fontSize: 11, fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? 'var(--accent)' : 'var(--muted)', letterSpacing: tab === t.id ? '-0.01em' : '0' }}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
