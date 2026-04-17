import { startTransition, useEffect, useMemo, useState } from 'react'
import './App.css'

type HealthResponse = {
  status: string
}

type GraphStatsResponse = {
  nodes: Record<string, number>
  relationships: Record<string, number>
  total_nodes: number
  total_relationships: number
}

type Condition = {
  snomed_id: string
  name: string
  triage_level: string | null
}

type Symptom = {
  symptom: string
  triage_level: string | null
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api'

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`)

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  return response.json() as Promise<T>
}

function formatCount(value: number) {
  return new Intl.NumberFormat('en-IN').format(value)
}

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [stats, setStats] = useState<GraphStatsResponse | null>(null)
  const [conditions, setConditions] = useState<Condition[]>([])
  const [selectedCondition, setSelectedCondition] = useState<Condition | null>(null)
  const [symptoms, setSymptoms] = useState<Symptom[]>([])
  const [query, setQuery] = useState('')
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true)
  const [isLoadingSymptoms, setIsLoadingSymptoms] = useState(false)
  const [dashboardError, setDashboardError] = useState<string | null>(null)
  const [symptomError, setSymptomError] = useState<string | null>(null)

  useEffect(() => {
    let isCancelled = false

    async function loadDashboard() {
      setIsLoadingDashboard(true)
      setDashboardError(null)

      try {
        const [healthResponse, statsResponse, conditionsResponse] = await Promise.all([
          fetchJson<HealthResponse>('/health'),
          fetchJson<GraphStatsResponse>('/graph/stats'),
          fetchJson<Condition[]>('/conditions?limit=120'),
        ])

        if (isCancelled) {
          return
        }

        startTransition(() => {
          setHealth(healthResponse)
          setStats(statsResponse)
          setConditions(conditionsResponse)
          setSelectedCondition(conditionsResponse[0] ?? null)
        })
      } catch (error) {
        if (!isCancelled) {
          setDashboardError(error instanceof Error ? error.message : 'Unable to load dashboard data')
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingDashboard(false)
        }
      }
    }

    void loadDashboard()

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedCondition) {
      setSymptoms([])
      return
    }

    const conditionId = selectedCondition.snomed_id
    let isCancelled = false

    async function loadSymptoms() {
      setIsLoadingSymptoms(true)
      setSymptomError(null)

      try {
        const result = await fetchJson<Symptom[]>(`/conditions/${conditionId}/symptoms`)

        if (!isCancelled) {
          startTransition(() => {
            setSymptoms(result)
          })
        }
      } catch (error) {
        if (!isCancelled) {
          setSymptomError(error instanceof Error ? error.message : 'Unable to load symptoms')
          setSymptoms([])
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingSymptoms(false)
        }
      }
    }

    void loadSymptoms()

    return () => {
      isCancelled = true
    }
  }, [selectedCondition])

  const filteredConditions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    if (!normalizedQuery) {
      return conditions
    }

    return conditions.filter((condition) =>
      condition.name.toLowerCase().includes(normalizedQuery),
    )
  }, [conditions, query])

  const topNodeGroups = useMemo(() => {
    if (!stats) {
      return []
    }

    return Object.entries(stats.nodes).sort((first, second) => second[1] - first[1])
  }, [stats])

  const topRelationshipGroups = useMemo(() => {
    if (!stats) {
      return []
    }

    return Object.entries(stats.relationships).sort((first, second) => second[1] - first[1])
  }, [stats])

  const severityTone = selectedCondition?.triage_level?.toLowerCase() ?? ''

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Clinical Knowledge Graph</p>
          <h1>BODHI Operations Console</h1>
          <p className="hero-text">
            Live graph intelligence for disease, symptom, treatment, and investigation relationships sourced from the BODHI ontology.
          </p>
        </div>

        <div className="status-panel">
          <span className={`status-pill ${health?.status === 'ok' ? 'status-live' : 'status-down'}`}>
            {health?.status === 'ok' ? 'Neo4j connected' : 'Connection pending'}
          </span>
          <p className="status-caption">FastAPI is serving live counts and condition lookups from the graph database.</p>
        </div>
      </section>

      {dashboardError ? <section className="banner error">{dashboardError}</section> : null}

      <section className="metric-grid" aria-label="Graph overview">
        <article className="metric-card accent-card">
          <span className="metric-label">Total nodes</span>
          <strong className="metric-value">{stats ? formatCount(stats.total_nodes) : '...'}</strong>
          <p className="metric-note">Conditions, symptoms, drugs, investigations, and concepts.</p>
        </article>
        <article className="metric-card">
          <span className="metric-label">Relationships</span>
          <strong className="metric-value">{stats ? formatCount(stats.total_relationships) : '...'}</strong>
          <p className="metric-note">Clinical links actively served from Neo4j.</p>
        </article>
        <article className="metric-card">
          <span className="metric-label">Condition library</span>
          <strong className="metric-value">{conditions.length ? formatCount(conditions.length) : '...'}</strong>
          <p className="metric-note">Condition records currently loaded into the explorer.</p>
        </article>
        <article className="metric-card">
          <span className="metric-label">Relationship families</span>
          <strong className="metric-value">{stats ? formatCount(Object.keys(stats.relationships).length) : '...'}</strong>
          <p className="metric-note">Distinct edge types currently indexed in the API response.</p>
        </article>
      </section>

      <section className="content-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="section-tag">Distribution</p>
              <h2>Node Categories</h2>
            </div>
          </div>
          <div className="rank-list">
            {topNodeGroups.map(([label, count]) => (
              <div className="rank-row" key={label}>
                <div>
                  <strong>{label}</strong>
                  <p>{Math.round((count / (stats?.total_nodes ?? 1)) * 100)}% of graph</p>
                </div>
                <span>{formatCount(count)}</span>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="section-tag">Connectivity</p>
              <h2>Relationship Types</h2>
            </div>
          </div>
          <div className="rank-list">
            {topRelationshipGroups.map(([label, count]) => (
              <div className="rank-row" key={label}>
                <div>
                  <strong>{label}</strong>
                  <p>Cypher edge family</p>
                </div>
                <span>{formatCount(count)}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="explorer-grid">
        <article className="panel explorer-panel">
          <div className="panel-header explorer-header">
            <div>
              <p className="section-tag">Clinical Explorer</p>
              <h2>Conditions</h2>
            </div>
            <label className="search-field">
              <span className="sr-only">Search conditions</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search conditions"
              />
            </label>
          </div>

          {isLoadingDashboard ? <p className="state-copy">Loading dashboard data...</p> : null}

          {!isLoadingDashboard && filteredConditions.length === 0 ? (
            <p className="state-copy">No conditions matched your search.</p>
          ) : null}

          <div className="condition-list" role="list">
            {filteredConditions.map((condition) => (
              <button
                type="button"
                key={condition.snomed_id}
                className={`condition-item ${selectedCondition?.snomed_id === condition.snomed_id ? 'condition-item-active' : ''}`}
                onClick={() => setSelectedCondition(condition)}
              >
                <span className="condition-name">{condition.name}</span>
                <span className="condition-meta">{condition.triage_level ?? 'unspecified triage'}</span>
              </button>
            ))}
          </div>
        </article>

        <article className="panel detail-panel">
          <div className="panel-header">
            <div>
              <p className="section-tag">Selected Condition</p>
              <h2>{selectedCondition?.name ?? 'Choose a condition'}</h2>
            </div>
            <span className={`severity-badge severity-${severityTone.replaceAll(' ', '-') || 'neutral'}`}>
              {selectedCondition?.triage_level ?? 'No triage label'}
            </span>
          </div>

          {selectedCondition ? (
            <div className="detail-meta">
              <div>
                <span className="meta-label">SNOMED</span>
                <strong>{selectedCondition.snomed_id}</strong>
              </div>
              <div>
                <span className="meta-label">Symptoms linked</span>
                <strong>{formatCount(symptoms.length)}</strong>
              </div>
            </div>
          ) : null}

          {symptomError ? <p className="banner error">{symptomError}</p> : null}
          {isLoadingSymptoms ? <p className="state-copy">Loading related symptoms...</p> : null}

          {!isLoadingSymptoms && selectedCondition && symptoms.length === 0 ? (
            <p className="state-copy">No symptom edges returned for this condition.</p>
          ) : null}

          <div className="symptom-grid">
            {symptoms.map((item) => (
              <div className="symptom-chip" key={item.symptom}>
                <strong>{item.symptom}</strong>
                <span>{item.triage_level ?? 'triage unavailable'}</span>
              </div>
            ))}
          </div>
        </article>
      </section>
    </main>
  )
}

export default App
