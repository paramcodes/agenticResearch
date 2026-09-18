# ResearcherIt - Design Documentation

## Project Overview

ResearcherIt is an AI-powered research assistant that uses a multi-agent system (Planner → Writer → Editor) to generate well-researched, cited blog posts and articles. The system combines web search, LLM-powered content generation, and iterative editing to produce high-quality markdown content with proper citations.

### Core Value Proposition

- **Multi-Agent Collaboration**: Specialized agents (Planner, Writer, Editor) work in sequence
- **Real-Time Streaming**: Live token streaming for immediate feedback
- **Cited Research**: Automatic source integration and citation management
- **Flexible Depth**: Quick, Standard, and Deep research modes
- **Offline Capability**: Graceful degradation when API keys are unavailable
- **Conversation History**: Persistent research sessions with editing capabilities

## Architecture Overview

### High-Level System Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        Browser[React App<br/>Vite Build]
        WSClient[WebSocket Client]
        HTTPClient[HTTP Client]
    end

    subgraph "API Layer"
        Express[Express Server]
        AuthRoutes[Auth Routes<br/>JWT/Google]
        AgentRoutes[Agent Routes<br/>/research]
        WSHandler[WebSocket Handler]
        Middleware[Auth Middleware<br/>Rate Limiting]
    end

    subgraph "Data Layer"
        Prisma[Prisma Client]
        RedisClient[Redis Client<br/>Best Effort]
        LangGraph[LangGraph Agent]
    end

    subgraph "External Services"
        PostgreSQL[(PostgreSQL<br/>Database)]
        Redis[(Redis Stack<br/>Checkpointer)]
        Tavily[Tavily API<br/>Web Search]
        OpenAI[OpenAI API<br/>LLM]
        Google[Google OAuth<br/>API]
    end

    Browser -->|HTTPS/WSS| Express
    WSClient -->|WSS| WSHandler
    HTTPClient -->|HTTPS| Express

    Express --> Middleware
    Middleware --> AuthRoutes
    Middleware --> AgentRoutes
    Express --> WSHandler

    AuthRoutes --> Prisma
    AgentRoutes --> Prisma
    AgentRoutes --> LangGraph
    WSHandler --> LangGraph

    Prisma --> PostgreSQL
    RedisClient --> Redis
    LangGraph --> RedisClient

    LangGraph --> Tavily
    LangGraph --> OpenAI
    AuthRoutes --> Google

    style Browser fill:#e1f5ff
    style Express fill:#fff4e1
    style LangGraph fill:#ffe1f5
    style PostgreSQL fill:#e1ffe1
    style Redis fill:#ffe1e1
    style Tavily fill:#f5e1ff
    style OpenAI fill:#f5e1ff
```

## Tech Stack

### Core Technologies

- **Runtime**: Bun 1.3+ (JavaScript runtime)
- **Build System**: Turborepo (Monorepo management)
- **Language**: TypeScript 7.0+
- **Node Version**: 24+

### Backend Stack

- **API Framework**: Express.js
- **Database**: PostgreSQL 16
- **ORM**: Prisma
- **Cache/Checkpointer**: Redis (Redis Stack for search indexes)
- **Agent Framework**: LangGraph 0.4
- **Authentication**: JWT Bearer + Google OAuth
- **Real-time**: WebSocket (ws library)

### Frontend Stack

- **Framework**: React 18
- **Build Tool**: Vite
- **Styling**: CSS (custom)
- **HTTP Client**: Fetch API
- **WebSocket**: Native WebSocket API

### External APIs

- **Search**: Tavily API (web search)
- **LLM**: OpenAI API (GPT-4o-mini default)
- **Auth**: Google OAuth 2.0

## Monorepo Structure

```
researcherit/
├── apps/
│   ├── api/                 # Express API server
│   │   ├── src/
│   │   │   ├── index.ts     # Server entry point
│   │   │   ├── routes/      # API route handlers
│   │   │   │   ├── auth.ts  # Authentication endpoints
│   │   │   │   ├── agent.ts # Agent research endpoints
│   │   │   │   └── conversations.ts # Conversation management
│   │   │   ├── middleware/  # Express middleware
│   │   │   │   └── auth.ts  # JWT validation, rate limiting
│   │   │   ├── lib/         # Utility libraries
│   │   │   │   ├── jwt.ts   # JWT token management
│   │   │   │   ├── google.ts # Google OAuth verification
│   │   │   │   └── redis.ts # Redis client wrapper
│   │   │   └── ws.ts        # WebSocket handler
│   │   ├── Dockerfile      # Multi-stage Docker build
│   │   └── package.json
│   │
│   └── web/                 # React frontend
│       ├── src/
│       │   ├── pages/       # Page components
│       │   │   ├── Agent.tsx    # Main research interface
│       │   │   ├── Landing.tsx  # Landing page
│       │   │   ├── Login.tsx    # Login form
│       │   │   ├── Signup.tsx   # Signup form
│       │   │   └── Profile.tsx  # User profile
│       │   ├── components/  # Reusable components
│       │   │   ├── Markdown.tsx  # Markdown renderer
│       │   │   ├── Navbar.tsx    # Navigation bar
│       │   │   └── ProtectedRoute.tsx # Auth wrapper
│       │   ├── lib/         # Client utilities
│       │   │   ├── api.ts   # API client with streaming
│       │   │   └── auth.tsx # Auth utilities
│       │   ├── main.tsx     # React entry point
│       │   └── App.tsx      # Root component
│       ├── index.html
│       ├── vite.config.ts
│       ├── Dockerfile
│       └── package.json
│
├── packages/
│   ├── agent/               # LangGraph agent implementation
│   │   ├── src/
│   │   │   ├── index.ts     # Public API (runResearch, streamResearch)
│   │   │   ├── graph.ts     # LangGraph state machine
│   │   │   ├── search.ts    # Tavily search integration
│   │   │   ├── llm.ts       # OpenAI LLM wrapper
│   │   │   └── runner.ts    # Streaming execution engine
│   │   └── package.json
│   │
│   ├── db/                  # Prisma database schema
│   │   ├── prisma/
│   │   │   ├── schema.prisma # Database schema
│   │   │   ├── seed.ts      # Seed data
│   │   │   └── migrations/  # Database migrations
│   │   ├── src/
│   │   │   └── index.ts     # Prisma client export
│   │   └── package.json
│   │
│   ├── eslint-config/       # Shared ESLint configuration
│   └── typescript-config/   # Shared TypeScript configuration
│
├── specs/                   # Development specifications
│   ├── 00-initial-research-agent.md
│   ├── 01-learnings-from-initial-implementation.md
│   ├── 02-agent-implementation.md
│   └── 03-learnings-from-agent-implementation.md
│
├── docker-compose.yml       # Docker orchestration
├── turbo.json               # Turborepo configuration
├── package.json             # Root package.json
├── .env.example             # Environment template
└── AGENTS.md                # Agent development guidelines
```

## Data Models

### Database Schema (Prisma)

```prisma
enum AuthProvider {
  CREDENTIALS
  GOOGLE
}

enum MessageRole {
  user
  assistant
}

enum ResearchStatus {
  pending
  running
  completed
  failed
}

model User {
  id           String       @id @default(cuid())
  name         String
  email        String       @unique
  username     String?      @unique
  passwordHash String?
  provider     AuthProvider @default(CREDENTIALS)
  googleId     String?      @unique
  avatarUrl    String?
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  conversations Conversation[]
}

model Conversation {
  id        String         @id @default(cuid())
  userId    String
  user      User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  title     String         @default("New research")
  status    ResearchStatus @default(pending)
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt

  messages Message[]
}

model Message {
  id             String      @id @default(cuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           MessageRole
  content        String      @db.Text
  createdAt      DateTime    @default(now())
}
```

### Agent State Schema

```typescript
interface ResearchState {
  topic: string;              // Research topic
  depth: string;              // "quick" | "standard" | "deep"
  sources: CitedSource[];     // Search results
  sourcesBlock: string;       // Formatted sources for prompts
  searchNote: string;         // Search metadata/fallback notes
  offline: boolean;           // Whether offline mode is active
  plan: string;               // Planner's output
  draft: string;              // Writer's current draft
  editorFeedback: string;     // Editor's feedback for revisions
  revisionCount: number;      // Number of revision cycles
  verdict: string;            // Editor's verdict ("approved" | "revise")
  finalPost: string;          // Final approved content
}

interface CitedSource {
  title: string;
  url: string;
  snippet: string;
}
```

## Agent Architecture (LangGraph)

### Graph Structure

```mermaid
graph TD
    START([START]) --> PLANNER[PLANNER NODE<br/>Search • Plan • Sources]
    PLANNER --> WRITER[WRITER NODE<br/>Draft • Cite • Format]
    WRITER --> EDITOR[EDITOR NODE<br/>Review • Verdict • Feedback]

    EDITOR -->|revise & count < MAX| WRITER_REV[WRITER NODE<br/>Revision]
    EDITOR -->|approved OR count >= MAX| END([END])

    WRITER_REV --> EDITOR

    style START fill:#e1ffe1
    style END fill:#ffe1e1
    style PLANNER fill:#e1f5ff
    style WRITER fill:#fff4e1
    style EDITOR fill:#ffe1f5
    style WRITER_REV fill:#fff4e1
```

### Node Implementations

#### 1. Planner Node

**Responsibilities:**
- Execute web search via Tavily API
- Analyze search results
- Generate comprehensive content plan
- Identify target audience and SEO keywords
- Create detailed outline with source citations

**Inputs:**
- `topic`: Research topic
- `depth`: Research depth (quick/standard/deep)

**Outputs:**
- `sources`: Array of cited sources
- `sourcesBlock`: Formatted source list
- `searchNote`: Search metadata
- `offline`: Offline mode flag
- `plan`: Content plan in markdown

**Prompt Template:**
```
You're working on planning a blog article about the topic: {topic}.
You collect information that helps the audience learn something
and make informed decisions.

Produce:
1. Latest relevant trends, key players, and noteworthy points
2. Target audience and their likely interests/pain points
3. Detailed outline with source citations [n]
4. 5-8 SEO keywords

Search results:
{sourcesBlock}
```

#### 2. Writer Node

**Responsibilities:**
- Generate full markdown article based on plan
- Incorporate source citations with [n] markers
- Follow SEO keywords from plan
- Structure content (intro, body, conclusion)
- Handle editor feedback in revisions

**Inputs:**
- `topic`: Research topic
- `plan`: Content plan from planner
- `sourcesBlock`: Source list
- `editorFeedback`: Feedback from editor (if revising)
- `depth`: Research depth

**Outputs:**
- `draft`: Generated markdown article

**Prompt Template:**
```
You're working on writing a new opinion piece about: {topic}.
Base your writing on the Content Planner's outline and sources.

Requirements:
- Engaging sections/subtitles
- Structure: intro, body, conclusion
- 2-3 paragraphs per section
- Incorporate SEO keywords
- End with numbered Sources list
- Valid markdown only
- Scope: {depth_scope}

Content plan:
{plan}

Sources:
{sourcesBlock}

Editor feedback:
{editorFeedback}
```

#### 3. Editor Node

**Responsibilities:**
- Review draft for journalistic standards
- Check for balanced viewpoints
- Verify citation integrity
- Provide actionable feedback
- Approve or request revision

**Inputs:**
- `draft`: Writer's output
- `revisionCount`: Current revision cycle

**Outputs:**
- `verdict`: "approved" or "revise"
- `editorFeedback`: Specific feedback (if revising)
- `finalPost`: Polished content (if approved)
- `revisionCount`: Updated revision count

**Prompt Template:**
```
You are an editor reviewing a blog post.

Ensure:
- Journalistic best practices
- Balanced viewpoints
- Avoid controversial topics
- Keep [n] citation markers intact
- Clean, well-structured markdown

If publication-ready:
VERDICT: approved
---
<final polished markdown>

If needs revision:
VERDICT: revise
---
<specific, actionable feedback>

Draft:
{draft}
```

### Routing Logic

```typescript
function routeAfterEditor(state: State): "writer" | typeof END {
  if (state.verdict === "revise" && state.revisionCount < maxRevisions()) {
    return "writer";  // Loop back for revision
  }
  return END;  // End workflow
}
```

### Checkpointer Strategy

**Redis Checkpointer (Preferred):**
- Persistent state across server restarts
- Thread-scoped checkpoints (`conv:<conversationId>:<runId>`)
- Enables resume capability
- Requires Redis Stack for search indexes

**MemorySaver (Fallback):**
- In-memory state storage
- Lost on server restart
- Used when Redis unavailable
- Maintains API functionality

**Threading Model:**
```typescript
// Thread ID format: conv:<conversationId>:<randomRunId>
const threadId = conversationId 
  ? `conv:${conversationId}:${randomRunId}` 
  : `anon:${randomRunId}`;
```

## API Architecture

### Endpoint Structure

```
/api/
├── /auth/
│   ├── POST /register          # User registration
│   ├── POST /login              # User login
│   ├── POST /google             # Google OAuth
│   ├── GET  /me                 # Current user info
│   ├── PATCH /profile           # Update profile
│   ├── POST /change-password    # Change password
│   └── POST /logout             # Logout (token blacklist)
│
├── /conversations/
│   ├── GET  /                   # List user conversations
│   ├── GET  /:id                # Get conversation details
│   ├── DELETE /:id             # Delete conversation
│   └── POST /:id/messages       # Send message in conversation
│
├── /agent/
│   ├── GET  /info               # Agent information
│   └── POST /research           # Execute research (HTTP)
│
└── /ws                          # WebSocket streaming endpoint
```

### Authentication Flow

```mermaid
sequenceDiagram
    participant User as User Browser
    participant API as Express API
    participant DB as PostgreSQL
    participant Redis as Redis<br/>(Optional)
    participant Google as Google OAuth

    User->>API: POST /auth/login<br/>{email, password}
    API->>DB: Query user by email
    DB-->>API: User record
    API->>API: Verify password hash
    API->>API: Generate JWT token
    API-->>User: {user, token}

    Note over User: Store token in localStorage

    User->>API: GET /api/conversations<br/>Authorization: Bearer <token>
    API->>API: Verify JWT signature
    API->>Redis: Check token blacklist
    Redis-->>API: Not blacklisted
    API->>DB: Query user conversations
    DB-->>API: Conversation list
    API-->>User: {conversations}

    User->>API: POST /auth/google<br/>{credential}
    API->>Google: Verify OAuth token
    Google-->>API: Token valid + user info
    API->>DB: Find/create user by googleId
    API->>API: Generate JWT token
    API-->>User: {user, token}

    User->>API: POST /auth/logout
    API->>Redis: Add token to blacklist
    Redis-->>API: Blacklisted
    API-->>User: {ok: true}
```

### WebSocket Protocol

**Connection:**
```
ws://host:PORT/ws?token=<JWT>
```

**Client Message:**
```json
{
  "type": "research",
  "topic": "Solid-state batteries in 2026",
  "conversationId": "optional-existing-id",
  "depth": "standard"
}
```

**Server Messages:**

1. **Status Update:**
```json
{
  "type": "status",
  "status": "connected" | "running" | "completed" | "failed",
  "progress": 0.5,
  "conversationId": "conv-id"
}
```

2. **Node Progress:**
```json
{
  "type": "node",
  "node": "planner" | "writer" | "editor",
  "detail": "approved" | "revise" | "1234 chars",
  "conversationId": "conv-id"
}
```

3. **Token Stream:**
```json
{
  "type": "token",
  "token": "fragment of markdown",
  "conversationId": "conv-id"
}
```

4. **Final Result:**
```json
{
  "type": "result",
  "conversationId": "conv-id",
  "markdown": "full markdown content",
  "verdict": "approved",
  "revisionCount": 1,
  "offline": false
}
```

5. **Error:**
```json
{
  "type": "error",
  "error": "Error message"
}
```

## Web Frontend Architecture

### Component Structure

```
App.tsx
├── Navbar
├── Routes
│   ├── LandingPage
│   ├── LoginPage
│   ├── SignupPage
│   ├── ProfilePage (ProtectedRoute)
│   └── AgentPage (ProtectedRoute)
│       ├── Sidebar (Conversation list)
│       ├── Chat Area
│       │   ├── Message List
│       │   │   ├── User Message (editable)
│       │   │   └── Assistant Message (Markdown)
│       │   └── Composer Form
│       │       ├── Topic Input
│       │       ├── Depth Selector
│       │       └── Send Button
│       └── Progress Indicator
└── Markdown Component
```

### State Management

**Local Component State:**
- `conversations`: List of conversation summaries
- `activeId`: Currently selected conversation
- `messages`: Messages in active conversation
- `topic`: Current input topic
- `depth`: Research depth setting
- `loading`: Loading state
- `phase`: Current agent phase
- `error`: Error message

**Persistent State:**
- `localStorage["researcherit.token"]`: JWT authentication token
- `localStorage["researcherit.depth"]`: Preferred research depth

### API Client Architecture

**HTTP Client:**
```typescript
async function request<T>(path: string, opts: RequestInit): Promise<T>
```
- Automatic token inclusion
- Error handling
- Type-safe responses

**Streaming Client:**
```typescript
function streamResearch(
  topic: string,
  conversationId: string | null,
  depth: ResearchDepth,
  callbacks: StreamCallbacks
): Promise<StreamResult>
```
- WebSocket connection management
- Token streaming callback
- Node progress callback
- Automatic fallback to HTTP on failure

### Message Flow (Frontend)

```mermaid
graph TD
    UserInput[User Input] --> OptUI[Optimistic UI Update]
    OptUI --> AddUser[Add Temp User Message]
    OptUI --> AddAsst[Add Empty Assistant Message]

    AddAsst --> WSStream[Attempt WebSocket Stream]
    WSStream --> Connect[Connect to /ws]
    Connect --> SendReq[Send Research Request]
    SendReq --> StreamTokens[Stream Tokens to Assistant]
    StreamTokens --> UpdatePhase[Update Phase Indicators]

    StreamTokens --> Success{Success?}
    Success -->|Yes| Reconcile[Reconcile with Server]
    Success -->|No| HTTPFallback[Fallback to HTTP]

    Reconcile --> RefreshList[Refresh Conversation List]
    RefreshList --> DisplayResult[Display Final Result]

    HTTPFallback --> RemoveOpt[Remove Optimistic Messages]
    RemoveOpt --> CallHTTP[Call /api/agent/research]
    CallHTTP --> DisplayResult

    style UserInput fill:#e1f5ff
    style OptUI fill:#fff4e1
    style WSStream fill:#ffe1f5
    style HTTPFallback fill:#ffe1e1
    style DisplayResult fill:#e1ffe1
```

## Complete Workflow

### Research Request Flow

```mermaid
sequenceDiagram
    participant User as User Browser
    participant WS as WebSocket Handler
    participant API as Express API
    participant DB as PostgreSQL
    participant Agent as LangGraph Agent
    participant Planner as Planner Node
    participant Writer as Writer Node
    participant Editor as Editor Node
    participant Tavily as Tavily API
    participant OpenAI as OpenAI API
    participant Redis as Redis Checkpointer

    User->>User: 1. Enter topic + depth
    User->>User: 2. Create optimistic messages
    User->>WS: 3. Connect ws://host/ws?token=JWT
    WS->>API: 4. Validate JWT + Redis blacklist
    API-->>WS: 5. Auth confirmed
    WS-->>User: 6. {type:"status",status:"connected"}

    User->>WS: 7. {type:"research",topic,depth}
    WS->>API: 8. Create/retrieve conversation
    API->>DB: 9. Persist user message
    DB-->>API: 10. Message saved
    API->>DB: 11. Set status="running"
    WS-->>User: 12. {type:"status",status:"running"}

    WS->>Agent: 13. streamResearch(topic,depth)
    Agent->>Redis: 14. Create thread_id: conv:<id>:<rand>
    Agent->>Planner: 15. Execute planner node

    Planner->>Tavily: 16. Search topic
    Tavily-->>Planner: 17. Search results
    Planner->>OpenAI: 18. Generate plan (or template)
    OpenAI-->>Planner: 19. Content plan
    Planner-->>Agent: 20. {sources,plan,searchNote}
    Agent-->>WS: 21. {type:"node",node:"planner"}
    WS-->>User: 22. Phase: "Planning from live sources…"

    Agent->>Writer: 23. Execute writer node
    Writer->>OpenAI: 24. Generate draft
    OpenAI-->>Writer: 25. Stream tokens
    Writer-->>Agent: 26. Token chunks
    Agent-->>WS: 27. {type:"token",token:"..."}
    WS-->>User: 28. Stream markdown content
    Agent-->>WS: 29. {type:"node",node:"writer"}
    WS-->>User: 30. Phase: "Writing…"

    Agent->>Editor: 31. Execute editor node
    Editor->>OpenAI: 32. Review draft
    OpenAI-->>Editor: 33. Verdict + feedback
    Editor-->>Agent: 34. {verdict,editorFeedback,finalPost}
    Agent-->>WS: 35. {type:"node",node:"editor",detail:"verdict"}
    WS-->>User: 36. Phase: "Editing…"

    Agent->>Agent: 37. Check revision logic
    alt revise & count < MAX
        Agent->>Writer: 38. Route back for revision
        Writer->>OpenAI: 39. Incorporate feedback
        OpenAI-->>Writer: 40. Revised draft
        Writer-->>Agent: 41. Updated draft
        Agent->>Editor: 42. Re-execute editor
        Editor->>OpenAI: 43. Review revision
        OpenAI-->>Editor: 44. New verdict
    end

    Agent-->>WS: 45. {type:"result",markdown,meta}
    WS->>API: 46. Persist assistant message
    API->>DB: 47. Save final content
    DB-->>API: 48. Message saved
    API->>DB: 49. Set status="completed"
    WS-->>User: 50. {type:"status",status:"completed"}

    User->>API: 51. Reconcile: GET /conversations/:id
    API->>DB: 52. Fetch conversation
    DB-->>API: 53. Full message history
    API-->>User: 54. {conversation,messages}
    User->>User: 55. Display final markdown
    User->>User: 56. Refresh conversation list
```

### Error Handling Flow

```mermaid
graph TD
    WSFailure[WebSocket Failure] --> Timeout{Connection<br/>Timeout?}
    WSFailure --> ConnError{Connection<br/>Error?}
    WSFailure --> MidStream{Mid-stream<br/>Failure?}

    Timeout --> TokensReceived{Tokens<br/>Received?}
    ConnError --> TokensReceived
    MidStream --> TokensReceived

    TokensReceived -->|Yes| ReconcileServer[Reconcile with Server]
    TokensReceived -->|No| HTTPFallback1[Fallback to HTTP]

    ReconcileServer --> ShowPersisted[Show What Persisted]
    ShowPersisted --> End1[End]

    HTTPFallback1 --> RemoveOpt1[Remove Optimistic Messages]
    RemoveOpt1 --> CallHTTP1[Call POST /api/agent/research]
    CallHTTP1 --> DisplayFinal1[Display Final Result]
    DisplayFinal1 --> End1

    AgentFail[Agent Execution Failure] --> TavilyFail{Tavily API<br/>Failure?}
    AgentFail --> OpenAIFail{OpenAI API<br/>Failure?}
    AgentFail --> RedisFail{Redis<br/>Failure?}
    AgentFail --> DBFail{Database<br/>Failure?}

    TavilyFail --> UseOffline[Use Offline Mocks]
    OpenAIFail --> UseTemplates[Use Offline Templates]
    RedisFail --> MemorySaver[Fallback to MemorySaver]
    DBFail --> ReturnError[Return Error to Client]

    UseOffline --> ContinueAgent[Continue Agent Execution]
    UseTemplates --> ContinueAgent
    MemorySaver --> ContinueAgent
    ContinueAgent --> End2[End]

    AuthFail[Authentication Failure] --> InvalidJWT{Invalid<br/>JWT?}
    AuthFail --> ExpiredToken{Expired<br/>Token?}
    AuthFail --> Blacklisted{Blacklisted<br/>Token?}

    InvalidJWT --> Return401[Return 401]
    ExpiredToken --> Return401
    Blacklisted --> Return401
    Return401 --> RedirectLogin[Redirect to Login Page]

    style WSFailure fill:#ffe1e1
    style AgentFail fill:#ffe1e1
    style AuthFail fill:#ffe1e1
    style ReconcileServer fill:#e1ffe1
    style ContinueAgent fill:#e1ffe1
    style RedirectLogin fill:#e1f5ff
```

## Agent Flow Details

### Depth Configuration

| Depth | Max Results | Search Depth | Content Scope |
|-------|------------|--------------|---------------|
| Quick | 3 | basic | Focused brief, shorter sections |
| Standard | 5 | advanced | Full-length piece, balanced coverage |
| Deep | 8 | advanced | Comprehensive, more sections, nuanced analysis |

### Revision Strategy

**Maximum Revisions:** Configurable via `MAX_REVISIONS` env var (default: 2)

**Revision Logic:**
1. Editor reviews draft
2. If verdict="revise" and count < MAX:
   - Increment revision count
   - Provide specific feedback
   - Route back to Writer
3. If verdict="approved" or count >= MAX:
   - Publish current draft
   - End workflow

**Offline Revision:**
- Exactly one revision cycle (no LLM)
- Pre-defined feedback template
- Ensures loop is exercised without API keys

### Search Integration

**Tavily API Integration:**
```typescript
// Search request
{
  api_key: TAVILY_API_KEY,
  query: topic,
  search_depth: "basic" | "advanced",
  max_results: 3 | 5 | 8,
  include_answer: false,
  include_raw_content: false
}

// Response processing
sources = results.map(r => ({
  title: r.title,
  url: r.url,
  snippet: r.content.slice(0, 300)
}))
```

**Offline Fallback:**
- Generates placeholder sources with `.invalid` URLs
- Clearly labeled as offline
- Prevents fake citations
- Maintains workflow structure

### Citation System

**Source Markers:**
- Format: `[n]` where n is source number (1-based)
- Maintained through all revisions
- Mapped to Sources list at end of article

**Source List Format:**
```markdown
## Sources

1. [Source Title](URL)
2. [Source Title](URL)
...
```

**Citation Integrity:**
- Editor explicitly instructed to keep markers intact
- Writer incorporates markers from plan
- Sources block passed through all nodes

## Deployment Architecture

### Docker Compose Stack

```mermaid
graph TB
    subgraph "Docker Network"
        PG[PostgreSQL 16<br/>Port: 5432<br/>Volume: pgdata<br/>Health: pg_isready]
        REDIS[Redis Stack 7.2.0<br/>Port: 6379<br/>Volume: redisdata<br/>Features: RediSearch<br/>Health: redis-cli ping]
        API[Express API<br/>Port: 4000<br/>Runtime: Bun<br/>Volumes: Live source mounts<br/>Command: db:generate + db:deploy + --hot]
        WEB[React Web<br/>Port: 5173→80<br/>Server: Nginx<br/>Build args: VITE_* vars]
    end

    subgraph "External Dependencies"
        TavilyExt[Tavily API]
        OpenAIExt[OpenAI API]
        GoogleExt[Google OAuth]
    end

    API -->|Depends: healthy| PG
    API -->|Depends: healthy| REDIS
    WEB -->|Depends: running| API

    API -->|TAVILY_API_KEY| TavilyExt
    API -->|OPENAI_API_KEY| OpenAIExt
    API -->|GOOGLE_CLIENT_ID| GoogleExt

    style PG fill:#e1ffe1
    style REDIS fill:#ffe1e1
    style API fill:#fff4e1
    style WEB fill:#e1f5ff
    style TavilyExt fill:#f5e1ff
    style OpenAIExt fill:#f5e1ff
    style GoogleExt fill:#f5e1ff
```

### Environment Configuration

**Root `.env`:**
```bash
POSTGRES_USER=researcher
POSTGRES_PASSWORD=researcherpw
POSTGRES_DB=researcherit
PORT=4000
NODE_ENV=development
DATABASE_URL=postgresql://researcher:researcherpw@postgres:5432/researcherit?schema=public
REDIS_URL=redis://redis:6379
JWT_SECRET=dev-only-secret-change-me
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:5173
GOOGLE_CLIENT_ID=
ALLOW_INSECURE_GOOGLE_DEV=true
OPENAI_API_KEY=
OPENAI_BASE_URL=
RESEARCH_MODEL=gpt-4o-mini
TAVILY_API_KEY=
MAX_REVISIONS=2
VITE_API_URL=http://localhost:4000
VITE_GOOGLE_CLIENT_ID=
```

**Workspace `.env` files:**
- `apps/api/.env` - API-specific config
- `apps/web/.env` - Web-specific config (VITE_ vars)
- `packages/db/.env` - Database CLI config
- `packages/agent/.env` - Agent documentation only

### Build & Deploy Commands

**Development:**
```bash
# Full stack with Docker
bun run docker:up

# Local development (no Docker)
docker compose up postgres redis -d
bun install
bun run db:deploy
bun run dev
```

**Production:**
```bash
# Build all workspaces
bun run build

# Type checking
bun run check-types

# Linting
bun run lint
```

**Database:**
```bash
# Generate Prisma client
bun run db:generate

# Run migrations
bun run db:migrate

# Deploy schema (dev)
bun run db:deploy

# Seed demo data
bun run db:seed
```

## Key Design Decisions

### 1. LangGraph over Custom Agent Framework

**Rationale:**
- Built-in state management
- Checkpointer support for resilience
- Conditional routing for revision loops
- Streaming capabilities
- Battle-tested in production

**Trade-offs:**
- Learning curve for LangGraph concepts
- Dependency on LangChain ecosystem

### 2. Redis Checkpointer with MemorySaver Fallback

**Rationale:**
- Redis provides persistence across restarts
- Thread-scoped checkpoints prevent bleed-between
- MemorySaver ensures API works without Redis
- Best-effort approach aligns with graceful degradation

**Trade-offs:**
- Additional infrastructure dependency
- Redis Stack required for search indexes
- Patch needed for delta storage bug

### 3. Three-Agent Model (Planner → Writer → Editor)

**Rationale:**
- Specialized roles improve output quality
- Editor provides quality gate
- Revision loop enables improvement
- Clear separation of concerns

**Trade-offs:**
- More complex than single-agent approach
- Higher latency (multiple LLM calls)
- More token usage

### 4. WebSocket Streaming with HTTP Fallback

**Rationale:**
- Real-time feedback improves UX
- Progressive rendering feels faster
- HTTP fallback ensures reliability
- Optimistic UI reduces perceived latency

**Trade-offs:**
- More complex client logic
- Connection management overhead
- Fallback path needs testing

### 5. Offline Mode with Labeled Templates

**Rationale:**
- Development without API keys
- Demonstrates workflow structure
- Prevents fake citations
- Honest about limitations

**Trade-offs:**
- Limited utility without real APIs
- Template content is generic
- Doesn't showcase full capabilities

### 6. JWT Auth with Redis Blacklist

**Rationale:**
- Stateless authentication
- Redis enables logout functionality
- Best-effort (works without Redis)
- Standard approach for SPAs

**Trade-offs:**
- Token revocation is immediate only with Redis
- Additional Redis dependency
- Blacklist can grow large

### 7. Monorepo with Turborepo

**Rationale:**
- Shared packages (db, agent, types)
- Consistent tooling across workspaces
- Efficient builds with caching
- Easy dependency management

**Trade-offs:**
- Turborepo learning curve
- More complex repo structure
- Slower initial setup

### 8. Bun Runtime

**Rationale:**
- Faster than Node.js
- Native TypeScript support
- Built-in package manager
- Modern tooling

**Trade-offs:**
- Less mature than Node
- Smaller ecosystem
- Potential compatibility issues

## Security Considerations

### Authentication & Authorization

- JWT tokens with expiration
- Password hashing (bcrypt)
- Google OAuth with verification
- Rate limiting on auth endpoints
- Token blacklist for logout

### API Security

- CORS configuration
- Helmet.js for security headers
- Input validation with Zod
- SQL injection prevention (Prisma)
- XSS prevention (React escaping)

### External API Security

- API keys in environment variables
- Never log sensitive data
- Request timeouts
- Error handling without exposing internals

### WebSocket Security

- Token-based authentication
- Connection validation
- Message validation
- Graceful error handling

## Performance Optimizations

### Database

- Indexed fields (email, conversationId)
- Connection pooling (Prisma)
- Efficient queries with selects
- Cascade deletes for cleanup

### Caching

- Redis for token blacklist
- Redis for conversation status
- Agent graph compilation cache
- Frontend conversation list cache

### Streaming

- Chunked token delivery
- Optimistic UI updates
- WebSocket for real-time
- HTTP fallback for reliability

### Agent Execution

- Parallel node execution where possible
- Efficient prompt engineering
- Token streaming for perceived speed
- Checkpointing for resume capability

## Monitoring & Observability

### Logging

- Morgan HTTP logging
- Console logging for agent flow
- Error logging with context
- Status updates via WebSocket

### Health Checks

- `/health` endpoint
- Database health checks
- Redis health checks
- Docker health checks

### Metrics (Future)

- Request latency
- Agent execution time
- Revision rates
- Error rates
- User engagement

## Future Enhancements

### Planned Features

1. **Multi-turn Conversations**
   - Context-aware follow-up research
   - Conversation memory in agent state

2. **Export Options**
   - PDF generation
   - Word document export
   - Markdown file download

3. **Advanced Editing**
   - Section-level editing
   - Source replacement
   - Custom prompts

4. **Collaboration**
   - Shared conversations
   - Comments and annotations
   - Version history

5. **Analytics**
   - Usage metrics
   - Popular topics
   - Agent performance

6. **Enhanced Search**
   - Multiple search providers
   - Custom search queries
   - Source filtering

### Technical Improvements

1. **Testing**
   - Unit tests for agent nodes
   - Integration tests for API
   - E2E tests for frontend

2. **CI/CD**
   - Automated testing
   - Deployment pipelines
   - Environment promotion

3. **Scalability**
   - Horizontal scaling
   - Load balancing
   - Database optimization

4. **Monitoring**
   - Application metrics
   - Error tracking
   - Performance monitoring

## Conclusion

ResearcherIt demonstrates a modern, full-stack AI application with:

- **Sophisticated Agent Architecture**: LangGraph-based multi-agent system
- **Real-Time UX**: WebSocket streaming with HTTP fallback
- **Robust Data Layer**: PostgreSQL with Prisma ORM
- **Flexible Deployment**: Docker Compose for local development
- **Graceful Degradation**: Offline mode when APIs unavailable
- **Clean Architecture**: Monorepo with shared packages

The system balances complexity with usability, providing a powerful research assistant while maintaining development velocity and operational reliability.
