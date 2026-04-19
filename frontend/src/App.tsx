import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react'
import './App.css'

type HealthResponse = {
  status: string
}

type ConditionSummary = {
  snomed_id: string
  name: string
  triage_level: string | null
}

type ConditionDetail = {
  snomed_id: string
  name: string
  triage_level: string | null
  overall_likelihood: string | null
  type_condition: string | null
  concept_type: string | null
  matched_concept_name: string | null
  matched_concept_display_name: string | null
  matched_concept_level: string | null
}

type Symptom = {
  name: string
  triage_level: string | null
  relation_type: string | null
}

type SymptomCatalogOption = {
  name: string
  triage_level: string | null
  root_snomed_id: string | null
  root_snomed_name: string | null
}

type Specialty = {
  id: string
  name: string
}

type Drug = {
  id: string
  name: string
  source_concept: string | null
  hops: number
}

type Lab = {
  loinc_id: string
  name: string
  system_map: string | null
  impact_problem: string | null
  source_concept: string | null
  hops: number
}

type RelatedCondition = {
  snomed_id: string
  name: string
  triage_level: string | null
}

type ConditionDetailResponse = {
  condition: ConditionDetail
  symptoms: Symptom[]
  specialties: Specialty[]
  drugs: Drug[]
  labs: Lab[]
  prerequisites: RelatedCondition[]
  related_conditions: RelatedCondition[]
}

type DrugReverseLookup = {
  drug: { id: string; name: string }
  conditions: ConditionSummary[]
}

type LabReverseLookup = {
  lab: { loinc_id: string; name: string; system_map: string | null }
  conditions: ConditionSummary[]
}

type SymptomCheckResult = {
  snomed_id: string
  name: string
  triage_level: string | null
  matched_count: number
  total_symptoms: number
  match_ratio: number
  score: number
  confidence: 'high' | 'medium' | 'low'
  matched_symptoms: string[]
  missing_input_symptoms: string[]
}

type SymptomCheckResponse = {
  input_symptoms: string[]
  result_count: number
  results: SymptomCheckResult[]
}

type ViewTab = 'symptom-check' | 'condition-lookup' | 'drug-lab-lookup'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api'

async function fetchJson<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const searchParams = new URLSearchParams()

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      searchParams.set(key, String(value))
    }
  })

  const queryString = searchParams.toString()
  const response = await fetch(`${apiBaseUrl}${path}${queryString ? `?${queryString}` : ''}`)

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  return response.json() as Promise<T>
}

async function postJson<TResponse, TPayload>(path: string, payload: TPayload): Promise<TResponse> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  return response.json() as Promise<TResponse>
}

function formatTriage(value: string | null | undefined) {
  return value ? value.replaceAll('_', ' ') : 'unspecified'
}

function App() {
  const [activeTab, setActiveTab] = useState<ViewTab>('symptom-check')
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [conditions, setConditions] = useState<ConditionSummary[]>([])
  const [specialties, setSpecialties] = useState<Specialty[]>([])
  const [selectedConditionId, setSelectedConditionId] = useState<string | null>(null)
  const [selectedSpecialty, setSelectedSpecialty] = useState('')
  const [detail, setDetail] = useState<ConditionDetailResponse | null>(null)
  const [query, setQuery] = useState('')

  const [symptomQuery, setSymptomQuery] = useState('')
  const [symptomOptions, setSymptomOptions] = useState<SymptomCatalogOption[]>([])
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([])
  const [symptomResult, setSymptomResult] = useState<SymptomCheckResponse | null>(null)
  const [isLoadingSymptomOptions, setIsLoadingSymptomOptions] = useState(false)
  const [isRunningSymptomCheck, setIsRunningSymptomCheck] = useState(false)
  const [symptomCheckError, setSymptomCheckError] = useState<string | null>(null)
  const [viewingResultDetail, setViewingResultDetail] = useState(false)

  const [isLoadingOverview, setIsLoadingOverview] = useState(true)
  const [isLoadingConditions, setIsLoadingConditions] = useState(true)
  const [isLoadingDetail, setIsLoadingDetail] = useState(false)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [explorerError, setExplorerError] = useState<string | null>(null)

  const [dlSearchMode, setDlSearchMode] = useState<'drug' | 'lab'>('drug')
  const [dlQuery, setDlQuery] = useState('')
  const [dlResults, setDlResults] = useState<Array<{ id: string; name: string; secondary?: string }>>([])
  const [dlSelectedId, setDlSelectedId] = useState<string | null>(null)
  const [dlReverse, setDlReverse] = useState<{ label: string; conditions: ConditionSummary[] } | null>(null)
  const [isLoadingDlSearch, setIsLoadingDlSearch] = useState(false)
  const [isLoadingDlReverse, setIsLoadingDlReverse] = useState(false)
  const [dlError, setDlError] = useState<string | null>(null)

  const deferredQuery = useDeferredValue(query)
  const deferredSymptomQuery = useDeferredValue(symptomQuery)
  const deferredDlQuery = useDeferredValue(dlQuery)

  const trackInteraction = () => {
    // interaction tracking placeholder
  }

  useEffect(() => {
    let isCancelled = false

    async function loadOverview() {
      setIsLoadingOverview(true)
      setOverviewError(null)

      try {
        const [healthResponse, specialtyResponse] = await Promise.all([
          fetchJson<HealthResponse>('/health'),
          fetchJson<Specialty[]>('/specialties', { limit: 100 }),
        ])

        if (isCancelled) {
          return
        }

        startTransition(() => {
          setHealth(healthResponse)
          setSpecialties(specialtyResponse)
        })
      } catch (error) {
        if (!isCancelled) {
          setOverviewError(error instanceof Error ? error.message : 'Unable to load overview data')
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingOverview(false)
        }
      }
    }

    void loadOverview()

    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    let isCancelled = false

    async function loadConditions() {
      setIsLoadingConditions(true)
      setExplorerError(null)

      try {
        const response = await fetchJson<ConditionSummary[]>('/conditions', {
          q: deferredQuery || undefined,
          speciality: selectedSpecialty || undefined,
          limit: 140,
        })

        if (isCancelled) {
          return
        }

        startTransition(() => {
          setConditions(response)
          setSelectedConditionId((currentSelection) => {
            if (response.length === 0) {
              return null
            }

            if (
              currentSelection &&
              response.some((condition) => condition.snomed_id === currentSelection)
            ) {
              return currentSelection
            }

            return response[0].snomed_id
          })
        })
      } catch (error) {
        if (!isCancelled) {
          setExplorerError(error instanceof Error ? error.message : 'Unable to load conditions')
          setConditions([])
          setSelectedConditionId(null)
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingConditions(false)
        }
      }
    }

    void loadConditions()

    return () => {
      isCancelled = true
    }
  }, [deferredQuery, selectedSpecialty])

  useEffect(() => {
    if (!selectedConditionId) {
      setDetail(null)
      return
    }

    let isCancelled = false

    async function loadConditionDetail() {
      setIsLoadingDetail(true)
      setDetail(null)
      setExplorerError(null)

      try {
        const detailResponse = await fetchJson<ConditionDetailResponse>(`/conditions/${selectedConditionId}`)

        if (isCancelled) {
          return
        }

        startTransition(() => {
          setDetail(detailResponse)
        })
      } catch (error) {
        if (!isCancelled) {
          setExplorerError(error instanceof Error ? error.message : 'Unable to load condition details')
          setDetail(null)
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingDetail(false)
        }
      }
    }

    void loadConditionDetail()

    return () => {
      isCancelled = true
    }
  }, [selectedConditionId])

  useEffect(() => {
    if (activeTab !== 'symptom-check') {
      return
    }

    if (deferredSymptomQuery.trim().length < 2) {
      setSymptomOptions([])
      return
    }

    let isCancelled = false

    async function loadSymptomOptions() {
      setIsLoadingSymptomOptions(true)
      setSymptomCheckError(null)

      try {
        const response = await fetchJson<SymptomCatalogOption[]>('/symptoms', {
          q: deferredSymptomQuery,
          limit: 25,
        })

        if (isCancelled) {
          return
        }

        setSymptomOptions(response)
      } catch (error) {
        if (!isCancelled) {
          setSymptomCheckError(error instanceof Error ? error.message : 'Unable to load symptoms')
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingSymptomOptions(false)
        }
      }
    }

    void loadSymptomOptions()

    return () => {
      isCancelled = true
    }
  }, [activeTab, deferredSymptomQuery])

  useEffect(() => {
    if (activeTab !== 'drug-lab-lookup') return
    if (deferredDlQuery.trim().length < 2) {
      setDlResults([])
      return
    }

    let isCancelled = false

    async function searchDrugLab() {
      setIsLoadingDlSearch(true)
      setDlError(null)

      try {
        if (dlSearchMode === 'drug') {
          const items = await fetchJson<Array<{ id: string; name: string }>>('/drugs', {
            q: deferredDlQuery,
            limit: 40,
          })
          if (!isCancelled) setDlResults(items.map((d) => ({ id: d.id, name: d.name })))
        } else {
          const items = await fetchJson<Array<{ loinc_id: string; name: string; system_map: string | null }>>('/labs', {
            q: deferredDlQuery,
            limit: 40,
          })
          if (!isCancelled) setDlResults(items.map((l) => ({ id: l.loinc_id, name: l.name, secondary: l.loinc_id })))
        }
      } catch (error) {
        if (!isCancelled) setDlError(error instanceof Error ? error.message : 'Search failed')
      } finally {
        if (!isCancelled) setIsLoadingDlSearch(false)
      }
    }

    void searchDrugLab()
    return () => { isCancelled = true }
  }, [activeTab, deferredDlQuery, dlSearchMode])

  useEffect(() => {
    if (!dlSelectedId || activeTab !== 'drug-lab-lookup') {
      setDlReverse(null)
      return
    }

    let isCancelled = false

    async function loadReverse() {
      setIsLoadingDlReverse(true)
      setDlError(null)

      try {
        if (dlSearchMode === 'drug') {
          const data = await fetchJson<DrugReverseLookup>(`/drugs/${encodeURIComponent(dlSelectedId)}/conditions`)
          if (!isCancelled) setDlReverse({ label: data.drug.name, conditions: data.conditions })
        } else {
          const data = await fetchJson<LabReverseLookup>(`/labs/${encodeURIComponent(dlSelectedId)}/conditions`)
          if (!isCancelled) setDlReverse({ label: data.lab.name, conditions: data.conditions })
        }
      } catch (error) {
        if (!isCancelled) setDlError(error instanceof Error ? error.message : 'Lookup failed')
      } finally {
        if (!isCancelled) setIsLoadingDlReverse(false)
      }
    }

    void loadReverse()
    return () => { isCancelled = true }
  }, [dlSelectedId, dlSearchMode, activeTab])

  const selectedCondition = useMemo(
    () => conditions.find((condition) => condition.snomed_id === selectedConditionId) ?? null,
    [conditions, selectedConditionId],
  )

  const severityTone = detail?.condition.triage_level?.toLowerCase().replaceAll('_', '-') ?? 'neutral'

  const tabButtons: Array<{ id: ViewTab; label: string }> = [
    { id: 'symptom-check', label: 'Symptom Check' },
    { id: 'condition-lookup', label: 'Condition Lookup' },
    { id: 'drug-lab-lookup', label: 'Drug & Lab Lookup' },
  ]

  const addSelectedSymptom = (symptomName: string) => {
    trackInteraction()
    setSelectedSymptoms((current) => {
      if (current.includes(symptomName)) {
        return current
      }
      return [...current, symptomName]
    })
    setSymptomQuery('')
    setSymptomOptions([])
  }

  const removeSelectedSymptom = (symptomName: string) => {
    trackInteraction()
    setSelectedSymptoms((current) => current.filter((item) => item !== symptomName))
  }

  const runSymptomCheck = async () => {
    if (selectedSymptoms.length === 0) {
      setSymptomCheckError('Select at least one symptom to run a check')
      return
    }

    trackInteraction()
    setIsRunningSymptomCheck(true)
    setSymptomCheckError(null)

    try {
      const response = await postJson<SymptomCheckResponse, { symptoms: string[]; top_k: number }>(
        '/symptom-check',
        {
          symptoms: selectedSymptoms,
          top_k: 10,
        },
      )
      setSymptomResult(response)
    } catch (error) {
      setSymptomCheckError(error instanceof Error ? error.message : 'Unable to run symptom check')
      setSymptomResult(null)
    } finally {
      setIsRunningSymptomCheck(false)
    }
  }

  const renderActionCard = () => {
    if (!detail) return null
    return (
      <div className="action-card">
        <div className="action-card-head">
          <h2>{detail.condition.name}</h2>
          <span className={`severity-badge severity-${severityTone}`}>
            {formatTriage(detail.condition.triage_level)}
          </span>
        </div>

        {detail.symptoms.length > 0 ? (
          <div className="action-section">
            <h3 className="action-label">Presenting Symptoms</h3>
            <div className="symptom-pills">
              {detail.symptoms.map((s, i) => (
                <span className="symptom-pill" key={i}>{s.name}</span>
              ))}
            </div>
          </div>
        ) : null}

        {(detail.labs.length + detail.drugs.length + detail.specialties.length) > 0 && (
          <div className="action-columns">
            {detail.labs.length > 0 && (
              <div className="action-col">
                <h3 className="action-label">
                  Labs to Order <span className="count-tag">{detail.labs.length}</span>
                </h3>
                <ul className="action-list">
                  {detail.labs.map((lab) => (
                    <li key={lab.loinc_id}>
                      <span>{lab.name}</span>
                      <small>{lab.loinc_id}</small>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {detail.drugs.length > 0 && (
              <div className="action-col">
                <h3 className="action-label">
                  Drugs to Consider <span className="count-tag">{detail.drugs.length}</span>
                </h3>
                <ul className="action-list">
                  {detail.drugs.map((drug) => (
                    <li key={drug.id}>{drug.name}</li>
                  ))}
                </ul>
              </div>
            )}
            {detail.specialties.length > 0 && (
              <div className="action-col">
                <h3 className="action-label">
                  Refer To <span className="count-tag">{detail.specialties.length}</span>
                </h3>
                <ul className="action-list">
                  {detail.specialties.map((sp) => (
                    <li key={sp.id}>{sp.name}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {(detail.prerequisites.length + detail.related_conditions.length) > 0 ? (
          <div className="action-section">
            <h3 className="action-label">Related Conditions</h3>
            <div className="related-pills">
              {[...detail.prerequisites, ...detail.related_conditions].map((rc) => (
                <span className="related-pill" key={rc.snomed_id}>{rc.name}</span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <main className="workspace-shell">
      <header className="app-header">
        <div className="app-brand">
          <h1>ClinIQ <span className="brand-dot">·</span> <span className="brand-sub">BODHI</span></h1>
          <p>Enter symptoms → identify conditions → get action plan with labs, drugs &amp; referrals</p>
        </div>
        <span className={`conn-badge ${health?.status === 'ok' ? 'conn-live' : 'conn-down'}`}>
          {health?.status === 'ok' ? '● Connected' : '○ Connecting...'}
        </span>
      </header>

      <nav className="tab-nav" aria-label="Workflows">
        {tabButtons.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? 'tab-btn-active' : ''}`}
            onClick={() => {
              trackInteraction()
              setActiveTab(tab.id)
              setViewingResultDetail(false)
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {overviewError ? <section className="banner error">{overviewError}</section> : null}
      {explorerError ? <section className="banner error">{explorerError}</section> : null}
      {dlError ? <section className="banner error">{dlError}</section> : null}

      {activeTab === 'condition-lookup' ? (
        <section className="lookup-view">
          <div className="lookup-sidebar">
            <div className="lookup-filters">
              <input
                id="cond-search"
                type="search"
                value={query}
                onChange={(event) => {
                  trackInteraction()
                  setQuery(event.target.value)
                }}
                placeholder="Search conditions"
              />
              <select
                value={selectedSpecialty}
                onChange={(event) => {
                  trackInteraction()
                  setSelectedSpecialty(event.target.value)
                }}
              >
                <option value="">All specialities</option>
                {specialties.map((specialty) => (
                  <option key={specialty.id} value={specialty.name}>
                    {specialty.name}
                  </option>
                ))}
              </select>
            </div>
            {isLoadingConditions || isLoadingOverview ? <p className="state-copy pad-sm">Loading...</p> : null}
            <div className="lookup-list">
              {conditions.map((condition) => (
                <button
                  type="button"
                  key={condition.snomed_id}
                  className={`lookup-row ${selectedCondition?.snomed_id === condition.snomed_id ? 'lookup-row-active' : ''}`}
                  onClick={() => {
                    trackInteraction()
                    setSelectedConditionId(condition.snomed_id)
                  }}
                >
                  <span>{condition.name}</span>
                  <span className="lookup-triage">{formatTriage(condition.triage_level)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="lookup-detail">
            {isLoadingDetail ? (
              <p className="state-copy">Loading clinical action card...</p>
            ) : detail ? renderActionCard() : (
              <p className="state-copy">Select a condition to see its clinical action card — labs, drugs, and referrals.</p>
            )}
          </div>
        </section>
      ) : null}

      {activeTab === 'symptom-check' ? (
        <section className="check-view">
          <div className="check-intake">
            <h2>Enter Symptoms</h2>

            <input
              id="symptom-search"
              type="search"
              className="check-input"
              value={symptomQuery}
              onChange={(event) => {
                trackInteraction()
                setSymptomQuery(event.target.value)
              }}
              placeholder="Type 2+ characters to search"
            />

            {isLoadingSymptomOptions ? <p className="state-copy">Searching...</p> : null}

            {symptomOptions.length > 0 ? (
              <div className="suggestion-list">
                {symptomOptions.map((item) => (
                  <button
                    type="button"
                    key={item.name}
                    className="suggestion-item"
                    onClick={() => addSelectedSymptom(item.name)}
                  >
                    <span>{item.name}</span>
                    <small>{formatTriage(item.triage_level)}</small>
                  </button>
                ))}
              </div>
            ) : null}

            {selectedSymptoms.length > 0 ? (
              <div className="selected-pills">
                {selectedSymptoms.map((item) => (
                  <button
                    type="button"
                    key={item}
                    className="pill selected-pill"
                    onClick={() => removeSelectedSymptom(item)}
                  >
                    {item} ×
                  </button>
                ))}
              </div>
            ) : null}

            <button
              type="button"
              className="primary-button"
              onClick={() => {
                void runSymptomCheck()
                setViewingResultDetail(false)
              }}
              disabled={isRunningSymptomCheck || selectedSymptoms.length === 0}
            >
              {isRunningSymptomCheck ? 'Checking...' : `Find Conditions (${selectedSymptoms.length})`}
            </button>

            {symptomCheckError ? <p className="banner error">{symptomCheckError}</p> : null}
          </div>

          <div className="check-results">
            {!symptomResult && !viewingResultDetail ? (
              <div className="check-intro">
                <h2>What you can do</h2>
                <ol>
                  <li>Search and select patient symptoms from the clinical ontology</li>
                  <li>Click <strong>Find Conditions</strong> to get ranked differential diagnoses</li>
                  <li>Click any result to see the <strong>clinical action card</strong> — labs to order, drugs to consider, and specialist referrals</li>
                </ol>
              </div>
            ) : null}

            {symptomResult && !viewingResultDetail ? (
              <div>
                <h2 className="results-heading">
                  Possible Conditions <span className="result-count">{symptomResult.result_count} found</span>
                </h2>
                <div className="result-table">
                  <div className="result-table-head">
                    <span>#</span>
                    <span>Condition</span>
                    <span>Severity</span>
                    <span>Score</span>
                    <span>Match</span>
                  </div>
                  {symptomResult.results.map((result, index) => (
                    <button
                      type="button"
                      className="result-row"
                      key={result.snomed_id}
                      onClick={() => {
                        trackInteraction()
                        setSelectedConditionId(result.snomed_id)
                        setViewingResultDetail(true)
                      }}
                    >
                      <span className="result-rank">{index + 1}</span>
                      <span className="result-name">{result.name}</span>
                      <span className={`triage-label triage-${result.triage_level?.toLowerCase().replaceAll('_', '-') ?? 'neutral'}`}>
                        {formatTriage(result.triage_level)}
                      </span>
                      <span className="result-score">{result.score.toFixed(0)}</span>
                      <span className="result-match">{result.matched_count}/{result.total_symptoms}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {viewingResultDetail ? (
              <div className="result-detail-view">
                <button type="button" className="back-btn" onClick={() => setViewingResultDetail(false)}>
                  ← Back to results
                </button>
                {isLoadingDetail ? <p className="state-copy">Loading action card...</p> : renderActionCard()}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
      {activeTab === 'drug-lab-lookup' ? (
        <section className="lookup-view">
          <div className="lookup-sidebar">
            <div className="lookup-filters">
              <div className="dl-mode-toggle">
                <button
                  type="button"
                  className={`dl-mode-btn ${dlSearchMode === 'drug' ? 'dl-mode-active' : ''}`}
                  onClick={() => {
                    trackInteraction()
                    setDlSearchMode('drug')
                    setDlQuery('')
                    setDlResults([])
                    setDlSelectedId(null)
                    setDlReverse(null)
                  }}
                >
                  Drugs
                </button>
                <button
                  type="button"
                  className={`dl-mode-btn ${dlSearchMode === 'lab' ? 'dl-mode-active' : ''}`}
                  onClick={() => {
                    trackInteraction()
                    setDlSearchMode('lab')
                    setDlQuery('')
                    setDlResults([])
                    setDlSelectedId(null)
                    setDlReverse(null)
                  }}
                >
                  Lab Tests
                </button>
              </div>
              <input
                type="search"
                value={dlQuery}
                onChange={(e) => {
                  trackInteraction()
                  setDlQuery(e.target.value)
                }}
                placeholder={dlSearchMode === 'drug' ? 'Search drugs (e.g. Metformin)' : 'Search labs (e.g. HbA1c)'}
              />
            </div>
            {isLoadingDlSearch ? <p className="state-copy pad-sm">Searching...</p> : null}
            <div className="lookup-list">
              {dlResults.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`lookup-row ${dlSelectedId === item.id ? 'lookup-row-active' : ''}`}
                  onClick={() => {
                    trackInteraction()
                    setDlSelectedId(item.id)
                  }}
                >
                  <span>{item.name}</span>
                  {item.secondary ? <span className="lookup-triage">{item.secondary}</span> : null}
                </button>
              ))}
            </div>
          </div>
          <div className="lookup-detail">
            {!dlSelectedId && !dlReverse ? (
              <div className="check-intro">
                <h2>What you can do</h2>
                <ol>
                  <li>Toggle between <strong>Drugs</strong> and <strong>Lab Tests</strong></li>
                  <li>Search and select a drug or lab test from the list</li>
                  <li>See which <strong>conditions</strong> it treats or monitors — with triage levels</li>
                  <li>Click any condition to view its full <strong>clinical action card</strong></li>
                </ol>
              </div>
            ) : null}
            {isLoadingDlReverse ? <p className="state-copy">Loading reverse lookup...</p> : null}
            {dlReverse && !viewingResultDetail ? (
              <div className="dl-reverse-card">
                <div className="dl-reverse-head">
                  <h2>{dlReverse.label}</h2>
                  <span className="count-tag">{dlReverse.conditions.length} condition{dlReverse.conditions.length !== 1 ? 's' : ''}</span>
                </div>
                <h3 className="action-label">
                  {dlSearchMode === 'drug' ? 'Conditions treated by this drug' : 'Conditions monitored by this lab test'}
                </h3>
                {dlReverse.conditions.length > 0 ? (
                  <div className="dl-condition-grid">
                    {dlReverse.conditions.map((c) => (
                      <button
                        type="button"
                        key={c.snomed_id}
                        className="dl-condition-card"
                        onClick={() => {
                          trackInteraction()
                          setSelectedConditionId(c.snomed_id)
                          setViewingResultDetail(true)
                        }}
                      >
                        <span className="dl-cond-name">{c.name}</span>
                        <span className={`triage-label triage-${c.triage_level?.toLowerCase().replaceAll('_', '-') ?? 'neutral'}`}>
                          {formatTriage(c.triage_level)}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="empty-note">No conditions linked in the knowledge graph</p>
                )}
              </div>
            ) : null}
            {viewingResultDetail ? (
              <div className="result-detail-view">
                <button type="button" className="back-btn" onClick={() => setViewingResultDetail(false)}>
                  ← Back to results
                </button>
                {isLoadingDetail ? <p className="state-copy">Loading action card...</p> : renderActionCard()}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <footer className="app-footer">
        <p className="disclaimer">For educational and research purposes only. Not a substitute for professional medical advice, diagnosis, or treatment.</p>
        <p className="attribution">Powered by <a href="https://github.com/eka-care/bodhi" target="_blank" rel="noopener noreferrer">BODHI</a> — an open clinical ontology by <a href="https://www.eka.care" target="_blank" rel="noopener noreferrer">Eka Care</a> (CC BY-NC 4.0)</p>
      </footer>
    </main>
  )
}

export default App
