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
}

// ─── API helpers ──────────────────────────────────────────────────────────────
const api = async (path: string, opts?: RequestInit, token?: string) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetch(path, { ...opts, headers: { ...headers, ...(opts?.headers || {}) } });
  return r.json();
};

// ─── Debt calculation ─────────────────────────────────────────────────────────
function calcDebts(expenses: Expense[], users: User[]) {
  // owedTo[creditor][debtor] = amount
  const owedTo: Record<string, Record<string, number>> = {};
  users.forEach(u => { owedTo[u.id] = {}; users.forEach(v => { owedTo[u.id][v.id] = 0; }); });

  expenses.forEach(exp => {
    exp.participants.forEach(p => {
      if (p.userId === exp.paidBy) return;
      const share = (exp.amount * p.percent) / 100;
      owedTo[exp.paidBy][p.userId] = (owedTo[exp.paidBy][p.userId] || 0) + share;
    });
  });

  const result: { from: string; to: string; amount: number }[] = [];
  users.forEach(creditor => {
    users.forEach(debtor => {
      if (creditor.id === debtor.id) return;
      const net = owedTo[creditor.id][debtor.id] - owedTo[debtor.id][creditor.id];
      if (net > 0.005) result.push({ from: debtor.id, to: creditor.id, amount: net });
    });
  });
  return result.filter(d => d.amount > 0.005);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n: number) => n.toFixed(2).replace('.', ',') + ' €';
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });

// ─── Components ───────────────────────────────────────────────────────────────

function Input({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>{label}</label>
      <input {...props} style={{
        background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10,
        color: 'var(--text)', padding: '10px 14px', fontSize: 15, outline: 'none', width: '100%',
        transition: 'border-color .2s',
        ...props.style,
      }}
        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
        onBlur={e => e.target.style.borderColor = 'var(--border)'}
      />
    </div>
  );
}

function Btn({ children, variant = 'primary', ...props }: { children: React.ReactNode; variant?: 'primary' | 'ghost' | 'danger' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--accent)', color: '#0f0f10', fontWeight: 600 },
    ghost: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)' },
    danger: { background: 'var(--danger)', color: '#0f0f10', fontWeight: 600 },
  };
  return (
    <button {...props} style={{
      borderRadius: 10, padding: '11px 20px', fontSize: 14, cursor: 'pointer', border: 'none',
      transition: 'opacity .15s, transform .1s', ...styles[variant], ...props.style,
    }}
      onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
      onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
      onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.97)')}
      onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
    >
      {children}
    </button>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, ...style }}>{children}</div>;
}

// ─── LOGIN SCREEN ────────────────────────────────────────────────────────────
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
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>÷</div>
            <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em' }}>splitly</span>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>Ausgaben fair aufteilen</p>
        </div>

        <Card>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--surface2)', borderRadius: 10, padding: 4 }}>
            {(['login', 'register'] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setError(''); }} style={{
                flex: 1, padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: mode === m ? 'var(--accent)' : 'transparent',
                color: mode === m ? '#0f0f10' : 'var(--muted)',
                fontWeight: mode === m ? 600 : 400, fontSize: 14, transition: 'all .2s',
              }}>
                {m === 'login' ? 'Anmelden' : 'Registrieren'}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {mode === 'login' ? (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>Benutzer</label>
                  <select value={selectedId} onChange={e => setSelectedId(e.target.value)} style={{
                    background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10,
                    color: selectedId ? 'var(--text)' : 'var(--muted)', padding: '10px 14px', fontSize: 15, outline: 'none', width: '100%',
                  }}>
                    <option value="">— Benutzer wählen —</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <Input label="Passwort" type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
                {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
                <Btn onClick={handleLogin} disabled={loading} style={{ width: '100%', marginTop: 4 }}>
                  {loading ? 'Lädt…' : 'Anmelden →'}
                </Btn>
              </>
            ) : (
              <>
                <Input label="Dein Name" value={newName} onChange={e => setNewName(e.target.value)} placeholder="z.B. Max" />
                <Input label="Passwort" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleRegister()} />
                {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
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

  const totalPercent = participants.reduce((s, p) => s + p.percent, 0);

  const toggleUser = (userId: string) => {
    const active = participants.filter(p => p.percent > 0);
    const isActive = active.find(p => p.userId === userId);
    if (isActive && active.length === 1) return; // keep at least one
    const next = participants.map(p => ({ ...p, percent: p.userId === userId ? (isActive ? 0 : 0) : p.percent }));
    if (!isActive) {
      const activeIds = next.filter(p => p.userId === userId || participants.find(pp => pp.userId === p.userId && pp.percent > 0));
      // distribute equally among active (those that remain > 0 plus new one)
      const newActive = participants.filter(p => p.percent > 0).map(p => p.userId).concat(userId);
      const eq = parseFloat((100 / newActive.length).toFixed(4));
      setParticipants(participants.map(p => ({ userId: p.userId, percent: newActive.includes(p.userId) ? eq : 0 })));
    } else {
      const remaining = participants.filter(p => p.userId !== userId && p.percent > 0);
      const eq = parseFloat((100 / remaining.length).toFixed(4));
      setParticipants(participants.map(p => ({ userId: p.userId, percent: remaining.find(r => r.userId === p.userId) ? eq : 0 })));
    }
  };

  const setPercent = (userId: string, val: number) => {
    setParticipants(prev => prev.map(p => p.userId === userId ? { ...p, percent: val } : p));
  };

  const distribute = () => {
    const active = participants.filter(p => p.percent > 0);
    if (!active.length) return;
    const eq = parseFloat((100 / active.length).toFixed(4));
    setParticipants(participants.map(p => ({ ...p, percent: p.percent > 0 ? eq : 0 })));
  };

  const handleSubmit = async () => {
    if (!desc.trim()) return setError('Beschreibung fehlt.');
    const amtNum = parseFloat(amount.replace(',', '.'));
    if (!amtNum || amtNum <= 0) return setError('Ungültiger Betrag.');
    if (Math.abs(totalPercent - 100) > 0.1) return setError(`Prozentsumme ist ${totalPercent.toFixed(1)}% (muss 100% sein).`);
    const activeParticipants = participants.filter(p => p.percent > 0);
    setLoading(true); setError('');
    const data = await api('/api/expenses', {
      method: 'POST',
      body: JSON.stringify({ description: desc, amount: amtNum, paidBy, participants: activeParticipants }),
    }, token);
    setLoading(false);
    if (data.error) return setError(data.error);
    setDesc(''); setAmount('');
    setPaidBy(currentUser.id);
    setParticipants(users.map(u => ({ userId: u.id, percent: 100 / users.length })));
    setSuccess(true);
    setTimeout(() => setSuccess(false), 2500);
    onAdded();
  };

  const getName = (id: string) => users.find(u => u.id === id)?.name || id;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600 }}>Ausgabe hinzufügen</h2>

      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Input label="Beschreibung" value={desc} onChange={e => setDesc(e.target.value)} placeholder="z.B. Abendessen" />

          <Input label="Betrag (€)" type="text" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>Bezahlt von</label>
            <select value={paidBy} onChange={e => setPaidBy(e.target.value)} style={{
              background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10,
              color: 'var(--text)', padding: '10px 14px', fontSize: 15, outline: 'none', width: '100%',
            }}>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}{u.id === currentUser.id ? ' (du)' : ''}</option>)}
            </select>
          </div>
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>Aufteilen auf</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: Math.abs(totalPercent - 100) > 0.1 ? 'var(--danger)' : 'var(--accent)', fontFamily: 'DM Mono', }}>
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
      </Card>

      {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
      {success && <p style={{ color: 'var(--accent)', fontSize: 13 }}>✓ Ausgabe gespeichert!</p>}

      <Btn onClick={handleSubmit} disabled={loading} style={{ width: '100%' }}>
        {loading ? 'Speichert…' : 'Ausgabe speichern'}
      </Btn>
    </div>
  );
}

// ─── ACTIVITY TAB ─────────────────────────────────────────────────────────────
function ActivityTab({ expenses, users }: { expenses: Expense[]; users: User[] }) {
  const getName = (id: string) => users.find(u => u.id === id)?.name || id;
  const sorted = [...expenses].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (!sorted.length) return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
      <p>Noch keine Ausgaben</p>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Aktivität</h2>
      {sorted.map(exp => (
        <Card key={exp.id}>
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
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ─── DEBTS TAB ────────────────────────────────────────────────────────────────
function DebtsTab({ expenses, users, currentUser }: { expenses: Expense[]; users: User[]; currentUser: User }) {
  const getName = (id: string) => users.find(u => u.id === id)?.name || id;
  const debts = calcDebts(expenses, users);

  const myDebts = debts.filter(d => d.from === currentUser.id);
  const owedToMe = debts.filter(d => d.to === currentUser.id);
  const otherDebts = debts.filter(d => d.from !== currentUser.id && d.to !== currentUser.id);

  const DebtRow = ({ d, highlight }: { d: { from: string; to: string; amount: number }; highlight?: boolean }) => (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      padding: '12px 16px', borderRadius: 10,
      background: highlight ? 'rgba(110,231,183,0.06)' : 'var(--surface2)',
      border: `1px solid ${highlight ? 'rgba(110,231,183,0.2)' : 'var(--border)'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{getName(d.from)}</span>
        <span style={{ color: 'var(--muted)', fontSize: 12 }}>→</span>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{getName(d.to)}</span>
      </div>
      <span style={{ fontFamily: 'DM Mono', fontWeight: 600, color: highlight ? 'var(--accent)' : 'var(--text)', fontSize: 14 }}>
        {fmt(d.amount)}
      </span>
    </div>
  );

  if (!debts.length) return (
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
            {myDebts.map((d, i) => <DebtRow key={i} d={d} />)}
          </div>
        </div>
      )}

      {owedToMe.length > 0 && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, marginBottom: 8 }}>Dir wird geschuldet</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {owedToMe.map((d, i) => <DebtRow key={i} d={d} highlight />)}
          </div>
        </div>
      )}

      {otherDebts.length > 0 && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, marginBottom: 8 }}>Alle Schulden</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {otherDebts.map((d, i) => <DebtRow key={i} d={d} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [tab, setTab] = useState<'add' | 'activity' | 'debts'>('add');
  const [loadingData, setLoadingData] = useState(false);

  // Restore session
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

  useEffect(() => {
    if (token) loadData(token);
  }, [token, loadData]);

  const handleLogin = (t: string, user: User) => {
    localStorage.setItem('token', t);
    localStorage.setItem('user', JSON.stringify(user));
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
    <>
      <Head><title>Splitly</title></Head>
      <LoginScreen onLogin={handleLogin} />
    </>
  );

  return (
    <>
      <Head><title>Splitly</title></Head>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', maxWidth: 480, margin: '0 auto', padding: '0 0 80px 0' }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--border)',
          position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#0f0f10' }}>÷</div>
            <span style={{ fontWeight: 600, letterSpacing: '-0.02em' }}>splitly</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>Hi, {currentUser.name}</span>
            <button onClick={handleLogout} style={{ fontSize: 12, color: 'var(--muted)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 7, padding: '5px 10px', cursor: 'pointer' }}>
              Logout
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: '20px 16px' }}>
          {loadingData ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>Lädt…</div>
          ) : tab === 'add' ? (
            <AddExpenseTab users={users} currentUser={currentUser} token={token} onAdded={() => loadData(token)} />
          ) : tab === 'activity' ? (
            <ActivityTab expenses={expenses} users={users} />
          ) : (
            <DebtsTab expenses={expenses} users={users} currentUser={currentUser} />
          )}
        </div>

        {/* Bottom Nav */}
        <div style={{
          position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
          width: '100%', maxWidth: 480,
          background: 'var(--surface)', borderTop: '1px solid var(--border)',
          display: 'flex', padding: '8px 8px 12px',
        }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px 4px',
              borderRadius: 10, transition: 'background .15s',
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
