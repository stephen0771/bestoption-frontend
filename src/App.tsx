import { FormEvent, useEffect, useMemo, useState } from 'react';

type Tab = 'overview' | 'trades' | 'watchlist' | 'transactions';
type Side = 'buy' | 'sell';
type TransactionType = 'deposit' | 'withdraw';

type User = {
  id: string;
  email: string;
  full_name: string;
  balance: number;
};

type Trade = {
  id: string;
  user_id: string;
  symbol: string;
  side: Side;
  quantity: number;
  price: number;
  status: 'open' | 'closed';
  realized_pnl: number;
  created_at: string;
  closed_at?: string;
};

type WatchlistItem = {
  id: string;
  symbol: string;
  market: string;
  created_at: string;
};

type Transaction = {
  id: string;
  type: TransactionType;
  amount: number;
  note: string;
  created_at: string;
};

type MarketPrices = Record<string, number>;

type DataState = {
  profile: User | null;
  trades: Trade[];
  transactions: Transaction[];
  watchlist: WatchlistItem[];
  markets: { prices: MarketPrices };
};

const INITIAL_MARKETS = {
  prices: {
    AAPL: 214.8,
    MSFT: 449.6,
    NVDA: 127.4,
    EURUSD: 1.09,
    GBPUSD: 1.27,
    BTCUSD: 61840.0,
    ETHUSD: 3480.0,
    XAUUSD: 2314.5,
  },
};

const API_BASE = import.meta.env.VITE_API_URL || 'https://bestoption-backend-1.onrender.com/api';

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPct(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [token, setToken] = useState<string>(() => localStorage.getItem('bestoption-token') ?? '');
  const [authForm, setAuthForm] = useState({ email: '', password: '', fullName: '' });
  const [tradeForm, setTradeForm] = useState({ symbol: 'AAPL', side: 'buy' as Side, quantity: 10, price: 214.8 });
  const [watchForm, setWatchForm] = useState({ symbol: 'BTCUSD', market: 'Crypto' });
  const [txForm, setTxForm] = useState({ type: 'deposit' as TransactionType, amount: 500 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<DataState>({
    profile: null,
    trades: [],
    transactions: [],
    watchlist: [],
    markets: INITIAL_MARKETS,
  });

  const summary = useMemo(() => {
    const openTrades = data.trades.filter((trade) => trade.status === 'open').length;
    const closedTrades = data.trades.filter((trade) => trade.status === 'closed').length;
    const realizedPnl = data.trades.reduce((sum, trade) => sum + trade.realized_pnl, 0);
    const latestBalance = data.profile?.balance ?? 0;
    return { openTrades, closedTrades, realizedPnl, latestBalance };
  }, [data]);

  useEffect(() => {
    if (token) {
      void refreshDashboard();
    }
  }, [token]);

  async function apiRequest<T>(path: string, options: RequestInit = {}, authToken = token): Promise<T> {
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if (authToken) {
      headers.set('Authorization', `Bearer ${authToken}`);
    }
    if (options.body && !(options.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || 'Request failed');
    }

    return response.json() as Promise<T>;
  }

  async function refreshDashboard() {
    if (!token) {
      return;
    }

    setLoading(true);
    try {
      const [profile, trades, transactions, watchlist, markets] = await Promise.all([
        apiRequest<{ id: string; email: string; full_name: string; balance: number }>('/profile'),
        apiRequest<Trade[]>('/trades'),
        apiRequest<Transaction[]>('/transactions'),
        apiRequest<WatchlistItem[]>('/watchlist'),
        apiRequest<{ prices: MarketPrices }>('/markets'),
      ]);

      setData({
        profile,
        trades,
        transactions,
        watchlist,
        markets: markets ?? INITIAL_MARKETS,
      });
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }

  async function handleAuth(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const endpoint = authMode === 'login' ? '/auth/login' : '/auth/signup';
      const payload = {
        email: authForm.email,
        password: authForm.password,
        full_name: authForm.fullName,
      };
      const result = await apiRequest<{ token: string; user: User }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      }, '');

      localStorage.setItem('bestoption-token', result.token);
      setToken(result.token);
      setAuthForm({ email: '', password: '', fullName: '' });
      setTab('overview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem('bestoption-token');
    setToken('');
    setData({ profile: null, trades: [], transactions: [], watchlist: [], markets: INITIAL_MARKETS });
    setTab('overview');
    setError('');
  }

  async function handleTradeSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) {
      return;
    }

    try {
      await apiRequest('/trades', {
        method: 'POST',
        body: JSON.stringify({
          symbol: tradeForm.symbol,
          side: tradeForm.side,
          quantity: tradeForm.quantity,
          price: tradeForm.price,
        }),
      });
      await refreshDashboard();
      setTradeForm({ ...tradeForm, quantity: 10, price: data.markets.prices[tradeForm.symbol.toUpperCase()] ?? 100 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create trade');
    }
  }

  async function closeTrade(tradeId: string) {
    try {
      await apiRequest(`/trades/${tradeId}/close`, { method: 'POST' });
      await refreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close trade');
    }
  }

  async function deleteTrade(tradeId: string) {
    try {
      await apiRequest(`/trades/${tradeId}`, { method: 'DELETE' });
      await refreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete trade');
    }
  }

  async function handleWatchSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await apiRequest('/watchlist', {
        method: 'POST',
        body: JSON.stringify({
          symbol: watchForm.symbol,
          market: watchForm.market,
        }),
      });
      setWatchForm({ symbol: 'BTCUSD', market: 'Crypto' });
      await refreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add watchlist item');
    }
  }

  async function removeWatchlist(symbol: string) {
    try {
      await apiRequest(`/watchlist/${symbol}`, { method: 'DELETE' });
      await refreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove watchlist item');
    }
  }

  async function handleTransactionSubmit(event: FormEvent) {
    event.preventDefault();
    try {
      await apiRequest('/transactions', {
        method: 'POST',
        body: JSON.stringify({
          type: txForm.type,
          amount: txForm.amount,
          note: `${txForm.type} via dashboard`,
        }),
      });
      setTxForm({ type: 'deposit', amount: 500 });
      await refreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process transaction');
    }
  }

  if (!token) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="brand-block">
            <span className="eyebrow">BestOption</span>
            <h1>Paper Trading • Real Signals</h1>
            <p>Trade across digital assets, FX pairs, and equities with a clean, professional dashboard.</p>
          </div>

          <form onSubmit={handleAuth} className="auth-form">
            <div className="segmented-control">
              <button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>
                Log in
              </button>
              <button type="button" className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>
                Sign up
              </button>
            </div>

            {authMode === 'signup' && (
              <label>
                Full name
                <input
                  value={authForm.fullName}
                  onChange={(event) => setAuthForm((value) => ({ ...value, fullName: event.target.value }))}
                  placeholder="Alex Morgan"
                />
              </label>
            )}

            <label>
              Email
              <input
                type="email"
                value={authForm.email}
                onChange={(event) => setAuthForm((value) => ({ ...value, email: event.target.value }))}
                placeholder="you@example.com"
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={authForm.password}
                onChange={(event) => setAuthForm((value) => ({ ...value, password: event.target.value }))}
                placeholder="••••••••"
                required
              />
            </label>

            {error && <div className="error-banner">{error}</div>}

            <button type="submit" className="primary-button" disabled={loading}>
              {loading ? 'Please wait...' : authMode === 'login' ? 'Log in' : 'Create account'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const markets = Object.entries(data.markets.prices || INITIAL_MARKETS.prices);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="brand">BestOption</div>
          <nav className="nav">
            {['overview', 'trades', 'watchlist', 'transactions'].map((item) => (
              <button
                key={item}
                type="button"
                className={tab === item ? 'nav-item active' : 'nav-item'}
                onClick={() => setTab(item as Tab)}
              >
                {item.charAt(0).toUpperCase() + item.slice(1)}
              </button>
            ))}
          </nav>
        </div>

        <div className="sidebar-user">
          <div>
            <strong>{data.profile?.full_name || 'Trader'}</strong>
            <small>{data.profile?.email}</small>
          </div>
          <button type="button" className="secondary-button" onClick={logout}>
            Logout
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">Portfolio</p>
            <h2>Trading Dashboard</h2>
          </div>
          <div className="hero-balance">
            <span>Balance</span>
            <strong>{formatMoney(summary.latestBalance)}</strong>
          </div>
        </header>

        {error && <div className="error-banner">{error}</div>}

        {tab === 'overview' && (
          <section className="content-grid">
            <div className="stat-grid">
              <div className="stat-card accent">
                <span>Account balance</span>
                <strong>{formatMoney(summary.latestBalance)}</strong>
              </div>
              <div className="stat-card">
                <span>Open trades</span>
                <strong>{summary.openTrades}</strong>
              </div>
              <div className="stat-card">
                <span>Closed trades</span>
                <strong>{summary.closedTrades}</strong>
              </div>
              <div className="stat-card">
                <span>Realized P&amp;L</span>
                <strong className={summary.realizedPnl >= 0 ? 'positive' : 'negative'}>{formatMoney(summary.realizedPnl)}</strong>
              </div>
            </div>

            <div className="panel-grid">
              <div className="panel">
                <h3>Recent trades</h3>
                <ul className="list">
                  {data.trades.slice(0, 5).map((trade) => (
                    <li key={trade.id}>
                      <div>
                        <strong>{trade.symbol}</strong>
                        <span>{trade.side.toUpperCase()} • {trade.quantity} units</span>
                      </div>
                      <span className={trade.status === 'closed' ? 'positive' : ''}>{trade.status}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="panel">
                <h3>Market prices</h3>
                <ul className="market-list">
                  {markets.map(([symbol, price]) => (
                    <li key={symbol}>
                      <span>{symbol}</span>
                      <strong>{price.toLocaleString()}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}

        {tab === 'trades' && (
          <section className="content-grid">
            <div className="panel form-panel">
              <h3>Place trade</h3>
              <form onSubmit={handleTradeSubmit} className="stack-form">
                <div className="two-col">
                  <label>
                    Symbol
                    <input value={tradeForm.symbol} onChange={(event) => setTradeForm((value) => ({ ...value, symbol: event.target.value }))} />
                  </label>
                  <label>
                    Side
                    <select value={tradeForm.side} onChange={(event) => setTradeForm((value) => ({ ...value, side: event.target.value as Side }))}>
                      <option value="buy">Buy</option>
                      <option value="sell">Sell</option>
                    </select>
                  </label>
                </div>
                <div className="two-col">
                  <label>
                    Quantity
                    <input
                      type="number"
                      min={1}
                      value={tradeForm.quantity}
                      onChange={(event) => setTradeForm((value) => ({ ...value, quantity: Number(event.target.value) }))}
                    />
                  </label>
                  <label>
                    Price
                    <input
                      type="number"
                      step="0.01"
                      value={tradeForm.price}
                      onChange={(event) => setTradeForm((value) => ({ ...value, price: Number(event.target.value) }))}
                    />
                  </label>
                </div>
                <button type="submit" className="primary-button">Submit order</button>
              </form>
            </div>

            <div className="panel full-width-panel">
              <h3>Open positions</h3>
              <div className="trade-list">
                {data.trades.length === 0 ? (
                  <p>No trades yet.</p>
                ) : (
                  data.trades.map((trade) => (
                    <div key={trade.id} className="trade-row">
                      <div>
                        <strong>{trade.symbol}</strong>
                        <span>{trade.side.toUpperCase()} • {trade.quantity} x {formatMoney(trade.price)}</span>
                      </div>
                      <div className="trade-actions">
                        <span className={trade.status === 'closed' ? 'positive' : ''}>{trade.status}</span>
                        {trade.status === 'open' ? (
                          <button type="button" className="secondary-button" onClick={() => closeTrade(trade.id)}>
                            Close
                          </button>
                        ) : null}
                        <button type="button" className="danger-button" onClick={() => deleteTrade(trade.id)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}

        {tab === 'watchlist' && (
          <section className="content-grid">
            <div className="panel form-panel">
              <h3>Add market</h3>
              <form onSubmit={handleWatchSubmit} className="stack-form">
                <label>
                  Symbol
                  <input value={watchForm.symbol} onChange={(event) => setWatchForm((value) => ({ ...value, symbol: event.target.value }))} />
                </label>
                <label>
                  Market
                  <input value={watchForm.market} onChange={(event) => setWatchForm((value) => ({ ...value, market: event.target.value }))} />
                </label>
                <button type="submit" className="primary-button">Add to watchlist</button>
              </form>
            </div>

            <div className="panel full-width-panel">
              <h3>Tracked markets</h3>
              <div className="trade-list">
                {data.watchlist.length === 0 ? (
                  <p>No watchlist items yet.</p>
                ) : (
                  data.watchlist.map((item) => (
                    <div key={item.id} className="trade-row">
                      <div>
                        <strong>{item.symbol}</strong>
                        <span>{item.market}</span>
                      </div>
                      <button type="button" className="danger-button" onClick={() => removeWatchlist(item.symbol)}>
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}

        {tab === 'transactions' && (
          <section className="content-grid">
            <div className="panel form-panel">
              <h3>Funds</h3>
              <form onSubmit={handleTransactionSubmit} className="stack-form">
                <label>
                  Type
                  <select value={txForm.type} onChange={(event) => setTxForm((value) => ({ ...value, type: event.target.value as TransactionType }))}>
                    <option value="deposit">Deposit</option>
                    <option value="withdraw">Withdraw</option>
                  </select>
                </label>
                <label>
                  Amount
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    value={txForm.amount}
                    onChange={(event) => setTxForm((value) => ({ ...value, amount: Number(event.target.value) }))}
                  />
                </label>
                <button type="submit" className="primary-button">Process</button>
              </form>
            </div>

            <div className="panel full-width-panel">
              <h3>Transaction history</h3>
              <div className="trade-list">
                {data.transactions.length === 0 ? (
                  <p>No transactions yet.</p>
                ) : (
                  data.transactions.map((txn) => (
                    <div key={txn.id} className="trade-row">
                      <div>
                        <strong>{txn.type}</strong>
                        <span>{new Date(txn.created_at).toLocaleString()}</span>
                      </div>
                      <span className={txn.type === 'deposit' ? 'positive' : 'negative'}>{txn.type === 'deposit' ? '+' : '-'}{formatMoney(txn.amount)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
