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
  eventId: string | null;
}

interface SplitlyEvent {
  id: string;
  name: string;
  code: string;
  creatorId: string;
  memberIds: string[];
}

interface DebtLine {
  key: string;
  expenseId: string;
  description: string;
  date: string;
  from: string;
  to: string;
  amount: number;
  settled: boolean;
}

interface DebtPair {
  pairId: string;
  userA: string;
  userB: string;
  openAToB: number;
  openBToA: number;
  totalAToB: number;
  totalBToA: number;
  settledAmount: number;
  latestDate: string;
  openLines: DebtLine[];
  settledLines: DebtLine[];
  netAmount: number;
  netFrom: string | null;
  netTo: string | null;
  displayAmount: number;
  displayFrom: string | null;
  displayTo: string | null;
  isSettled: boolean;
  hasNetting: boolean;
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

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function buildEqualParticipants(users: User[], activeIds: string[]) {
  const orderedActiveIds = users.map((user) => user.id).filter((id) => activeIds.includes(id));
  if (!orderedActiveIds.length) {
    return users.map((user) => ({ userId: user.id, percent: 0 }));
  }

  const base = Math.floor((100 / orderedActiveIds.length) * 10000) / 10000;
  let assigned = 0;

  return users.map((user) => {
    if (!orderedActiveIds.includes(user.id)) {
      return { userId: user.id, percent: 0 };
    }

    const activeIndex = orderedActiveIds.indexOf(user.id);
    const isLastActive = activeIndex === orderedActiveIds.length - 1;
    const percent = isLastActive
      ? Math.round((100 - assigned + Number.EPSILON) * 10000) / 10000
      : base;

    assigned = Math.round((assigned + percent + Number.EPSILON) * 10000) / 10000;
    return { userId: user.id, percent };
  });
}

function buildDebtPairs(expenses: Expense[]) {
  const pairMap: Record<string, {
    userA: string;
    userB: string;
    openLines: DebtLine[];
    settledLines: DebtLine[];
    latestDate: string;
  }> = {};

  expenses.forEach((expense) => {
    expense.participants.forEach((participant) => {
      if (participant.userId === expense.paidBy) return;

      const amount = roundMoney((expense.amount * participant.percent) / 100);
      if (amount <= 0.005) return;

      const [userA, userB] = [participant.userId, expense.paidBy].sort();
      const pairId = `${userA}__${userB}`;

      if (!pairMap[pairId]) {
        pairMap[pairId] = {
          userA,
          userB,
          openLines: [],
          settledLines: [],
          latestDate: expense.date,
        };
      }

      if (new Date(expense.date).getTime() > new Date(pairMap[pairId].latestDate).getTime()) {
        pairMap[pairId].latestDate = expense.date;
      }

      const line: DebtLine = {
        key: `${expense.id}__${participant.userId}`,
        expenseId: expense.id,
        description: expense.description,
        date: expense.date,
        from: participant.userId,
        to: expense.paidBy,
        amount,
        settled: expense.settledBy.includes(participant.userId),
      };

      if (line.settled) {
        pairMap[pairId].settledLines.push(line);
      } else {
        pairMap[pairId].openLines.push(line);
      }
    });
  });

  return Object.entries(pairMap)
    .map(([pairId, pair]) => {
      const sumDirection = (lines: DebtLine[], from: string, to: string) => roundMoney(
        lines
          .filter((line) => line.from === from && line.to === to)
          .reduce((sum, line) => sum + line.amount, 0)
      );

      const openAToB = sumDirection(pair.openLines, pair.userA, pair.userB);
      const openBToA = sumDirection(pair.openLines, pair.userB, pair.userA);
      const settledAToB = sumDirection(pair.settledLines, pair.userA, pair.userB);
      const settledBToA = sumDirection(pair.settledLines, pair.userB, pair.userA);
      const totalAToB = roundMoney(openAToB + settledAToB);
      const totalBToA = roundMoney(openBToA + settledBToA);

      const openDelta = roundMoney(openAToB - openBToA);
      const netAmount = Math.abs(openDelta) > 0.005 ? Math.abs(openDelta) : 0;
      const netFrom = openDelta > 0.005 ? pair.userA : openDelta < -0.005 ? pair.userB : null;
      const netTo = openDelta > 0.005 ? pair.userB : openDelta < -0.005 ? pair.userA : null;

      const displayDelta = roundMoney(totalAToB - totalBToA);
      const displayAmount = Math.abs(displayDelta) > 0.005 ? Math.abs(displayDelta) : 0;
      const displayFrom = displayDelta > 0.005 ? pair.userA : displayDelta < -0.005 ? pair.userB : null;
      const displayTo = displayDelta > 0.005 ? pair.userB : displayDelta < -0.005 ? pair.userA : null;

      const settledAmount = roundMoney(pair.settledLines.reduce((sum, line) => sum + line.amount, 0));
      const isSettled = netAmount <= 0.005 && settledAmount > 0.005 && displayAmount > 0.005;
      const hasNetting = totalAToB > 0.005 && totalBToA > 0.005;

      return {
        pairId,
        userA: pair.userA,
        userB: pair.userB,
        openAToB,
        openBToA,
        totalAToB,
        totalBToA,
        settledAmount,
        latestDate: pair.latestDate,
        openLines: [...pair.openLines].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        settledLines: [...pair.settledLines].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        netAmount,
        netFrom,
        netTo,
        displayAmount,
        displayFrom,
        displayTo,
        isSettled,
        hasNetting,
      } satisfies DebtPair;
    })
    .filter((pair) => pair.netAmount > 0.005 || pair.settledAmount > 0.005)
    .sort((a, b) => {
      if (a.isSettled !== b.isSettled) return a.isSettled ? 1 : -1;
      const amountDiff = (b.netAmount || b.displayAmount) - (a.netAmount || a.displayAmount);
      if (Math.abs(amountDiff) > 0.005) return amountDiff;
      return new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime();
    });
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

// ─── Participant editor ────────────────────────────────────────────────────────
function ParticipantEditor({ users, participants, setParticipants, amount }: {
  users: User[];
  participants: Participant[];
  setParticipants: (p: Participant[]) => void;
  amount: string;
}) {
  const totalPercent = participants.reduce((sum, participant) => sum + participant.percent, 0);

  const toggleUser = (userId: string) => {
    const activeIds = participants
      .filter((participant) => participant.percent > 0)
      .map((participant) => participant.userId);
    const isActive = activeIds.includes(userId);

    if (isActive && activeIds.length === 1) return;

    const nextActiveIds = isActive
      ? activeIds.filter((id) => id !== userId)
      : [...activeIds, userId];

    setParticipants(buildEqualParticipants(users, nextActiveIds));
  };

  const setPercent = (userId: string, value: number) => {
    const sanitized = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
    setParticipants(
      participants.map((participant) => (
        participant.userId === userId ? { ...participant, percent: sanitized } : participant
      ))
    );
  };

  const distribute = () => {
    const activeIds = participants
      .filter((participant) => participant.percent > 0)
      .map((participant) => participant.userId);

    if (!activeIds.length) return;
    setParticipants(buildEqualParticipants(users, activeIds));
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Aufteilen auf</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 12,
              color: Math.abs(totalPercent - 100) > 0.1 ? 'var(--danger)' : 'var(--accent)',
              fontFamily: 'DM Mono',
              fontWeight: 700,
            }}
          >
            {totalPercent.toFixed(1)}%
          </span>
          <button
            type="button"
            onClick={distribute}
            style={{
              fontSize: 13,
              color: 'var(--text)',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '8px 12px',
              cursor: 'pointer',
              fontWeight: 700,
              boxShadow: '0 1px 0 rgba(255,255,255,0.04) inset',
            }}
          >
            Gleichmäßig verteilen
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {users.map((user) => {
          const participant = participants.find((item) => item.userId === user.id);
          const isActive = (participant?.percent ?? 0) > 0;
          const shareAmount = amount ? parseFloat(amount.replace(',', '.') || '0') * (participant?.percent ?? 0) / 100 : 0;

          return (
            <div key={user.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                type="button"
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

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: isActive ? 1 : 0.5 }}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  disabled={!isActive}
                  value={participant?.percent.toFixed(1) ?? '0.0'}
                  onChange={(e) => setPercent(user.id, parseFloat(e.target.value) || 0)}
                  style={{
                    width: 72,
                    background: isActive ? 'var(--surface2)' : 'rgba(255,255,255,0.04)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    color: 'var(--text)',
                    padding: '6px 8px',
                    fontSize: 16,
                    outline: 'none',
                    textAlign: 'right',
                    fontFamily: 'DM Mono',
                    cursor: isActive ? 'text' : 'not-allowed',
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
                    {fmt(shareAmount)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── BOTTOM SHEET WRAPPER ─────────────────────────────────────────────────────
function BottomSheet({ onClose, title, children }: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 200,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'var(--surface)',
          borderRadius: '20px 20px 0 0',
          width: '100%',
          maxWidth: 480,
          padding: '24px 20px 40px',
          maxHeight: '90vh',
          overflowY: 'auto',
          borderTop: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700 }}>{title}</h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── PROFILE PANEL ────────────────────────────────────────────────────────────
function ProfilePanel({ currentUser, token, onClose, onLogout, onProfileUpdated }: {
  currentUser: User;
  token: string;
  onClose: () => void;
  onLogout: () => void;
  onProfileUpdated: (token: string, user: User) => void;
}) {
  const [name, setName] = useState(currentUser.name);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setError('');
    setSuccess('');

    const payload: Record<string, string> = {};
    if (name.trim() && name.trim() !== currentUser.name) payload.name = name.trim();
    if (newPw) {
      payload.currentPassword = currentPw;
      payload.newPassword = newPw;
    }

    if (!Object.keys(payload).length) {
      setError('Keine Änderungen');
      return;
    }

    setLoading(true);
    const data = await api('/api/profile', { method: 'PUT', body: JSON.stringify(payload) }, token);
    setLoading(false);

    if (data.error) {
      setError(data.error);
      return;
    }

    setSuccess('Profil aktualisiert!');
    setCurrentPw('');
    setNewPw('');
    onProfileUpdated(data.token, data.user);
  };

  return (
    <BottomSheet onClose={onClose} title="Profil">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />

        <div style={{ height: 1, background: 'var(--border)' }} />

        <p style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>PASSWORT ÄNDERN</p>
        <Input
          label="Aktuelles Passwort"
          type="password"
          value={currentPw}
          onChange={(e) => setCurrentPw(e.target.value)}
        />
        <Input
          label="Neues Passwort"
          type="password"
          value={newPw}
          onChange={(e) => setNewPw(e.target.value)}
        />

        {error && <p style={{ color: 'var(--danger)', fontSize: 14, fontWeight: 600 }}>{error}</p>}
        {success && <p style={{ color: 'var(--accent)', fontSize: 14, fontWeight: 600 }}>✓ {success}</p>}

        <Btn onClick={handleSave} disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Speichert…' : 'Änderungen speichern'}
        </Btn>

        <div style={{ height: 1, background: 'var(--border)' }} />

        <Btn variant="danger" onClick={onLogout} style={{ width: '100%' }}>
          Abmelden
        </Btn>
      </div>
    </BottomSheet>
  );
}

// ─── EVENTS PANEL ─────────────────────────────────────────────────────────────
function EventsPanel({ events, currentUser, token, onSelectEvent, onClose, onEventsChanged }: {
  events: SplitlyEvent[];
  currentUser: User;
  token: string;
  onSelectEvent: (event: SplitlyEvent) => void;
  onClose: () => void;
  onEventsChanged: (events: SplitlyEvent[]) => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [newName, setNewName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) { setError('Name fehlt'); return; }
    setLoading(true); setError('');
    const data = await api('/api/events', { method: 'POST', body: JSON.stringify({ name: newName }) }, token);
    setLoading(false);
    if (data.error) { setError(data.error); return; }
    const updated = [...events, data];
    onEventsChanged(updated);
    setNewName('');
    setShowCreate(false);
  };

  const handleJoin = async () => {
    if (!joinCode.trim()) { setError('Code fehlt'); return; }
    setLoading(true); setError('');
    const data = await api('/api/events', { method: 'POST', body: JSON.stringify({ code: joinCode.trim().toUpperCase() }) }, token);
    setLoading(false);
    if (data.error) { setError(data.error); return; }
    const exists = events.some((e) => e.id === data.id);
    const updated = exists ? events.map((e) => e.id === data.id ? data : e) : [...events, data];
    onEventsChanged(updated);
    setJoinCode('');
    setShowJoin(false);
  };

  const handleRename = async (id: string) => {
    if (!renameName.trim()) return;
    setLoading(true);
    const data = await api('/api/events', { method: 'PUT', body: JSON.stringify({ id, name: renameName }) }, token);
    setLoading(false);
    if (!data.error) {
      onEventsChanged(events.map((e) => e.id === id ? { ...e, name: renameName.trim() } : e));
      setRenamingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    setLoading(true);
    await api('/api/events', { method: 'DELETE', body: JSON.stringify({ id }) }, token);
    setLoading(false);
    onEventsChanged(events.filter((e) => e.id !== id));
    setDeletingId(null);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg)',
        zIndex: 200,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          position: 'sticky',
          top: 0,
          background: 'rgba(15,15,16,0.95)',
          backdropFilter: 'blur(10px)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>Meine Events</h2>
        {events.length > 0 && (
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer', fontFamily: 'DM Sans' }}
          >
            Schließen ✕
          </button>
        )}
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', width: '100%', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {events.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--muted)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
            <p style={{ marginBottom: 4 }}>Noch keine Events</p>
            <p style={{ fontSize: 13 }}>Erstelle ein neues Event oder tritt einem bestehenden bei.</p>
          </div>
        )}

        {events.map((ev) => (
          <div key={ev.id}>
            {renamingId === ev.id ? (
              <Card>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <Input label="Neuer Name" value={renameName} onChange={(e) => setRenameName(e.target.value)} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn variant="ghost" onClick={() => setRenamingId(null)} style={{ flex: 1 }}>Abbrechen</Btn>
                    <Btn onClick={() => handleRename(ev.id)} disabled={loading} style={{ flex: 1 }}>Speichern</Btn>
                  </div>
                </div>
              </Card>
            ) : deletingId === ev.id ? (
              <Card style={{ borderColor: 'rgba(248,113,113,0.3)' }}>
                <p style={{ fontWeight: 700, marginBottom: 6 }}>Event löschen?</p>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
                  „{ev.name}" wird unwiderruflich gelöscht.
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn variant="ghost" onClick={() => setDeletingId(null)} style={{ flex: 1 }}>Abbrechen</Btn>
                  <Btn variant="danger" onClick={() => handleDelete(ev.id)} disabled={loading} style={{ flex: 1 }}>Löschen</Btn>
                </div>
              </Card>
            ) : (
              <button
                onClick={() => onSelectEvent(ev)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: '16px 18px',
                  cursor: 'pointer',
                  transition: 'border-color .2s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{ev.name}</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          fontFamily: 'DM Mono',
                          fontSize: 13,
                          color: 'var(--accent)',
                          background: 'rgba(110,231,183,0.1)',
                          border: '1px solid rgba(110,231,183,0.25)',
                          borderRadius: 6,
                          padding: '2px 8px',
                          letterSpacing: '0.1em',
                        }}
                      >
                        {ev.code}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {ev.memberIds.length} Mitglieder
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    {ev.creatorId === currentUser.id && (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); setRenamingId(ev.id); setRenameName(ev.name); setError(''); }}
                          title="Umbenennen"
                          style={{
                            background: 'var(--surface2)',
                            border: '1px solid var(--border)',
                            borderRadius: 7,
                            color: 'var(--text)',
                            padding: '5px 8px',
                            fontSize: 13,
                            cursor: 'pointer',
                          }}
                        >
                          ✏️
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeletingId(ev.id); setError(''); }}
                          title="Löschen"
                          style={{
                            background: 'rgba(248,113,113,0.1)',
                            border: '1px solid rgba(248,113,113,0.25)',
                            borderRadius: 7,
                            color: '#ffd3d3',
                            padding: '5px 8px',
                            fontSize: 13,
                            cursor: 'pointer',
                          }}
                        >
                          🗑
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </button>
            )}
          </div>
        ))}

        {error && <p style={{ color: 'var(--danger)', fontSize: 14, fontWeight: 600 }}>{error}</p>}

        {showCreate ? (
          <Card>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontWeight: 700 }}>Neues Event erstellen</p>
              <Input
                label="Event-Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="z.B. Urlaub 2026"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn variant="ghost" onClick={() => { setShowCreate(false); setNewName(''); setError(''); }} style={{ flex: 1 }}>Abbrechen</Btn>
                <Btn onClick={handleCreate} disabled={loading} style={{ flex: 1 }}>
                  {loading ? '…' : 'Erstellen'}
                </Btn>
              </div>
            </div>
          </Card>
        ) : showJoin ? (
          <Card>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontWeight: 700 }}>Event beitreten</p>
              <Input
                label="Event-Code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="z.B. RB2026"
                style={{ fontFamily: 'DM Mono', letterSpacing: '0.1em' }}
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn variant="ghost" onClick={() => { setShowJoin(false); setJoinCode(''); setError(''); }} style={{ flex: 1 }}>Abbrechen</Btn>
                <Btn onClick={handleJoin} disabled={loading} style={{ flex: 1 }}>
                  {loading ? '…' : 'Beitreten'}
                </Btn>
              </div>
            </div>
          </Card>
        ) : (
          <div style={{ display: 'flex', gap: 10 }}>
            <Btn onClick={() => { setShowCreate(true); setShowJoin(false); setError(''); }} style={{ flex: 1 }}>
              + Event erstellen
            </Btn>
            <Btn variant="ghost" onClick={() => { setShowJoin(true); setShowCreate(false); setError(''); }} style={{ flex: 1 }}>
              Code eingeben
            </Btn>
          </div>
        )}
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
function AddExpenseTab({ users, currentUser, token, eventId, onAdded }: {
  users: User[];
  currentUser: User;
  token: string;
  eventId: string;
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

  // Reset participants when users list changes
  useEffect(() => {
    setParticipants(users.map((user) => ({ userId: user.id, percent: 100 / users.length })));
  }, [users]);

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
        eventId,
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
            style={{ background: 'none', border: 'none', color: 'var(--text)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}
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
  const actorCanToggle = !!pair.displayTo && currentUser.id === pair.displayTo;
  const actionEntries = pair.isSettled ? pair.settledLines : pair.openLines;

  const handleTogglePair = async () => {
    if (!actionEntries.length) return;

    setLoading(true);
    const data = await api('/api/settled', {
      method: 'POST',
      body: JSON.stringify({
        entries: actionEntries.map((line) => ({ id: line.expenseId, debtorUserId: line.from })),
      }),
    }, token);
    setLoading(false);

    if (!data.error) {
      onRefresh();
      onClose();
    }
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
            <h3 style={{ fontSize: 18, fontWeight: 700 }}>Schulden-Details</h3>
            {pair.displayFrom && pair.displayTo ? (
              <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>
                {pair.isSettled ? (
                  <>
                    <span style={{ color: 'var(--text)', fontWeight: 700 }}>{getName(pair.displayFrom)} → {getName(pair.displayTo)}</span> · {fmt(pair.displayAmount)} <span style={{ color: 'var(--accent)', fontWeight: 700 }}>beglichen</span>
                  </>
                ) : (
                  <>
                    {getName(pair.displayFrom)} schuldet {getName(pair.displayTo)} aktuell <span style={{ color: 'var(--text)', fontWeight: 700 }}>{fmt(pair.netAmount)}</span>
                  </>
                )}
              </p>
            ) : (
              <p style={{ fontSize: 14, color: 'var(--muted)', marginTop: 4 }}>Diese Schulden sind aktuell vollständig verrechnet.</p>
            )}
          </div>

          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        <Card style={{ marginBottom: 16, padding: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pair.hasNetting ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: 'var(--muted)' }}>{getName(pair.userA)} → {getName(pair.userB)}</span>
                  <span style={{ fontFamily: 'DM Mono', fontWeight: 700, color: pair.totalAToB > 0 ? 'var(--text)' : 'var(--muted)' }}>
                    {fmt(pair.totalAToB)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: 'var(--muted)' }}>{getName(pair.userB)} → {getName(pair.userA)}</span>
                  <span style={{ fontFamily: 'DM Mono', fontWeight: 700, color: pair.totalBToA > 0 ? 'var(--text)' : 'var(--muted)' }}>
                    {fmt(pair.totalBToA)}
                  </span>
                </div>
                {pair.displayFrom && pair.displayTo && (
                  <div
                    style={{
                      marginTop: 6,
                      paddingTop: 10,
                      borderTop: '1px solid var(--border)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <span style={{ color: 'var(--text)', fontWeight: 700 }}>
                      Nach Verrechnung bleibt {pair.isSettled ? 'übrig gewesen' : 'offen'}
                    </span>
                    <span style={{ fontFamily: 'DM Mono', fontWeight: 700, color: pair.isSettled ? 'var(--muted)' : 'var(--accent)' }}>
                      {getName(pair.displayFrom)} → {getName(pair.displayTo)} · {fmt(pair.displayAmount)}
                    </span>
                  </div>
                )}
              </>
            ) : pair.displayFrom && pair.displayTo ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: 'var(--text)', fontWeight: 700 }}>{getName(pair.displayFrom)} → {getName(pair.displayTo)}</span>
                <span style={{ fontFamily: 'DM Mono', fontWeight: 700, color: pair.isSettled ? 'var(--muted)' : 'var(--accent)' }}>
                  {fmt(pair.displayAmount)}
                </span>
              </div>
            ) : (
              <p style={{ color: 'var(--muted)', fontSize: 14 }}>Keine offene Schuld mehr vorhanden.</p>
            )}
          </div>
        </Card>

        {pair.displayFrom && pair.displayTo && (
          actorCanToggle ? (
            <Btn
              onClick={handleTogglePair}
              disabled={loading || !actionEntries.length}
              style={{ width: '100%', minHeight: 48, fontSize: 15, fontWeight: 700 }}
              variant={pair.isSettled ? 'ghost' : 'primary'}
            >
              {loading ? 'Wird gespeichert…' : pair.isSettled ? 'Begleichung rückgängig machen' : 'Schuld als beglichen markieren'}
            </Btn>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>
              Nur {getName(pair.displayTo)} kann diesen Status ändern.
            </p>
          )
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

  const activePairs = debtPairs.filter((pair) => !pair.isSettled && pair.netAmount > 0.005);
  const settledPairs = debtPairs.filter((pair) => pair.isSettled);

  const myDebts = activePairs.filter((pair) => pair.netFrom === currentUser.id);
  const owedToMe = activePairs.filter((pair) => pair.netTo === currentUser.id);
  const otherDebts = activePairs.filter((pair) => pair.netFrom !== currentUser.id && pair.netTo !== currentUser.id);
  const settledForMe = settledPairs.filter((pair) => pair.displayFrom === currentUser.id || pair.displayTo === currentUser.id);
  const settledOther = settledPairs.filter((pair) => pair.displayFrom !== currentUser.id && pair.displayTo !== currentUser.id);

  const PairRow = ({ pair, emphasize }: { pair: DebtPair; emphasize: 'danger' | 'accent' | 'neutral' | 'settled' }) => {
    const accentColor =
      emphasize === 'danger' ? 'var(--danger)' :
      emphasize === 'accent' ? 'var(--accent)' :
      emphasize === 'settled' ? 'var(--muted)' :
      'var(--text)';

    return (
      <button
        onClick={() => setSelectedPair(pair)}
        style={{
          borderRadius: 12,
          background: pair.isSettled ? 'rgba(255,255,255,0.03)' : 'var(--surface2)',
          border: `1px solid ${pair.isSettled ? 'rgba(255,255,255,0.08)' : 'var(--border)'}`,
          overflow: 'hidden',
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          padding: '14px 16px',
          opacity: pair.isSettled ? 0.72 : 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: pair.isSettled ? 'var(--muted)' : 'var(--text)' }}>
                {pair.displayFrom ? getName(pair.displayFrom) : getName(pair.userA)}
              </span>
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>→</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: pair.isSettled ? 'var(--muted)' : 'var(--text)' }}>
                {pair.displayTo ? getName(pair.displayTo) : getName(pair.userB)}
              </span>
              {pair.isSettled && (
                <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.05)', color: 'var(--muted)', borderRadius: 999, padding: '2px 8px', fontWeight: 700 }}>
                  Beglichen
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
              {pair.hasNetting && (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  Verrechnet.
                </span>
              )}
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Tippen für Details</span>
            </div>
          </div>

          <span style={{ fontFamily: 'DM Mono', fontWeight: 700, fontSize: 16, color: accentColor, flexShrink: 0 }}>
            {fmt(pair.isSettled ? pair.displayAmount : pair.netAmount)}
          </span>
        </div>
      </button>
    );
  };

  if (!debtPairs.length) {
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

      {settledForMe.length > 0 && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 8 }}>
            Beglichen
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {settledForMe.map((pair) => (
              <PairRow key={pair.pairId} pair={pair} emphasize="settled" />
            ))}
          </div>
        </div>
      )}

      {settledOther.length > 0 && (
        <div>
          <p style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 8 }}>
            Weitere beglichene Schulden
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {settledOther.map((pair) => (
              <PairRow key={pair.pairId} pair={pair} emphasize="settled" />
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
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [events, setEvents] = useState<SplitlyEvent[]>([]);
  const [currentEvent, setCurrentEvent] = useState<SplitlyEvent | null>(null);
  const [tab, setTab] = useState<'add' | 'activity' | 'debts'>('add');
  const [loadingData, setLoadingData] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showEvents, setShowEvents] = useState(false);

  // Users filtered to current event members
  const users = useMemo(() => {
    if (!currentEvent) return allUsers;
    return allUsers.filter((u) => currentEvent.memberIds.includes(u.id));
  }, [allUsers, currentEvent]);

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');

    if (storedToken && storedUser) {
      setToken(storedToken);
      setCurrentUser(JSON.parse(storedUser));
    }
  }, []);

  const loadEvents = useCallback(async (currentToken: string) => {
    const loadedEvents = await api('/api/events', undefined, currentToken);
    if (Array.isArray(loadedEvents)) {
      setEvents(loadedEvents);

      // Restore last selected event
      const lastEventId = localStorage.getItem('lastEventId');
      const lastEvent = loadedEvents.find((e: SplitlyEvent) => e.id === lastEventId);
      if (lastEvent) {
        setCurrentEvent(lastEvent);
      } else if (loadedEvents.length === 0) {
        setShowEvents(true);
      }
      return loadedEvents as SplitlyEvent[];
    }
    return [];
  }, []);

  const loadData = useCallback(async (currentToken: string, eventId?: string) => {
    setLoadingData(true);

    const [loadedUsers, loadedExpenses] = await Promise.all([
      api('/api/users'),
      api(`/api/expenses${eventId ? `?eventId=${eventId}` : ''}`, undefined, currentToken),
    ]);

    if (Array.isArray(loadedUsers)) setAllUsers(loadedUsers);
    if (Array.isArray(loadedExpenses)) setExpenses(loadedExpenses);

    setLoadingData(false);
  }, []);

  useEffect(() => {
    if (token) {
      loadEvents(token).then((loadedEvents) => {
        const lastEventId = localStorage.getItem('lastEventId');
        const lastEvent = loadedEvents.find((e) => e.id === lastEventId);
        loadData(token, lastEvent?.id);
      });
    }
  }, [token, loadEvents, loadData]);

  // Reload expenses when event changes
  useEffect(() => {
    if (token && currentEvent) {
      loadData(token, currentEvent.id);
    }
  }, [currentEvent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLogin = (nextToken: string, user: User) => {
    localStorage.setItem('token', nextToken);
    localStorage.setItem('user', JSON.stringify(user));
    setToken(nextToken);
    setCurrentUser(user);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('lastEventId');
    setToken(null);
    setCurrentUser(null);
    setAllUsers([]);
    setExpenses([]);
    setEvents([]);
    setCurrentEvent(null);
    setShowProfile(false);
    setShowEvents(false);
  };

  const handleSelectEvent = (event: SplitlyEvent) => {
    setCurrentEvent(event);
    localStorage.setItem('lastEventId', event.id);
    setShowEvents(false);
    if (token) loadData(token, event.id);
  };

  const handleProfileUpdated = (newToken: string, user: User) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(user));
    setToken(newToken);
    setCurrentUser(user);
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

      {showProfile && (
        <ProfilePanel
          currentUser={currentUser}
          token={token}
          onClose={() => setShowProfile(false)}
          onLogout={handleLogout}
          onProfileUpdated={handleProfileUpdated}
        />
      )}

      {showEvents && (
        <EventsPanel
          events={events}
          currentUser={currentUser}
          token={token}
          onSelectEvent={handleSelectEvent}
          onClose={() => setShowEvents(false)}
          onEventsChanged={setEvents}
        />
      )}

      {/* Header */}
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
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(15,15,16,0.92)',
          backdropFilter: 'blur(10px)',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
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

        {/* Current event indicator */}
        {currentEvent && (
          <span
            style={{
              fontSize: 12,
              color: 'var(--muted)',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '3px 8px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 120,
              flex: 1,
              textAlign: 'center',
            }}
          >
            {currentEvent.name}
          </span>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* Events button */}
          <button
            onClick={() => setShowEvents(true)}
            title="Events"
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
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            ⊞ Events
          </button>

          {/* Profile button */}
          <button
            onClick={() => setShowProfile(true)}
            title="Profil"
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
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              textDecoration: 'underline',
              textDecorationColor: 'rgba(110,231,183,0.5)',
              textUnderlineOffset: 3,
            }}
          >
            {currentUser.name} ▾
          </button>
        </div>
      </div>

      {/* Main content */}
      {!currentEvent ? (
        <div
          style={{
            paddingTop: 72,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            flexDirection: 'column',
            gap: 16,
            padding: '90px 20px 40px',
            textAlign: 'center',
            color: 'var(--muted)',
          }}
        >
          <div style={{ fontSize: 40 }}>⊞</div>
          <p style={{ fontWeight: 700, color: 'var(--text)', fontSize: 16 }}>Kein Event ausgewählt</p>
          <p style={{ fontSize: 14 }}>Wähle ein Event aus oder erstelle ein neues.</p>
          <Btn onClick={() => setShowEvents(true)}>Events öffnen</Btn>
        </div>
      ) : (
        <>
          <div style={{ paddingTop: 72, paddingBottom: 86 }}>
            <div style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px' }}>
              {loadingData ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>Lädt…</div>
              ) : tab === 'add' ? (
                <AddExpenseTab
                  users={users}
                  currentUser={currentUser}
                  token={token}
                  eventId={currentEvent.id}
                  onAdded={() => loadData(token, currentEvent.id)}
                />
              ) : tab === 'activity' ? (
                <ActivityTab
                  expenses={expenses}
                  users={users}
                  currentUser={currentUser}
                  token={token}
                  onRefresh={() => loadData(token, currentEvent.id)}
                />
              ) : (
                <DebtsTab
                  expenses={expenses}
                  users={users}
                  currentUser={currentUser}
                  token={token}
                  onRefresh={() => loadData(token, currentEvent.id)}
                />
              )}
            </div>
          </div>

          {/* Bottom tab bar */}
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
      )}
    </>
  );
}
