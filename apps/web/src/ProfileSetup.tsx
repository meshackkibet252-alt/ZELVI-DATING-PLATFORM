
import { useEffect, useState, type FormEvent } from 'react'
import { apiRequest } from './lib/api'
import './ProfileSetup.css'

type Gender = 'MALE' | 'FEMALE' | 'NON_BINARY' | 'PREFER_NOT_TO_SAY'
type Intent = 'FRIENDSHIP' | 'DATING' | 'BOTH'

interface ProfileData {
  displayName: string
  city: string | null
  bio: string | null
  interests: string[]
  gender: Gender | null
  showGender: boolean
  relationshipIntent: Intent
  country: string
  countryCode: string
}

interface PreferencesData {
  minimumAge: number
  maximumAge: number
  preferredGenders: Gender[]
  preferredCountries: string[]
  excludedCountries: string[]
  preferredInterests: string[]
}

interface ProfileResponse {
  profile: ProfileData
}

interface PreferencesResponse {
  profile: {
    gender: Gender | null
    showGender: boolean
    relationshipIntent: Intent
  } | null
  preferences: PreferencesData
}

interface ProfileSetupProps {
  onComplete?: () => void
}

const genderOptions: { value: Gender; label: string }[] = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'NON_BINARY', label: 'Non-binary' },
  { value: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say' },
]

const intentOptions: { value: Intent; label: string; description: string }[] = [
  {
    value: 'FRIENDSHIP',
    label: 'Friendship',
    description: 'Meet people and build genuine friendships.',
  },
  {
    value: 'DATING',
    label: 'Dating',
    description: 'Discover meaningful romantic connections.',
  },
  {
    value: 'BOTH',
    label: 'Both',
    description: 'Stay open to friendship and dating.',
  },
]

function splitList(value: string): string[] {
  return [...new Set(
    value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean),
  )]
}

export default function ProfileSetup({ onComplete }: ProfileSetupProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [step, setStep] = useState(1)

  const [displayName, setDisplayName] = useState('')
  const [city, setCity] = useState('')
  const [bio, setBio] = useState('')
  const [interests, setInterests] = useState('')

  const [gender, setGender] = useState<Gender | ''>('')
  const [showGender, setShowGender] = useState(false)
  const [relationshipIntent, setRelationshipIntent] = useState<Intent>('BOTH')

  const [minimumAge, setMinimumAge] = useState(18)
  const [maximumAge, setMaximumAge] = useState(99)
  const [preferredGenders, setPreferredGenders] = useState<Gender[]>([])
  const [preferredCountries, setPreferredCountries] = useState('')
  const [excludedCountries, setExcludedCountries] = useState('')
  const [preferredInterests, setPreferredInterests] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadProfile() {
      try {
        const [profileResult, preferenceResult] = await Promise.all([
          apiRequest<ProfileResponse>('/api/profile/me'),
          apiRequest<PreferencesResponse>('/api/preferences/me'),
        ])

        if (cancelled) return

        const profile = profileResult.profile
        const preferences = preferenceResult.preferences

        setDisplayName(profile.displayName || '')
        setCity(profile.city || '')
        setBio(profile.bio || '')
        setInterests((profile.interests || []).join(', '))

        setGender(
          preferenceResult.profile?.gender || profile.gender || '',
        )
        setShowGender(
          preferenceResult.profile?.showGender ?? profile.showGender ?? false,
        )
        setRelationshipIntent(
          preferenceResult.profile?.relationshipIntent ||
          profile.relationshipIntent ||
          'BOTH',
        )

        setMinimumAge(preferences.minimumAge ?? 18)
        setMaximumAge(preferences.maximumAge ?? 99)
        setPreferredGenders(preferences.preferredGenders || [])
        setPreferredCountries((preferences.preferredCountries || []).join(', '))
        setExcludedCountries((preferences.excludedCountries || []).join(', '))
        setPreferredInterests((preferences.preferredInterests || []).join(', '))
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to load your profile.',
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadProfile()

    return () => {
      cancelled = true
    }
  }, [])

  function togglePreferredGender(value: Gender) {
    setPreferredGenders(previous =>
      previous.includes(value)
        ? previous.filter(item => item !== value)
        : [...previous, value],
    )
  }

async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (minimumAge < 18 || maximumAge > 99 || minimumAge > maximumAge) {
      setError('Choose a valid age range between 18 and 99.')
      setStep(3)
      return
    }
    if (splitList(interests).length > 20) {
      setError('You can add a maximum of 20 interests.')
      setStep(1)
      return
    }
    const preferred = splitList(preferredCountries).map(value => value.toUpperCase())
    const excluded = splitList(excludedCountries).map(value => value.toUpperCase())
    const invalidCountries = [...preferred, ...excluded].filter(
      country => !/^[A-Z]{2}$/.test(country),
    )
    if (invalidCountries.length > 0) {
      setError(`Invalid country code(s): ${invalidCountries.join(', ')}. Use two-letter codes such as KE or US.`)
      setStep(3)
      return
    }
    if (preferred.some(country => excluded.includes(country))) {
      setError('A country cannot be both preferred and excluded.')
      setStep(3)
      return
    }
    setSaving(true)
    try {
      await apiRequest('/api/profile/me', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: displayName.trim(),
          city: city.trim() || null,
          bio: bio.trim() || null,
          interests: splitList(interests),
        }),
      })
      try {
        await apiRequest('/api/preferences/me', {
          method: 'PATCH',
          body: JSON.stringify({
            gender: gender || null,
            showGender,
            relationshipIntent,
            minimumAge,
            maximumAge,
            preferredGenders,
            preferredCountries: preferred,
            excludedCountries: excluded,
            preferredInterests: splitList(preferredInterests),
          }),
        })
      } catch (preferenceError) {
        throw new Error(
          `Your basic profile was saved, but your discovery preferences were not. ${preferenceError instanceof Error ? preferenceError.message : 'Please try again.'}`,
        )
      }
      setSuccess('Your profile and discovery preferences have been saved.')
      onComplete?.()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to save your profile.',
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="profile-setup-loading">
        Loading your profile...
      </div>
    )
  }

  return (
    <section className="profile-setup">
      <header className="profile-setup-header">
        <span className="eyebrow">MAKE YOURSELF AT HOME</span>
        <h1>Build your ZELVI profile.</h1>
        <p>
          Tell people a little about yourself and choose the kind
          of connections you want to discover.
        </p>
      </header>

      <div className="profile-step-indicator">
        {[1, 2, 3].map(number => (
          <button
            type="button"
            key={number}
            className={step === number ? 'active' : step > number ? 'completed' : ''}
            onClick={() => setStep(number)}
          >
            <span>{number}</span>
            {number === 1 ? 'About you' : number === 2 ? 'Your identity' : 'Discovery'}
          </button>
        ))}
      </div>

      <form onSubmit={saveProfile} className="profile-setup-form">
        {step === 1 && (
          <div className="profile-setup-panel">
            <h2>Let's get to know you.</h2>
            <p className="profile-panel-description">
              Give people a first impression of who you are.
            </p>

            <label htmlFor="profile-name">Display name</label>
            <input
              id="profile-name"
              value={displayName}
              onChange={event => setDisplayName(event.target.value)}
              minLength={2}
              maxLength={40}
              required
            />

            <label htmlFor="profile-city">City</label>
            <input
              id="profile-city"
              value={city}
              onChange={event => setCity(event.target.value)}
              maxLength={80}
              placeholder="Your city"
            />

            <label htmlFor="profile-bio">About me</label>
            <textarea
              id="profile-bio"
              value={bio}
              onChange={event => setBio(event.target.value)}
              maxLength={500}
              rows={5}
              placeholder="Share something interesting about yourself..."
            />
            <small className="profile-character-count">{bio.length}/500 characters</small>

            <label htmlFor="profile-interests">My interests</label>
            <input
              id="profile-interests"
              value={interests}
              onChange={event => setInterests(event.target.value)}
              placeholder="Music, travel, technology, football"
            />
            <small>Separate interests with commas. Maximum 20.</small>

            <div className="profile-step-actions">
              <button type="button" className="profile-next" onClick={() => setStep(2)}>
                Continue â†’
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="profile-setup-panel">
            <h2>Your identity and intentions.</h2>
            <p className="profile-panel-description">
              Choose how you identify and what kind of relationships interest you.
            </p>

            <label htmlFor="profile-gender">Gender identity</label>
            <select
              id="profile-gender"
              value={gender}
              onChange={event => setGender(event.target.value as Gender | '')}
            >
              <option value="">Choose an option</option>
              {genderOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <label className="profile-checkbox">
              <input
                type="checkbox"
                checked={showGender}
                onChange={event => setShowGender(event.target.checked)}
              />
              Display my gender on my public profile
            </label>

            <label>What are you looking for?</label>
            <div className="intent-options">
              {intentOptions.map(option => (
                <button
                  type="button"
                  key={option.value}
                  className={relationshipIntent === option.value ? 'selected' : ''}
                  onClick={() => setRelationshipIntent(option.value)}
                >
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </button>
              ))}
            </div>

            <div className="profile-step-actions">
              <button type="button" className="profile-previous" onClick={() => setStep(1)}>
                â† Back
              </button>
              <button type="button" className="profile-next" onClick={() => setStep(3)}>
                Continue â†’
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="profile-setup-panel">
            <h2>Discover your kind of people.</h2>
            <p className="profile-panel-description">
              Set your discovery preferences. Empty country lists mean worldwide discovery.
            </p>

            <div className="profile-age-row">
              <div>
                <label htmlFor="minimum-age">Minimum age</label>
                <input
                  id="minimum-age"
                  type="number"
                  min={18}
                  max={99}
                  value={minimumAge}
                  onChange={event => setMinimumAge(Number(event.target.value))}
                  required
                />
              </div>
              <div>
                <label htmlFor="maximum-age">Maximum age</label>
                <input
                  id="maximum-age"
                  type="number"
                  min={18}
                  max={99}
                  value={maximumAge}
                  onChange={event => setMaximumAge(Number(event.target.value))}
                  required
                />
              </div>
            </div>

            <label>Preferred genders</label>
            <div className="profile-gender-options">
              {genderOptions.map(option => (
                <label className="profile-checkbox" key={option.value}>
                  <input
                    type="checkbox"
                    checked={preferredGenders.includes(option.value)}
                    onChange={() => togglePreferredGender(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <small>Leave all unchecked to include everyone.</small>

            <label htmlFor="preferred-countries">Preferred countries</label>
            <input
              id="preferred-countries"
              value={preferredCountries}
              onChange={event => setPreferredCountries(event.target.value)}
              placeholder="KE, UG, TZ, US"
            />
            <small>Use two-letter ISO country codes, separated by commas. Leave empty for worldwide discovery.</small>

            <label htmlFor="excluded-countries">Excluded countries</label>
            <input
              id="excluded-countries"
              value={excludedCountries}
              onChange={event => setExcludedCountries(event.target.value)}
              placeholder="None"
            />
            <small>Use two-letter ISO country codes, separated by commas.</small>

            <label htmlFor="preferred-interests">Interests you'd like to discover</label>
            <input
              id="preferred-interests"
              value={preferredInterests}
              onChange={event => setPreferredInterests(event.target.value)}
              placeholder="Travel, music, sports"
            />
            <small>Separate interests with commas. Leave empty for no additional interest filter.</small>

            <div className="profile-step-actions">
              <button type="button" className="profile-previous" onClick={() => setStep(2)}>
                â† Back
              </button>
              <button type="submit" className="profile-next" disabled={saving}>
                {saving ? 'Saving...' : 'Save my profile'}
              </button>
            </div>
          </div>
        )}

        {error && <div className="profile-form-error">{error}</div>}
        {success && <div className="profile-form-success">{success}</div>}
      </form>
    </section>
  )
}

