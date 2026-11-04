
import { useEffect, useState, type FormEvent } from 'react'
import './App.css'
import { apiRequest } from './lib/api'
import { useAuth } from './lib/AuthContext'
import ProfileSetup from './ProfileSetup'

type Screen = 'home' | 'login' | 'register' | 'verify' | 'dashboard' | 'profile'

interface RegistrationResponse {
  message: string
  welcomeCredits: number
}

interface VerificationRequestResponse {
  message: string
  verificationUrl?: string
}

function App() {
  const { user, profile, loading, isAuthenticated, login, logout } = useAuth()

  const [screen, setScreen] = useState<Screen>('home')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [country, setCountry] = useState('')
  const [countryCode, setCountryCode] = useState('')
  const [verificationUrl, setVerificationUrl] = useState('')

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token')

    if (token) {
      setScreen('verify')
      setBusy(true)

      apiRequest<{ message: string }>('/api/auth/verification/verify', {
        method: 'POST',
        body: JSON.stringify({ token }),
      })
        .then(response => {
          setSuccess(response.message)
          window.history.replaceState({}, '', window.location.pathname)
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => setBusy(false))
    }
  }, [])

  useEffect(() => {
    if (isAuthenticated) {
      setScreen('dashboard')
    }
  }, [isAuthenticated])

  function navigate(next: Screen) {
    setError('')
    setSuccess('')
    setScreen(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setBusy(true)

    try {
      await login(email, password)
      setPassword('')
      setScreen('dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to log in.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setVerificationUrl('')
    setBusy(true)

    try {
      await apiRequest<RegistrationResponse>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          displayName,
          dateOfBirth,
          country,
          countryCode,
        }),
      })

      const verification = await apiRequest<VerificationRequestResponse>(
        '/api/auth/verification/request',
        {
          method: 'POST',
          body: JSON.stringify({ email }),
        },
      )

      setVerificationUrl(verification.verificationUrl || '')
      setSuccess(
        'Your account has been created. Please verify your email before logging in.',
      )
      setPassword('')
      setScreen('verify')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.')
    } finally {
      setBusy(false)
    }
  }

  async function resendVerification() {
    setError('')
    setSuccess('')
    setVerificationUrl('')
    setBusy(true)

    try {
      const response = await apiRequest<VerificationRequestResponse>(
        '/api/auth/verification/request',
        {
          method: 'POST',
          body: JSON.stringify({ email }),
        },
      )

      setSuccess(response.message)
      setVerificationUrl(response.verificationUrl || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to resend instructions.')
    } finally {
      setBusy(false)
    }
  }

  function handleLogout() {
    logout()
    setEmail('')
    setPassword('')
    navigate('home')
  }

  if (loading) {
    return (
      <div className="app-loading">
        <span className="logo">ZELVI<span>.</span></span>
        <p>Preparing your experience...</p>
      </div>
    )
  }

  if (screen === 'dashboard' && isAuthenticated) {
    return (
      <main className="member-dashboard">
        <nav className="navbar">
          <a className="logo" href="#" onClick={event => event.preventDefault()}>
            ZELVI<span>.</span>
          </a>
          <button className="auth-secondary" onClick={handleLogout}>
            Log out
          </button>
        </nav>

        <section className="dashboard-welcome">
          <span className="eyebrow">WELCOME TO YOUR WORLD</span>
          <h1>Hello, {profile?.displayName || user?.email}.</h1>
          <p>Your next meaningful connection starts here.</p>

          <div className="dashboard-placeholder">
            <div className="dashboard-icon">â™¡</div>
            <h2>Your ZELVI journey begins.</h2>
            <p>
              Your account is active. We're building your discovery,
              matches and messaging experience.
            </p>
            <button className="primary-button" onClick={() => navigate('profile')}>
              Complete your profile →
            </button>
          </div>
        </section>
      </main>
    )
  }

  if (screen === 'profile' && isAuthenticated) {
    return (
      <main className="member-dashboard">
        <nav className="navbar">
          <a className="logo" href="#" onClick={event => event.preventDefault()}>
            ZELVI<span>.</span>
          </a>
          <button
            className="auth-secondary"
            onClick={() => navigate('dashboard')}
          >
            ← Back to dashboard
          </button>
        </nav>
        <ProfileSetup />
      </main>
    )
  }
  if (screen === 'login' || screen === 'register' || screen === 'verify') {
    return (
      <main className="auth-page">
        <header className="auth-header">
          <a className="logo" href="#" onClick={event => {
            event.preventDefault()
            navigate('home')
          }}>
            ZELVI<span>.</span>
          </a>
          <button className="auth-back" onClick={() => navigate('home')}>
            â† Back to home
          </button>
        </header>

        <section className="auth-layout">
          <div className="auth-story">
            <span className="eyebrow">YOUR WORLD. YOUR PEOPLE.</span>
            <h1>
              Every meaningful connection has a beginning.
            </h1>
            <p>
              Meet people across borders, discover shared interests
              and make room for something meaningful.
            </p>
            <div className="auth-story-note">
              <span>â™¡</span>
              <div>
                <strong>Find your people.</strong>
                <small>Friendship, dating and genuine connections.</small>
              </div>
            </div>
          </div>

          <div className="auth-card">
            {screen === 'login' && (
              <>
                <span className="eyebrow">WELCOME BACK</span>
                <h2>Log in to ZELVI</h2>
                <p className="auth-description">
                  Continue your journey and reconnect with your people.
                </p>

                <form onSubmit={handleLogin}>
                  <label htmlFor="login-email">Email address</label>
                  <input
                    id="login-email"
                    type="email"
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                  />

                  <label htmlFor="login-password">Password</label>
                  <div className="password-field">
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={event => setPassword(event.target.value)}
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      required
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}>
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>

                  {error && <div className="auth-error">{error}</div>}
                  {success && <div className="auth-success">{success}</div>}

                  <button className="auth-submit" type="submit" disabled={busy}>
                    {busy ? 'Logging in...' : 'Log in'}
                  </button>
                </form>

                <p className="auth-switch">
                  Don't have an account?{' '}
                  <button onClick={() => navigate('register')}>Join ZELVI</button>
                </p>
                <p className="auth-switch">
                  Need to verify your email?{' '}
                  <button onClick={() => navigate('verify')}>Verify email</button>
                </p>
              </>
            )}

            {screen === 'register' && (
              <>
                <span className="eyebrow">START YOUR JOURNEY</span>
                <h2>Create your account</h2>
                <p className="auth-description">
                  Join ZELVI and start discovering meaningful connections.
                </p>

                <form onSubmit={handleRegister}>
                  <label htmlFor="display-name">Your name</label>
                  <input
                    id="display-name"
                    value={displayName}
                    onChange={event => setDisplayName(event.target.value)}
                    placeholder="How should people know you?"
                    autoComplete="name"
                    minLength={2}
                    maxLength={40}
                    required
                  />

                  <label htmlFor="register-email">Email address</label>
                  <input
                    id="register-email"
                    type="email"
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                  />

                  <label htmlFor="register-password">Create password</label>
                  <div className="password-field">
                    <input
                      id="register-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={event => setPassword(event.target.value)}
                      placeholder="At least 8 characters"
                      minLength={8}
                      maxLength={72}
                      autoComplete="new-password"
                      required
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}>
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>

                  <label htmlFor="date-of-birth">Date of birth</label>
                  <input
                    id="date-of-birth"
                    type="date"
                    value={dateOfBirth}
                    onChange={event => setDateOfBirth(event.target.value)}
                    max={new Date(
                      Date.UTC(
                        new Date().getUTCFullYear() - 18,
                        new Date().getUTCMonth(),
                        new Date().getUTCDate(),
                      ),
                    ).toISOString().slice(0, 10)}
                    required
                  />

                  <div className="auth-field-row">
                    <div>
                      <label htmlFor="country">Country</label>
                      <input
                        id="country"
                        value={country}
                        onChange={event => setCountry(event.target.value)}
                        placeholder="e.g. Kenya"
                        maxLength={80}
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="country-code">Country code</label>
                      <input
                        id="country-code"
                        value={countryCode}
                        onChange={event => setCountryCode(event.target.value.toUpperCase())}
                        placeholder="KE"
                        minLength={2}
                        maxLength={2}
                        pattern="[A-Za-z]{2}"
                        required
                      />
                    </div>
                  </div>

                  <p className="auth-legal">
                    ZELVI is for adults aged 18 and above. By creating an
                    account, you agree to use the platform respectfully.
                  </p>

                  {error && <div className="auth-error">{error}</div>}
                  {success && <div className="auth-success">{success}</div>}

                  <button className="auth-submit" type="submit" disabled={busy}>
                    {busy ? 'Creating account...' : 'Create my account'}
                  </button>
                </form>

                <p className="auth-switch">
                  Already a member?{' '}
                  <button onClick={() => navigate('login')}>Log in</button>
                </p>
              </>
            )}

            {screen === 'verify' && (
              <>
                <div className="verification-icon">âœ‰</div>
                <span className="eyebrow">ONE MORE STEP</span>
                <h2>Verify your email</h2>
                <p className="auth-description">
                  Your account needs email verification before you can log in.
                  Enter the email address you registered with.
                </p>

                <form onSubmit={event => {
                  event.preventDefault()
                  void resendVerification()
                }}>
                  <label htmlFor="verification-email">Email address</label>
                  <input
                    id="verification-email"
                    type="email"
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    required
                  />

                  {error && <div className="auth-error">{error}</div>}
                  {success && <div className="auth-success">{success}</div>}

                  {verificationUrl && (
                    <div className="verification-link">
                      <strong>Development verification link</strong>
                      <a href={verificationUrl}>Verify my email address â†—</a>
                      <small>This link is available only in local development.</small>
                    </div>
                  )}

                  <button className="auth-submit" type="submit" disabled={busy}>
                    {busy ? 'Preparing...' : 'Send verification instructions'}
                  </button>
                </form>

                <p className="auth-switch">
                  Already verified?{' '}
                  <button onClick={() => navigate('login')}>Log in</button>
                </p>
              </>
            )}
          </div>
        </section>

        <footer className="auth-footer">
          <span>Â© 2026 ZELVI. All rights reserved.</span>
          <span>Find your people.</span>
        </footer>
      </main>
    )
  }

  return (
    <main>
      <nav className="navbar">
        <a className="logo" href="#">ZELVI<span>.</span></a>

        <div className="nav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#friendship">Friendship</a>
          <a href="#dating">Dating</a>
          <a href="#safety">Safety</a>
        </div>

        <div className="nav-actions">
          <button className="login" onClick={() => navigate('login')}>Log in</button>
          <button className="signup" onClick={() => navigate('register')}>Join ZELVI</button>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-content">
          <span className="eyebrow">YOUR WORLD. YOUR PEOPLE.</span>
          <h1>Meaningful connections <span>start here.</span></h1>
          <p>
            Meet new friends, discover meaningful relationships,
            and connect with people who make life more interesting.
          </p>

          <div className="hero-actions">
            <button onClick={() => navigate('register')} className="primary-button">
              Create your free account â†—
            </button>
            <a href="#how-it-works" className="secondary-button">
              Discover how it works
            </a>
          </div>

          <div className="social-proof">
            <div className="avatar-stack">
              <span>J</span><span>M</span><span>A</span><span>K</span>
            </div>
            <p>
              <strong>Your next connection is waiting.</strong>
              <br />Join a world of possibilities.
            </p>
          </div>
        </div>

        <div className="hero-visual global-visual">
          <div className="photo-collage">
            <img className="portrait portrait-main" src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=700&q=85" alt="Portrait of a woman" />
            <img className="portrait portrait-top" src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=500&q=85" alt="Portrait of a man" />
            <img className="portrait portrait-left" src="https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=500&q=85" alt="Portrait of a woman" />
            <img className="portrait portrait-right" src="https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=500&q=85" alt="Portrait of a man" />
            <img className="portrait portrait-bottom" src="https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=500&q=85" alt="Portrait of a woman" />

            <div className="global-label">
              <span>ðŸŒ</span>
              <div>
                <strong>One world. Many connections.</strong>
                <small>Meet people across cultures.</small>
              </div>
            </div>

            <div className="floating-card match-card">
              <span className="heart-icon">â™¥</span>
              <div>
                <strong>Something meaningful</strong>
                <small>It starts with a connection.</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="stats">
        <div><strong>01</strong><span>Create your profile</span></div>
        <div><strong>02</strong><span>Discover people</span></div>
        <div><strong>03</strong><span>Make connections</span></div>
        <div><strong>04</strong><span>Build relationships</span></div>
      </section>

      <section className="intro-section" id="how-it-works">
        <span className="eyebrow">CONNECTION WITHOUT BORDERS</span>
        <h2>More than just meeting people.</h2>
        <p>
          Whether you are looking for friendship or romance,
          ZELVI gives you a place to start something real.
        </p>

        <div className="feature-grid">
          <article className="feature-card friendship" id="friendship">
            <span className="feature-icon">âœ¦</span>
            <h3>Find your people.</h3>
            <p>Discover people with shared interests, make friends, and grow your social circle around the world.</p>
            <button onClick={() => navigate('register')}>Explore friendship â†—</button>
          </article>

          <article className="feature-card dating" id="dating">
            <span className="feature-icon">â™¥</span>
            <h3>Find meaningful love.</h3>
            <p>Meet people who share your relationship goals and discover where a genuine connection can lead.</p>
            <button onClick={() => navigate('register')}>Explore dating â†—</button>
          </article>
        </div>
      </section>

      <section className="safety-section" id="safety">
        <div>
          <span className="eyebrow">CONNECTION WITH CONFIDENCE</span>
          <h2>Your experience matters.</h2>
          <p>
            Your privacy, safety, and control are important.
            ZELVI is being built with tools to help members manage
            their connections and report inappropriate behaviour.
          </p>
        </div>
        <div className="safety-symbol">â™¡</div>
      </section>

      <section className="final-cta" id="signup">
        <span className="eyebrow">YOUR STORY STARTS HERE</span>
        <h2>Someone out there is waiting to meet you.</h2>
        <p>Make your next connection a meaningful one.</p>
        <button onClick={() => navigate('register')} className="primary-button">
          Join ZELVI for free â†—
        </button>
      </section>

      <footer>
        <a className="logo" href="#">ZELVI<span>.</span></a>
        <p>Find your people.</p>
        <small>Â© 2026 ZELVI. All rights reserved.</small>
      </footer>
    </main>
  )
}

export default App

